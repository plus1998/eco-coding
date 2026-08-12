import type { ParsedUsage } from "./usage-normalize.js";

export type UpstreamKind =
  | "anthropic-messages"
  | "responses"
  | "openai-chat"
  | "gateway-delegated";

export interface GatewayProvider {
  id: string;
  name: string;
  upstreamKind: UpstreamKind;
  baseUrl: string;
  /**
   * Optional path prefix between service root and `/{version}/...`
   * (e.g. `/anthropic`, `/zen`). Empty/omitted means API root.
   */
  requestPath?: string;
  /**
   * API path version segment (e.g. `v1`, `v2`). Empty/missing defaults to `v1`.
   * Final path looks like `{baseUrl}{requestPath}/{version}/messages`.
   */
  version?: string;
  apiKey: string;
  /** Wire model id sent to the real upstream. */
  upstreamModelId: string;
  /** Request `model` values routed to this provider. */
  models: string[];
  /** Per-upstream-model output limits used when Codex omits max_output_tokens. */
  modelMaxOutputTokens?: Record<string, number>;
}

export interface ResolvedProviderRoute {
  provider: GatewayProvider;
  upstreamKind: UpstreamKind;
  requestedModel: string;
  upstreamModelId: string;
  /** Claude Bridge binding identity — echoed into usage events, never guessed. */
  bridgeBindingId?: string;
  threadId?: string;
  runAttemptId?: string;
}

export interface GatewayConfig {
  host: string;
  port: number;
  providers: GatewayProvider[];
  /**
   * Global upstream User-Agent override (from Proxy Bridge settings).
   * When unset, passthrough client UA or fall back to Eco default.
   */
  upstreamUserAgent?: string;
  /** Optional global outbound HTTP/HTTPS/SOCKS proxy URL for upstream fetch. */
  upstreamProxyUrl?: string;
}

/** Exact Codex request identity from the `x-codex-turn-metadata` header. */
export type GatewayCodexRequestKind = "turn" | "prewarm" | "compaction";

export interface GatewayCodexTurnMetadata {
  threadId: string;
  turnId: string;
  parentThreadId?: string;
  subagentKind?: string;
  requestKind: GatewayCodexRequestKind;
}

export interface GatewayUsageEvent {
  source: "responses" | "messages";
  sourceEventId: string;
  providerId: string;
  requestedModel: string;
  upstreamModelId: string;
  usage: ParsedUsage;
  stream: boolean;
  observedAt: string;
  responseId?: string;
  providerRequestId?: string;
  codexTurnMetadata?: GatewayCodexTurnMetadata;
  /** Claude Bridge binding — product layer attributes usage without active-session guessing. */
  bridgeBindingId?: string;
  threadId?: string;
  runAttemptId?: string;
}

export type GatewayUsageObserver = (event: GatewayUsageEvent) => void | Promise<void>;
