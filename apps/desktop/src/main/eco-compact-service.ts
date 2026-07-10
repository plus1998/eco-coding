import {
  evaluateCompactSummaryQuality,
  formatCompactSummaryQualityIssues,
  hasCompleteStructuredCompactSections,
} from "../shared/compact-summary-quality";
import {
  buildCompactionMergePrompt,
  buildCompactionSummaryPrompt,
  type CompactConversationMessage,
  chunkMessagesForCompact,
  estimateHandoffPostTokens,
  estimateTokens,
  splitMessagesForCompact,
  stripInjectedCompactHandoffMessage,
} from "../shared/eco-compact-handoff";
import type { ThreadActivityLine } from "../shared/ipc";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { postAuxiliaryBridgeRequest } from "./bridge-auxiliary-request";
import type {
  CommitCompactHandoffInput,
  CompactTokenCountSource,
  ThreadCompactHandoffRecord,
} from "./conversation-store";

const SUMMARY_TIMEOUT_MS = 180_000;
const SUMMARY_TIMEOUT_SECONDS = SUMMARY_TIMEOUT_MS / 1_000;
const SUMMARY_MAX_OUTPUT_TOKENS = 4_096;
const MIN_SUMMARY_OUTPUT_TOKENS = 512;
const DEFAULT_SUMMARY_CHUNK_TOKENS = 20_000;
const MIN_SUMMARY_CHUNK_TOKENS = 2_000;
const MERGE_GROUP_OVERHEAD_TOKENS = 256;
const SUMMARY_INPUT_SAFETY_TOKENS = 2_000;
const HANDOFF_SAFETY_TOKENS = 2_000;
const MIN_ABSOLUTE_SAVINGS_TOKENS = 4_000;
const MIN_RELATIVE_SAVINGS = 0.15;
const MAX_POST_CONTEXT_RATIO = 0.7;
const MAX_MERGE_LEVELS = 4;
const COMPACT_SCHEMA_VERSION = 2;

export const ECOMPACT_SUMMARY_TIMEOUT_ERROR = `摘要生成超时（${SUMMARY_TIMEOUT_SECONDS} 秒）`;
export const ECOMPACT_NO_SUMMARY_ROUTE_ERROR = "没有可用的摘要模型路由，无法压缩上下文。";
export const ECOMPACT_INVALID_SUMMARY_ERROR = "摘要模型未返回完整的结构化摘要。";
export const ECOMPACT_NO_COMPRESSIBLE_CONTEXT_ERROR = "没有可压缩的较早对话，拒绝清除当前 SDK 会话。";
export const ECOMPACT_THREAD_NOT_FOUND_ERROR = "找不到线程记录，无法压缩上下文。";
export const ECOMPACT_SOURCE_SESSION_REQUIRED_ERROR = "缺少待压缩的源 SDK session。";
export const ECOMPACT_SOURCE_RANGE_REQUIRED_ERROR = "待压缩历史缺少稳定的源消息范围。";
export const ECOMPACT_INSUFFICIENT_GAIN_ERROR = "压缩收益不足，拒绝清除当前 SDK 会话。";
export const ECOMPACT_POST_CONTEXT_TOO_LARGE_ERROR = "压缩后上下文仍超过安全水位。";
export const ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR = "摘要模型上下文不足，无法安全执行压缩。";
export const ECOMPACT_MERGE_DEPTH_ERROR = "分层摘要达到最大合并层数，仍无法生成单一摘要。";

const SUMMARY_ROUTE_ROLES = ["planner", "explore", "coder"] as const;

type Fetcher = typeof fetch;

export interface EcoCompactServiceInput {
  listActivityLines(threadId: string): Promise<ThreadActivityLine[]>;
  getThreadPrompt(threadId: string): string | undefined;
  getLatestCompactSummary(threadId: string): ThreadCompactHandoffRecord | undefined;
  commitCompactHandoff(threadId: string, input: CommitCompactHandoffInput): ThreadCompactHandoffRecord;
  resolveProxyRoutes(threadId: string): readonly AnthropicProxyRoute[] | undefined;
  fetcher?: Fetcher;
  /** Test hook: override each summary/merge request timeout. */
  summaryTimeoutMs?: number;
}

