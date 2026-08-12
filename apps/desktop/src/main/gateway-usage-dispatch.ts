import type { GatewayUsageEvent } from "@eco/gateway";

/**
 * Split Gateway usage observers: Codex turn billing vs product Bridge binding billing.
 * Never send bare messages usage into Codex turn metadata resolution
 * (that path rejects as missing_turn_metadata and poisons logs / drops attribution).
 */
export type GatewayUsageDispatch =
  | { kind: "codex" }
  | { kind: "claude_messages" }
  | { kind: "unbillable"; reason: "missing_turn_metadata" };

export function classifyGatewayUsageEvent(
  event: Pick<GatewayUsageEvent, "source" | "codexTurnMetadata" | "bridgeBindingId">,
): GatewayUsageDispatch {
  const threadId = event.codexTurnMetadata?.threadId?.trim();
  const turnId = event.codexTurnMetadata?.turnId?.trim();
  if (threadId && turnId) {
    return { kind: "codex" };
  }

  // Partial Codex metadata still is not product Claude session attribution.
  if (event.codexTurnMetadata) {
    return { kind: "unbillable", reason: "missing_turn_metadata" };
  }

  // Messages / Chat Completions / Responses with explicit Bridge binding → product billing.
  if (
    event.source === "messages" ||
    event.source === "chat_completions" ||
    Boolean(event.bridgeBindingId?.trim())
  ) {
    return { kind: "claude_messages" };
  }

  // Responses without Codex turn metadata or binding: fail-closed for billing.
  return { kind: "unbillable", reason: "missing_turn_metadata" };
}
