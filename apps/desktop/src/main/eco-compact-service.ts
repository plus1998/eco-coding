import {
  evaluateCompactSummaryQuality,
  formatCompactSummaryQualityIssues,
  isNonEmptyCompactionSummary,
} from "../shared/compact-summary-quality";
import {
  buildCompactionSummaryPrompt,
  CODEX_COMPACT_SYSTEM_PROMPT,
  type CompactConversationMessage,
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
const SUMMARY_INPUT_SAFETY_TOKENS = 2_000;
const HANDOFF_SAFETY_TOKENS = 2_000;
const MIN_ABSOLUTE_SAVINGS_TOKENS = 4_000;
const MIN_RELATIVE_SAVINGS = 0.15;
const MAX_POST_CONTEXT_RATIO = 0.7;
/** schema 3: free-form handoff + recent user-only ~20k (Codex-aligned). */
const COMPACT_SCHEMA_VERSION = 3;

export const ECOMPACT_SUMMARY_TIMEOUT_ERROR = `摘要生成超时（${SUMMARY_TIMEOUT_SECONDS} 秒）`;
export const ECOMPACT_NO_SUMMARY_ROUTE_ERROR = "没有可用的摘要模型路由，无法压缩上下文。";
export const ECOMPACT_INVALID_SUMMARY_ERROR = "摘要模型未返回有效摘要。";
export const ECOMPACT_NO_COMPRESSIBLE_CONTEXT_ERROR = "没有可压缩的较早对话，拒绝清除当前 SDK 会话。";
export const ECOMPACT_THREAD_NOT_FOUND_ERROR = "找不到线程记录，无法压缩上下文。";
export const ECOMPACT_SOURCE_SESSION_REQUIRED_ERROR = "缺少待压缩的源 SDK session。";
export const ECOMPACT_SOURCE_RANGE_REQUIRED_ERROR = "待压缩历史缺少稳定的源消息范围。";
export const ECOMPACT_INSUFFICIENT_GAIN_ERROR = "压缩收益不足，拒绝清除当前 SDK 会话。";
export const ECOMPACT_POST_CONTEXT_TOO_LARGE_ERROR = "压缩后上下文仍超过安全水位。";
export const ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR = "摘要模型上下文不足，无法安全执行压缩。";

const SUMMARY_ROUTE_ROLES = ["planner", "explore", "coder"] as const;

type Fetcher = typeof fetch;

export interface EcoCompactServiceInput {
  listActivityLines(threadId: string): Promise<ThreadActivityLine[]>;
  getThreadPrompt(threadId: string): string | undefined;
  getLatestCompactSummary(threadId: string): ThreadCompactHandoffRecord | undefined;
  commitCompactHandoff(threadId: string, input: CommitCompactHandoffInput): ThreadCompactHandoffRecord;
  resolveProxyRoutes(threadId: string): readonly AnthropicProxyRoute[] | undefined;
  fetcher?: Fetcher;
  /** Test hook: override summary request timeout. */
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
  /** Codex-style: how many oldest older-messages were dropped so the summary request fits. */
  droppedOldestMessages: number;
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

      const routes = services.resolveProxyRoutes(threadId);
      const summaryRoute = resolveSummaryRoute(routes);
      if (!summaryRoute) {
        throw new Error(ECOMPACT_NO_SUMMARY_ROUTE_ERROR);
      }
      const maxOutputTokens = resolveSummaryMaxOutputTokens(summaryRoute);

      // Codex-style: single summary pass; if the compact request itself does not fit the summary
      // model window, drop oldest history items until it fits (no hierarchical chunk/merge).
      const { messages: olderForSummary, droppedOldestMessages } = trimOldestUntilSummaryFits({
        older,
        threadPrompt,
        previousHandoff,
        summaryRoute,
        maxOutputTokens,
      });
      if (olderForSummary.length === 0) {
        throw new Error(ECOMPACT_NO_COMPRESSIBLE_CONTEXT_ERROR);
      }

      const sourceStartMessageId = olderForSummary[0]?.id?.trim();
      const sourceEndMessageId = olderForSummary.at(-1)?.id?.trim();
      if (!sourceStartMessageId || !sourceEndMessageId) {
        throw new Error(ECOMPACT_SOURCE_RANGE_REQUIRED_ERROR);
      }

      process.stderr.write(
        `[eco] eco-compact summary start thread=${threadId} trigger=${input.trigger} routeRole=${summaryRoute.role} model=${summaryRoute.modelId} olderMessages=${older.length} summarizedMessages=${olderForSummary.length} droppedOldest=${droppedOldestMessages} recentMessages=${recent.length} generation=${(previousHandoff?.generation ?? 0) + 1}\n`,
      );

      const summary = await requestValidatedCompactionSummary({
        summaryRoute,
        prompt: buildCompactionSummaryPrompt(threadPrompt, olderForSummary, {
          ...(previousHandoff && { previousHandoff }),
        }),
        fetcher,
        summaryTimeoutMs,
        maxOutputTokens,
        ...(input.signal && { parentSignal: input.signal }),
        logEventPrefix: "eco-compact-summary",
        qualitySources: [
          threadPrompt,
          ...olderForSummary.map((message) => message.message),
          ...(previousHandoff
            ? [
                previousHandoff.summary,
                ...previousHandoff.recentMessages.map((message) => message.message),
              ]
            : []),
        ],
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
        `[eco] eco-compact summary complete thread=${threadId} trigger=${input.trigger} preTokens=${preTokensEstimate} postTokens=${postTokensEstimate} ratio=${metrics.compressionRatio.toFixed(4)} droppedOldest=${droppedOldestMessages} generation=${committed.generation} summaryChars=${summary.length}\n`,
      );

      return {
        preTokensEstimate,
        preTokensSource,
        postTokensEstimate,
        postTokensSource: "local_heuristic",
        compressionRatio: metrics.compressionRatio,
        summary,
        recentMessages: recent,
        droppedOldestMessages,
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

function resolveSummaryMaxOutputTokens(route: AnthropicProxyRoute): number {
  const providerOutputLimit = Math.min(
    SUMMARY_MAX_OUTPUT_TOKENS,
    route.maxOutputTokens !== undefined && route.maxOutputTokens > 0
      ? Math.trunc(route.maxOutputTokens)
      : SUMMARY_MAX_OUTPUT_TOKENS,
  );
  if (!route.contextTokens || route.contextTokens <= 0) {
    return providerOutputLimit;
  }
  const fixedShellTokens = estimateTokens(
    buildCompactionSummaryPrompt("", [], {}),
  );
  const room =
    Math.trunc(route.contextTokens) - fixedShellTokens - SUMMARY_INPUT_SAFETY_TOKENS - MIN_SUMMARY_OUTPUT_TOKENS;
  if (room < MIN_SUMMARY_OUTPUT_TOKENS) {
    throw new Error(
      `${ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR} context=${Math.trunc(route.contextTokens)} fixed=${fixedShellTokens} safety=${SUMMARY_INPUT_SAFETY_TOKENS}`,
    );
  }
  return Math.min(providerOutputLimit, Math.max(MIN_SUMMARY_OUTPUT_TOKENS, Math.floor(room / 2)));
}

/**
 * Codex local compact: if the compact prompt itself cannot fit in the model window,
 * remove oldest history items and retry until it fits (or nothing remains).
 */
export function trimOldestUntilSummaryFits(input: {
  older: readonly CompactConversationMessage[];
  threadPrompt: string;
  previousHandoff?: ThreadCompactHandoffRecord;
  summaryRoute: AnthropicProxyRoute;
  maxOutputTokens: number;
}): { messages: CompactConversationMessage[]; droppedOldestMessages: number } {
  let messages = input.older.map((message) => ({ ...message }));
  let droppedOldestMessages = 0;

  while (messages.length > 0) {
    const prompt = buildCompactionSummaryPrompt(input.threadPrompt, messages, {
      ...(input.previousHandoff && { previousHandoff: input.previousHandoff }),
    });
    if (summaryRequestFitsRoute(input.summaryRoute, prompt, input.maxOutputTokens)) {
      return { messages, droppedOldestMessages };
    }
    messages = messages.slice(1);
    droppedOldestMessages += 1;
  }

  const emptyPrompt = buildCompactionSummaryPrompt(input.threadPrompt, [], {
    ...(input.previousHandoff && { previousHandoff: input.previousHandoff }),
  });
  const promptTokens = estimateTokens(emptyPrompt);
  throw new Error(
    `${ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR} context=${Math.trunc(input.summaryRoute.contextTokens ?? 0)} prompt=${promptTokens} output=${input.maxOutputTokens} safety=${SUMMARY_INPUT_SAFETY_TOKENS} droppedAll=${droppedOldestMessages}`,
  );
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
    // Production hard gate: non-empty free-form handoff only (Codex-aligned).
    // Path / "all tests passed" grounding is soft observation for logs — see golden fixtures.
    if (!isNonEmptyCompactionSummary(summary)) {
      throw new Error(ECOMPACT_INVALID_SUMMARY_ERROR);
    }
    const softQuality = evaluateCompactSummaryQuality(summary, {
      sourceTexts: input.qualitySources,
      checkGrounding: true,
    });
    const softIssues = softQuality.issues.filter((issue) => issue.code !== "empty_summary");
    if (softIssues.length > 0) {
      process.stderr.write(
        `[eco] eco-compact summary soft quality (not rejected): ${formatCompactSummaryQualityIssues({
          ok: false,
          issues: softIssues,
        })}\n`,
      );
    }
    return summary;
  } finally {
    clearTimeout(timeout);
    input.parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function summaryRequestFitsRoute(
  route: AnthropicProxyRoute,
  prompt: string,
  maxOutputTokens: number,
): boolean {
  if (!route.contextTokens || route.contextTokens <= 0) {
    return true;
  }
  const promptTokens = estimateTokens(prompt);
  return promptTokens + maxOutputTokens + SUMMARY_INPUT_SAFETY_TOKENS <= route.contextTokens;
}

function assertSummaryRequestFitsRoute(
  route: AnthropicProxyRoute,
  prompt: string,
  maxOutputTokens: number,
): void {
  if (summaryRequestFitsRoute(route, prompt, maxOutputTokens)) {
    return;
  }
  const promptTokens = estimateTokens(prompt);
  throw new Error(
    `${ECOMPACT_SUMMARY_CONTEXT_TOO_SMALL_ERROR} context=${Math.trunc(route.contextTokens ?? 0)} prompt=${promptTokens} output=${maxOutputTokens} safety=${SUMMARY_INPUT_SAFETY_TOKENS}`,
  );
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
      system: CODEX_COMPACT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    },
    signal,
    logEventPrefix,
    fetcher,
  });
}

/** Production hard gate: non-empty free-form Codex handoff text (re-exported for callers/tests). */
export { isNonEmptyCompactionSummary } from "../shared/compact-summary-quality";

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
