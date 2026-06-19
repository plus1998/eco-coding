import {
  buildFallbackSubagentHandoffSummary,
  buildSubagentCompactionSummaryPrompt,
  buildSubagentHandoffPrompt,
  splitSubagentActivityForHandoff,
} from "@eco/runtime";
import type { RuntimeAgentRole, ThreadActivityLine } from "../shared/ipc";
import type { AnthropicProxyRoute } from "./anthropic-proxy";
import { buildProviderRequestBaseUrl } from "./provider-models";

const ANTHROPIC_VERSION = "2023-06-01";
const SUMMARY_TIMEOUT_MS = 30_000;
const SUMMARY_ROUTE_ROLES = ["planner", "explore", "coder"] as const;

type Fetcher = typeof fetch;

export interface SubagentHandoffServiceInput {
  listActivityLines(threadId: string): ThreadActivityLine[];
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
      const activityLines = services
        .listActivityLines(input.threadId)
        .filter((line) => line.agentId === input.agentId)
        .map((line) => ({ message: line.message }));

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
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  const apiKey = summaryRoute.provider.apiKey.trim();
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetcher(
    `${buildProviderRequestBaseUrl(summaryRoute.provider.baseUrl, summaryRoute.provider.requestPath)}/v1/messages`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: summaryRoute.modelId,
        max_tokens: 2_048,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal,
    },
  );

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = payload.content
    ?.filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text!.trim())
    .filter(Boolean)
    .join("\n\n");
  return text?.trim() || undefined;
}
