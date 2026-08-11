import type { ResolvedModelRoute } from "../../model-router/src";
import {
  DEFAULT_CONTEXT_LIMIT,
  DEFAULT_GLOBAL_MAX_OUTPUT_TOKENS,
  resolveAppliedMaxOutputTokens,
} from "./models-dev-limits.js";

/**
 * Pi `Model` shape without importing `@earendil-works/pi-ai` at module top-level
 * (keeps availability probe free of heavy optional deps during tests).
 */
export interface EcoPiModelSpec {
  id: string;
  name: string;
  api: "anthropic-messages";
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
}

export interface BuildEcoPiModelInput {
  /** Eco bridge face base URL (e.g. http://127.0.0.1:18765). */
  bridgeBaseUrl: string;
  /**
   * Model id as seen by the Eco Bridge Messages face (route alias), matching
   * `startAnthropicModelProxy` / Claude alias encoding.
   */
  bridgeModelId: string;
  /**
   * Eco provider id used only for diagnostics; Pi auth uses `provider: "anthropic"`
   * against the local bridge with `LOCAL_PROXY_API_KEY`.
   */
  route?: ResolvedModelRoute;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/**
 * Map an Eco planner route onto a Pi model that talks Anthropic Messages to the
 * Eco Bridge. Upstream protocol conversion remains Eco's responsibility via
 * route registration on the bridge (same path as Claude Code).
 */
export function buildEcoPiModel(input: BuildEcoPiModelInput): EcoPiModelSpec {
  const baseUrl = input.bridgeBaseUrl.replace(/\/+$/, "");
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
    throw new Error(`PI bridge baseUrl must be HTTP(S): ${input.bridgeBaseUrl}`);
  }
  const bridgeModelId = input.bridgeModelId.trim();
  if (!bridgeModelId) {
    throw new Error("PI bridge model id is required.");
  }

  const contextWindow =
    input.contextWindow ??
    input.route?.primary.contextWindow ??
    DEFAULT_CONTEXT_LIMIT;
  const maxTokens = resolveAppliedMaxOutputTokens({
    ...(input.maxOutputTokens !== undefined && { modelMaxOutputTokens: input.maxOutputTokens }),
    globalMaxOutputTokens: DEFAULT_GLOBAL_MAX_OUTPUT_TOKENS,
    contextTokens: contextWindow,
  });

  return {
    id: bridgeModelId,
    name: bridgeModelId,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: {
      input: input.route?.primary.inputCostPerMillion ?? 0,
      output: input.route?.primary.outputCostPerMillion ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow,
    maxTokens,
  };
}

export function resolvePiPlannerRoute(
  routes: readonly ResolvedModelRoute[],
): ResolvedModelRoute | undefined {
  return (
    routes.find((route) => route.role === "planner") ??
    routes.find((route) => route.role === "main") ??
    routes[0]
  );
}
