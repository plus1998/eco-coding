import {
  buildFallbackSubagentHandoffSummary,
  buildSubagentCompactionSummaryPrompt,
  buildSubagentHandoffPrompt,
  splitSubagentActivityForHandoff,
} from "@eco/runtime";
import type { RuntimeAgentRole, ThreadActivityLine } from "../shared/ipc";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { postAuxiliaryBridgeRequest } from "./bridge-auxiliary-request";

const SUMMARY_TIMEOUT_MS = 30_000;
const SUMMARY_ROUTE_ROLES = ["planner", "explore", "coder"] as const;

type Fetcher = typeof fetch;

export interface SubagentHandoffServiceInput {
  listSubagentActivityLines(threadId: string, agentId: string): Promise<ThreadActivityLine[]>;
  resolveProxyRoutes(threadId: string): readonly AnthropicProxyRoute[] | undefined;
  fetcher?: Fetcher;
}

export interface BuildSubagentHandoffPromptInput {
  threadId: string;
  agentId: string;
  role: RuntimeAgentRole;
  originalPrompt: string;
  signal?: AbortSignal;
}

export interface SubagentHandoffService {
  buildHandoffPrompt(input: BuildSubagentHandoffPromptInput): Promise<string>;
}

export function createSubagentHandoffService(services: SubagentHandoffServiceInput): SubagentHandoffService {
  const fetcher = services.fetcher ?? fetch;

  return {
    async buildHandoffPrompt(input) {
      const activityLines = (await services.listSubagentActivityLines(input.threadId, input.agentId)).map(
        (line) => ({ message: line.message }),
      );

      const { older, recent } = splitSubagentActivityForHandoff(activityLines);
      const routes = services.resolveProxyRoutes(input.threadId);
      const summary = await summarizeSubagentHandoffContext(
        input.originalPrompt,
        input.role,
        older,
        routes,
        fetcher,
        input.signal,
      );

      return buildSubagentHandoffPrompt(input.originalPrompt, input.role, {
        summary,
        recentMessages: recent,
        previousAgentId: input.agentId,
      });
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

async function summarizeSubagentHandoffContext(
  originalPrompt: string,
  role: RuntimeAgentRole,
  olderMessages: readonly string[],
  routes: readonly AnthropicProxyRoute[] | undefined,
  fetcher: Fetcher,
  parentSignal?: AbortSignal,
): Promise<string> {
  const summaryRoute = resolveSummaryRoute(routes);
  if (!summaryRoute || olderMessages.length === 0) {
    return buildFallbackSubagentHandoffSummary(originalPrompt, olderMessages);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    const summary = await requestSubagentHandoffSummary(
      summaryRoute,
      buildSubagentCompactionSummaryPrompt(originalPrompt, role, olderMessages),
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

  return buildFallbackSubagentHandoffSummary(originalPrompt, olderMessages);
}

async function requestSubagentHandoffSummary(
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
      messages: [{ role: "user", content: prompt }],
    },
    signal,
    logEventPrefix: "subagent-handoff-summary",
    fetcher,
  });
  return result.ok ? result.text : undefined;
}
