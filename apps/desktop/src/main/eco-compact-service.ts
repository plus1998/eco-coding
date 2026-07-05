import {
  buildCompactionSummaryPrompt,
  buildStructuredEcoCompactFallbackSummary,
  estimateHandoffPostTokens,
  splitUserMessagesForCompact,
} from "../shared/eco-compact-handoff";
import type { ThreadActivityLine } from "../shared/ipc";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { postAuxiliaryBridgeRequest } from "./bridge-auxiliary-request";
import type { ThreadCompactHandoffRecord } from "./conversation-store";

const SUMMARY_TIMEOUT_MS = 180_000;
const SUMMARY_TIMEOUT_SECONDS = SUMMARY_TIMEOUT_MS / 1_000;
export const ECOMPACT_SUMMARY_TIMEOUT_ERROR = `摘要生成超时（${SUMMARY_TIMEOUT_SECONDS} 秒）`;

const SUMMARY_ROUTE_ROLES = ["planner", "explore", "coder"] as const;

type Fetcher = typeof fetch;

export interface EcoCompactServiceInput {
  listActivityLines(threadId: string): Promise<ThreadActivityLine[]>;
  getThreadPrompt(threadId: string): string | undefined;
  saveCompactHandoff(
    threadId: string,
    input: {
      summary: string;
      recentUserMessages: string[];
      postTokensEstimate: number;
    },
  ): ThreadCompactHandoffRecord;
  clearSdkSession(threadId: string): void;
  resolveProxyRoutes(threadId: string): readonly AnthropicProxyRoute[] | undefined;
  fetcher?: Fetcher;
  /** Test hook: override summary request timeout. */
  summaryTimeoutMs?: number;
}

export interface EcoCompactRunInput {
  trigger: "auto" | "manual";
  signal?: AbortSignal;
}

export interface EcoCompactRunResult {
  postTokensEstimate: number;
  summary: string;
  recentUserMessages: string[];
}

export interface EcoCompactService {
  runEcoCompact(threadId: string, input: EcoCompactRunInput): Promise<EcoCompactRunResult>;
}

export function createEcoCompactService(services: EcoCompactServiceInput): EcoCompactService {
  const fetcher = services.fetcher ?? fetch;
  const summaryTimeoutMs = services.summaryTimeoutMs ?? SUMMARY_TIMEOUT_MS;

  return {
    async runEcoCompact(threadId, input) {
      const threadPrompt = services.getThreadPrompt(threadId)?.trim() ?? "";
      const activityLines = (await services.listActivityLines(threadId)).map((line) => ({
        role: line.role,
        message: line.message,
      }));
      const { older, recent } = splitUserMessagesForCompact(activityLines);

      const routes = services.resolveProxyRoutes(threadId);
      const summaryRoute = resolveSummaryRoute(routes);
      process.stderr.write(
        `[eco] eco-compact summary start thread=${threadId} trigger=${input.trigger} routeRole=${summaryRoute?.role ?? "none"} model=${summaryRoute?.modelId ?? "fallback"} olderMessages=${older.length} recentMessages=${recent.length}\n`,
      );
      const summary = await summarizeCompactionContext(
        threadPrompt,
        older,
        routes,
        fetcher,
        summaryTimeoutMs,
        input.signal,
        threadId,
        input.trigger,
      );
      const postTokensEstimate = estimateHandoffPostTokens(threadPrompt, {
        summary,
        recentUserMessages: recent,
      });

      services.saveCompactHandoff(threadId, {
        summary,
        recentUserMessages: recent,
        postTokensEstimate,
      });
      services.clearSdkSession(threadId);

      process.stderr.write(
        `[eco] eco-compact summary complete thread=${threadId} trigger=${input.trigger} postTokensEstimate=${postTokensEstimate} summaryChars=${summary.length}\n`,
      );

      return {
        postTokensEstimate,
        summary,
        recentUserMessages: recent,
      };
    },
  };
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

async function summarizeCompactionContext(
  threadPrompt: string,
  olderMessages: readonly string[],
  routes: readonly AnthropicProxyRoute[] | undefined,
  fetcher: Fetcher,
  summaryTimeoutMs: number,
  parentSignal: AbortSignal | undefined,
  threadId: string,
  trigger: "auto" | "manual",
): Promise<string> {
  const summaryRoute = resolveSummaryRoute(routes);
  if (!summaryRoute) {
    process.stderr.write(
      `[eco] eco-compact summary fallback thread=${threadId} trigger=${trigger} reason=no-summary-route\n`,
    );
    return buildFallbackSummary(threadPrompt, olderMessages);
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, summaryTimeoutMs);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const summary = await requestCompactionSummary(
      summaryRoute,
      buildCompactionSummaryPrompt(threadPrompt, olderMessages),
      fetcher,
      controller.signal,
    );
    if (timedOut) {
      throw new Error(ECOMPACT_SUMMARY_TIMEOUT_ERROR);
    }
    if (summary) {
      return summary;
    }
  } catch (error) {
    if (timedOut) {
      throw new Error(ECOMPACT_SUMMARY_TIMEOUT_ERROR);
    }
    if (parentSignal?.aborted) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    // fall through to deterministic fallback for transient request failures
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }

  process.stderr.write(
    `[eco] eco-compact summary fallback thread=${threadId} trigger=${trigger} reason=request-failed routeRole=${summaryRoute.role} model=${summaryRoute.modelId}\n`,
  );
  return buildFallbackSummary(threadPrompt, olderMessages);
}

async function requestCompactionSummary(
  summaryRoute: AnthropicProxyRoute,
  prompt: string,
  fetcher: Fetcher,
  signal: AbortSignal,
): Promise<string | undefined> {
  const result = await postAuxiliaryBridgeRequest({
    route: summaryRoute,
    anthropicBody: {
      model: summaryRoute.modelId,
      max_tokens: 2_048,
      temperature: 0,
      thinking: { type: "disabled" },
      system:
        "你是编码对话压缩器。根据用户提供的较早消息生成结构化摘要，按 ## 任务目标 / 已读/已改文件 / 测试结果与错误 / 已做决策 / 未完成事项 分段输出。只输出摘要正文。",
      messages: [{ role: "user", content: prompt }],
    },
    signal,
    logEventPrefix: "eco-compact-summary",
    fetcher,
  });
  return result.ok ? result.text : undefined;
}

function buildFallbackSummary(threadPrompt: string, olderMessages: readonly string[]): string {
  return buildStructuredEcoCompactFallbackSummary({
    threadPrompt,
    olderMessages,
  });
}