export interface EcoCompactRunInput {
  trigger: "auto" | "manual";
  sessionId: string;
  preTokensEstimate?: number;
  preTokensSource?: CompactTokenCountSource;
  signal?: AbortSignal;
}

export interface EcoCompactRunResult {
  preTokensEstimate: number;
  preTokensSource: CompactTokenCountSource;
  postTokensEstimate: number;
  postTokensSource: CompactTokenCountSource;
  compressionRatio: number;
  summary: string;
  recentMessages: CompactConversationMessage[];
  chunkCount: number;
  generation: number;
  sourceStartMessageId: string;
  sourceEndMessageId: string;
}

export interface EcoCompactService {
  runEcoCompact(threadId: string, input: EcoCompactRunInput): Promise<EcoCompactRunResult>;
}

export function createEcoCompactService(services: EcoCompactServiceInput): EcoCompactService {
  const fetcher = services.fetcher ?? fetch;
  const summaryTimeoutMs = services.summaryTimeoutMs ?? SUMMARY_TIMEOUT_MS;

  return {
    async runEcoCompact(threadId, input) {
      const sourceSessionId = input.sessionId.trim();
      if (!sourceSessionId) {
        throw new Error(ECOMPACT_SOURCE_SESSION_REQUIRED_ERROR);
      }
      const storedThreadPrompt = services.getThreadPrompt(threadId);
      if (storedThreadPrompt === undefined) {
        throw new Error(ECOMPACT_THREAD_NOT_FOUND_ERROR);
      }
      const threadPrompt = storedThreadPrompt.trim();
      const latestSummary = services.getLatestCompactSummary(threadId);
      const previousHandoff = latestSummary?.targetSessionId === sourceSessionId ? latestSummary : undefined;
      const activityLines = normalizeActivityForRollingSummary(
        await services.listActivityLines(threadId),
        Boolean(previousHandoff),
      );
      const { older, recent } = splitMessagesForCompact(activityLines);
      if (older.length === 0) {
        throw new Error(ECOMPACT_NO_COMPRESSIBLE_CONTEXT_ERROR);
      }
      const sourceStartMessageId = older[0]?.id?.trim();
      const sourceEndMessageId = older.at(-1)?.id?.trim();
      if (!sourceStartMessageId || !sourceEndMessageId) {
        throw new Error(ECOMPACT_SOURCE_RANGE_REQUIRED_ERROR);
      }

      const routes = services.resolveProxyRoutes(threadId);
      const summaryRoute = resolveSummaryRoute(routes);
      if (!summaryRoute) {
        throw new Error(ECOMPACT_NO_SUMMARY_ROUTE_ERROR);
      }
      const summaryBudget = resolveSummaryRouteBudget(summaryRoute, threadPrompt, previousHandoff);
      const chunks = chunkMessagesForCompact(older, summaryBudget.chunkTokenBudget);
      process.stderr.write(
        `[eco] eco-compact summary start thread=${threadId} trigger=${input.trigger} routeRole=${summaryRoute.role} model=${summaryRoute.modelId} olderMessages=${older.length} recentMessages=${recent.length} chunks=${chunks.length} generation=${(previousHandoff?.generation ?? 0) + 1}\n`,
      );
      const summary = await summarizeCompactionChunks({
        threadPrompt,
        chunks,
        ...(previousHandoff && { previousHandoff }),
        summaryRoute,
        fetcher,
        summaryTimeoutMs,
        ...(input.signal && { parentSignal: input.signal }),
        mergeTokenBudget: summaryBudget.chunkTokenBudget,
        summaryMaxOutputTokens: summaryBudget.maxOutputTokens,
      });
      const postTokensEstimate = estimateHandoffPostTokens(
        threadPrompt,
        { summary, recentMessages: recent },
        { safetyTokens: HANDOFF_SAFETY_TOKENS },
      );
      const localPreTokens = estimatePreCompactTokens(threadPrompt, activityLines);
      const preTokensEstimate =
        input.preTokensEstimate !== undefined && input.preTokensEstimate > 0
          ? Math.trunc(input.preTokensEstimate)
          : localPreTokens;
      const preTokensSource =
        input.preTokensEstimate !== undefined && input.preTokensEstimate > 0
          ? (input.preTokensSource ?? "sdk_context_usage")
          : "local_heuristic";
      const metrics = validateCompressionBenefit({
        preTokensEstimate,
        postTokensEstimate,
        ...(summaryRoute.contextTokens !== undefined && { contextTokens: summaryRoute.contextTokens }),
        ...(summaryRoute.maxOutputTokens !== undefined && {
          maxOutputTokens: summaryRoute.maxOutputTokens,
        }),
      });

      const committed = services.commitCompactHandoff(threadId, {
        sourceSessionId,
        sourceStartMessageId,
        sourceEndMessageId,
        summary,
        recentMessages: recent,
        preTokensEstimate,
        preTokensSource,
        postTokensEstimate,
        postTokensSource: "local_heuristic",
        compressionRatio: metrics.compressionRatio,
        schemaVersion: COMPACT_SCHEMA_VERSION,
      });

      process.stderr.write(
        `[eco] eco-compact summary complete thread=${threadId} trigger=${input.trigger} preTokens=${preTokensEstimate} postTokens=${postTokensEstimate} ratio=${metrics.compressionRatio.toFixed(4)} chunks=${chunks.length} generation=${committed.generation} summaryChars=${summary.length}\n`,
      );

      return {
        preTokensEstimate,
        preTokensSource,
        postTokensEstimate,
        postTokensSource: "local_heuristic",
        compressionRatio: metrics.compressionRatio,
        summary,
        recentMessages: recent,
        chunkCount: chunks.length,
        generation: committed.generation,
        sourceStartMessageId,
        sourceEndMessageId,
      };
    },
  };
}

