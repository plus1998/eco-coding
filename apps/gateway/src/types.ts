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
  apiKey: string;
  /** Wire model id sent to the real upstream. */
  upstreamModelId: string;
  /** Request `model` values routed to this provider. */
  models: string[];
}

export interface ResolvedProviderRoute {
  provider: GatewayProvider;
  upstreamKind: UpstreamKind;
  requestedModel: string;
  upstreamModelId: string;
}

export interface GatewayConfig {
  host: string;
  port: number;
  providers: GatewayProvider[];
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
  source: "responses";
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
}

export type GatewayUsageObserver = (event: GatewayUsageEvent) => void | Promise<void>;
