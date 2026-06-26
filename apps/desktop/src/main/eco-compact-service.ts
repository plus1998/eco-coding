import type { ThreadActivityLine } from "../shared/ipc";
import {
  buildCompactionSummaryPrompt,
  buildStructuredEcoCompactFallbackSummary,
  estimateHandoffPostTokens,
  splitUserMessagesForCompact,
} from "../shared/eco-compact-handoff";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { postAuxiliaryBridgeRequest } from "./bridge-auxiliary-request";
import type { ThreadCompactHandoffRecord } from "./conversation-store";

const SUMMARY_TIMEOUT_MS = 30_000;

const SUMMARY_ROUTE_ROLES = ["planner", "explore", "coder"] as const;

type Fetcher = typeof fetch;

export interface EcoCompactServiceInput {
  listActivityLines(threadId: string): ThreadActivityLine[];
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

  return {
    async runEcoCompact(threadId, input) {
      const threadPrompt = services.getThreadPrompt(threadId)?.trim() ?? "";
      const activityLines = services.listActivityLines(threadId).map((line) => ({
        role: line.role,
        message: line.message,
      }));
      const { older, recent } = splitUserMessagesForCompact(activityLines);

      const routes = services.resolveProxyRoutes(threadId);
      const summary = await summarizeCompactionContext(threadPrompt, older, routes, fetcher, input.signal);
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
  parentSignal?: AbortSignal,
): Promise<string> {
  const summaryRoute = resolveSummaryRoute(routes);
  if (!summaryRoute) {
    return buildFallbackSummary(threadPrompt, olderMessages);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const summary = await requestCompactionSummary(
      summaryRoute,
      buildCompactionSummaryPrompt(threadPrompt, olderMessages),
      fetcher,
      controller.signal,
    );
    if (summary) {
      return summary;
    }
  } catch {
    // fall through to deterministic fallback
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }

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