function normalizeActivityForRollingSummary(
  activityLines: readonly ThreadActivityLine[],
  hasPreviousHandoff: boolean,
): CompactConversationMessage[] {
  return activityLines
    .map((line) => {
      const rawMessage = line.message.trim();
      const message =
        hasPreviousHandoff && line.role === "user"
          ? stripInjectedCompactHandoffMessage(rawMessage)
          : rawMessage;
      return {
        ...(line.id.trim() ? { id: line.id.trim() } : {}),
        role: line.role,
        message,
      };
    })
    .filter((line) => line.role.trim() && line.message.trim());
}

function resolveSummaryRoute(
  routes: readonly AnthropicProxyRoute[] | undefined,
): AnthropicProxyRoute | undefined {
  if (!routes || routes.length === 0) {
    return undefined;
  }
  for (const role of SUMMARY_ROUTE_ROLES) {
    const route = routes.find((entry) => entry.role === role);
    if (route) {
      return route;
    }
  }
  return routes[0];
}

interface SummaryRouteBudget {
  chunkTokenBudget: number;
  maxOutputTokens: number;
}

function resolveSummaryRouteBudget(
  route: AnthropicProxyRoute,
  threadPrompt: string,
  previousHandoff: ThreadCompactHandoffRecord | undefined,
): SummaryRouteBudget {
  const providerOutputLimit = Math.min(
    SUMMARY_MAX_OUTPUT_TOKENS,
    route.maxOutputTokens !== undefined && route.maxOutputTokens > 0
      ? Math.trunc(route.maxOutputTokens)
      : SUMMARY_MAX_OUTPUT_TOKENS,
  );
  if (!route.contextTokens || route.contextTokens <= 0) {
    return {
      chunkTokenBudget: DEFAULT_SUMMARY_CHUNK_TOKENS,
      maxOutputTokens: providerOutputLimit,
    };
  }

  const fixedPromptTokens = Math.max(
    estimateTokens(
      buildCompactionSummaryPrompt(threadPrompt, [], {
        ...(previousHandoff && { previousHandoff }),
      }),
    ),
    estimateTokens(buildCompactionMergePrompt(threadPrompt, [])),
  );
  const availableAfterFixedPrompt =
    Math.trunc(route.contextTokens) - fixedPromptTokens - SUMMARY_INPUT_SAFETY_TOKENS;
  const maxOutputTokens = Math.min(
    providerOutputLimit,
    Math.floor((availableAfterFixedPrompt - MERGE_GROUP_OVERHEAD_TOKENS) / 3),
  );
  const chunkTokenBudget = Math.min(
    DEFAULT_SUMMARY_CHUNK_TOKENS,
    availableAfterFixedPrompt - maxOutputTokens,
  );
  if (maxOutputTokens < MIN_SUMMARY_OUTPUT_TOKENS || chunkTokenBudget < MIN_SUMMARY_CHUNK_TOKENS) {
    throw new Error(
      `${ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR} context=${Math.trunc(route.contextTokens)} fixed=${fixedPromptTokens} safety=${SUMMARY_INPUT_SAFETY_TOKENS} output=${Math.max(0, maxOutputTokens)} chunk=${Math.max(0, chunkTokenBudget)}`,
    );
  }
  return { chunkTokenBudget, maxOutputTokens };
}

async function summarizeCompactionChunks(input: {
  threadPrompt: string;
  chunks: readonly CompactConversationMessage[][];
  previousHandoff?: ThreadCompactHandoffRecord;
  summaryRoute: AnthropicProxyRoute;
  fetcher: Fetcher;
  summaryTimeoutMs: number;
  parentSignal?: AbortSignal;
  mergeTokenBudget: number;
  summaryMaxOutputTokens: number;
}): Promise<string> {
  const partialSummaries: string[] = [];
  for (let index = 0; index < input.chunks.length; index += 1) {
    const chunk = input.chunks[index];
    if (!chunk) {
      continue;
    }
    partialSummaries.push(
      await requestValidatedCompactionSummary({
        summaryRoute: input.summaryRoute,
        prompt: buildCompactionSummaryPrompt(input.threadPrompt, chunk, {
          ...(input.previousHandoff && { previousHandoff: input.previousHandoff }),
          chunkIndex: index,
          chunkCount: input.chunks.length,
        }),
        fetcher: input.fetcher,
        summaryTimeoutMs: input.summaryTimeoutMs,
        maxOutputTokens: input.summaryMaxOutputTokens,
        ...(input.parentSignal && { parentSignal: input.parentSignal }),
        logEventPrefix: `eco-compact-summary-chunk-${index + 1}`,
        qualitySources: [
          input.threadPrompt,
          ...chunk.map((message) => message.message),
          ...(input.previousHandoff
            ? [
                input.previousHandoff.summary,
                ...input.previousHandoff.recentMessages.map((message) => message.message),
              ]
            : []),
        ],
      }),
    );
  }
  if (partialSummaries.length === 0) {
    throw new Error(ECOMPACT_INVALID_SUMMARY_ERROR);
  }
  if (partialSummaries.length === 1) {
    return partialSummaries[0] ?? "";
  }
  return mergePartialSummaries({
    threadPrompt: input.threadPrompt,
    summaries: partialSummaries,
    summaryRoute: input.summaryRoute,
    fetcher: input.fetcher,
    summaryTimeoutMs: input.summaryTimeoutMs,
    ...(input.parentSignal && { parentSignal: input.parentSignal }),
    mergeTokenBudget: input.mergeTokenBudget,
    summaryMaxOutputTokens: input.summaryMaxOutputTokens,
  });
}

async function mergePartialSummaries(input: {
  threadPrompt: string;
  summaries: readonly string[];
  summaryRoute: AnthropicProxyRoute;
  fetcher: Fetcher;
  summaryTimeoutMs: number;
  parentSignal?: AbortSignal;
  mergeTokenBudget: number;
  summaryMaxOutputTokens: number;
}): Promise<string> {
  let current = [...input.summaries];
  for (let level = 0; level < MAX_MERGE_LEVELS && current.length > 1; level += 1) {
    const groups = groupSummariesByTokenBudget(
      current,
      Math.max(1, input.mergeTokenBudget - MERGE_GROUP_OVERHEAD_TOKENS),
    );
    const next: string[] = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (!group) {
        continue;
      }
      if (group.length === 1) {
        next.push(group[0] ?? "");
        continue;
      }
      next.push(
        await requestValidatedCompactionSummary({
          summaryRoute: input.summaryRoute,
          prompt: buildCompactionMergePrompt(input.threadPrompt, group),
          fetcher: input.fetcher,
          summaryTimeoutMs: input.summaryTimeoutMs,
          maxOutputTokens: input.summaryMaxOutputTokens,
          ...(input.parentSignal && { parentSignal: input.parentSignal }),
          logEventPrefix: `eco-compact-summary-merge-${level + 1}-${groupIndex + 1}`,
          qualitySources: [input.threadPrompt, ...group],
        }),
      );
    }
    if (next.length >= current.length) {
      throw new Error(
        `${ECOMPACT_MERGE_DEPTH_ERROR} level=${level + 1} summaries=${current.length} mergeBudget=${input.mergeTokenBudget}`,
      );
    }
    current = next;
  }
  if (current.length !== 1 || !current[0]) {
    throw new Error(ECOMPACT_MERGE_DEPTH_ERROR);
  }
  return current[0];
}

function groupSummariesByTokenBudget(summaries: readonly string[], maxTokens: number): string[][] {
  const budget = Math.max(1, Math.trunc(maxTokens));
  const groups: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const summary of summaries) {
    const tokens = estimateTokens(summary);
    if (current.length > 0 && currentTokens + tokens > budget) {
      groups.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(summary);
    currentTokens += tokens;
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

async function requestValidatedCompactionSummary(input: {
  summaryRoute: AnthropicProxyRoute;
  prompt: string;
  fetcher: Fetcher;
  summaryTimeoutMs: number;
  maxOutputTokens: number;
  parentSignal?: AbortSignal;
  logEventPrefix: string;
  qualitySources: readonly string[];
}): Promise<string> {
  assertSummaryRequestFitsRoute(input.summaryRoute, input.prompt, input.maxOutputTokens);
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, input.summaryTimeoutMs);
  const abortFromParent = () => controller.abort();
  if (input.parentSignal?.aborted) {
    controller.abort();
  } else {
    input.parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    const result = await requestCompactionSummary(
      input.summaryRoute,
      input.prompt,
      input.fetcher,
      controller.signal,
      input.logEventPrefix,
      input.maxOutputTokens,
    );
    if (timedOut) {
      throw new Error(ECOMPACT_SUMMARY_TIMEOUT_ERROR);
    }
    if (input.parentSignal?.aborted) {
      throw new Error("上下文压缩已取消。");
    }
    if (!result.ok) {
      if (
        result.status === undefined &&
        !result.upstreamError?.trim() &&
        !result.error?.trim() &&
        !result.text?.trim()
      ) {
        throw new Error(ECOMPACT_INVALID_SUMMARY_ERROR);
      }
      throw new Error(formatSummaryRequestFailure(input.summaryRoute, result));
    }
    const summary = result.text?.trim() ?? "";
    const quality = evaluateCompactSummaryQuality(summary, {
      sourceTexts: input.qualitySources,
      checkGrounding: true,
    });
    if (!quality.ok) {
      throw new Error(`${ECOMPACT_INVALID_SUMMARY_ERROR} ${formatCompactSummaryQualityIssues(quality)}`);
    }
    return summary;
  } finally {
    clearTimeout(timeout);
    input.parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function assertSummaryRequestFitsRoute(
  route: AnthropicProxyRoute,
  prompt: string,
  maxOutputTokens: number,
): void {
  if (!route.contextTokens || route.contextTokens <= 0) {
    return;
  }
  const promptTokens = estimateTokens(prompt);
  const requiredTokens = promptTokens + maxOutputTokens + SUMMARY_INPUT_SAFETY_TOKENS;
  if (requiredTokens > route.contextTokens) {
    throw new Error(
      `${ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR} context=${Math.trunc(route.contextTokens)} prompt=${promptTokens} output=${maxOutputTokens} safety=${SUMMARY_INPUT_SAFETY_TOKENS}`,
    );
  }
}

async function requestCompactionSummary(
  summaryRoute: AnthropicProxyRoute,
  prompt: string,
  fetcher: Fetcher,
  signal: AbortSignal,
  logEventPrefix: string,
  maxOutputTokens: number,
) {
  return postAuxiliaryBridgeRequest({
    route: summaryRoute,
    anthropicBody: {
      model: summaryRoute.modelId,
      max_tokens: maxOutputTokens,
      system:
        "你是编码代理的上下文检查点压缩器。为看不到旧历史的下一编码代理生成可恢复 handoff；完整保留用户约束、进度、精确文件路径、命令、测试、错误、决策依据和下一步。不得虚构工具状态或完成情况。严格按用户要求的五个二级标题输出，只输出摘要正文。",
      messages: [{ role: "user", content: prompt }],
    },
    signal,
    logEventPrefix,
    fetcher,
  });
}

export function isCompleteStructuredSummary(summary: string): boolean {
  return hasCompleteStructuredCompactSections(summary);
}

function estimatePreCompactTokens(
  threadPrompt: string,
  activityLines: readonly CompactConversationMessage[],
): number {
  return (
    estimateTokens(threadPrompt) +
    activityLines.reduce((total, line) => total + estimateTokens(`[${line.role}]\n${line.message}`), 0) +
    HANDOFF_SAFETY_TOKENS
  );
}

export function validateCompressionBenefit(input: {
  preTokensEstimate: number;
  postTokensEstimate: number;
  contextTokens?: number;
  maxOutputTokens?: number;
}): { savedTokens: number; compressionRatio: number } {
  const pre = Math.max(0, Math.trunc(input.preTokensEstimate));
  const post = Math.max(0, Math.trunc(input.postTokensEstimate));
  const savedTokens = pre - post;
  const compressionRatio = pre > 0 ? post / pre : 1;
  const minimumSavings = Math.max(MIN_ABSOLUTE_SAVINGS_TOKENS, Math.ceil(pre * MIN_RELATIVE_SAVINGS));
  if (pre <= 0 || post >= pre || savedTokens < minimumSavings) {
    throw new Error(
      `${ECOMPACT_INSUFFICIENT_GAIN_ERROR} pre=${pre} post=${post} saved=${savedTokens} required=${minimumSavings}`,
    );
  }

  if (input.contextTokens && input.contextTokens > 0) {
    const effectiveLimit = Math.max(
      1,
      Math.trunc(input.contextTokens) - Math.max(0, Math.trunc(input.maxOutputTokens ?? 0)),
    );
    const hardTarget = Math.floor(effectiveLimit * MAX_POST_CONTEXT_RATIO);
    if (post > hardTarget) {
      throw new Error(
        `${ECOMPACT_POST_CONTEXT_TOO_LARGE_ERROR} post=${post} target=${hardTarget} effectiveLimit=${effectiveLimit}`,
      );
    }
  }
  return { savedTokens, compressionRatio };
}

function formatSummaryRequestFailure(
  route: AnthropicProxyRoute,
  result: { status?: number; upstreamError?: string; error?: string },
): string {
  const details = [
    result.status !== undefined ? `HTTP ${result.status}` : "",
    result.upstreamError?.trim() ?? "",
    result.error?.trim() ?? "",
  ].filter(Boolean);
  const suffix = details.length > 0 ? `：${details.join("；")}` : "";
  return `摘要请求失败（${route.provider.name}/${route.modelId}）${suffix}`;
}
