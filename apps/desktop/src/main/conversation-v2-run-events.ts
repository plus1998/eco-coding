import { type ConversationEventInput, stableHash } from "@eco/shared";
import type { RunAttemptPhase, RunAttemptStatus } from "./usage-ledger";

/** V2 event type that carries one attempt status. */
export function conversationV2RunEventType(status: RunAttemptStatus): ConversationEventInput["type"] {
  if (status === "running") return "run.started";
  if (status === "completed") return "run.completed";
  if (status === "failed") return "run.failed";
  return "run.cancelled";
}

/** Builds an immutable lifecycle fact shared by live execution and one-time migration.
 * Recovery metadata is part of the event, never a second authoritative table.
 */
export function conversationV2RunEventForAttempt(input: {
  conversationId: string;
  attemptId: string;
  status: RunAttemptStatus;
  phase?: RunAttemptPhase;
  retryIndex?: number;
  metadata?: Record<string, unknown>;
  startedAt: string;
  endedAt?: string | undefined;
  /** Source-key prefix identifying which producer wrote the event. */
  sourcePrefix: string;
  /** Fallback end boundary for a terminal attempt recorded without `endedAt`. */
  now?: () => string;
}): ConversationEventInput {
  const endedAt =
    input.endedAt ?? (input.status === "running" ? "" : (input.now ?? (() => new Date().toISOString()))());
  const sourceEventKey = [
    input.sourcePrefix,
    input.conversationId,
    input.attemptId,
    input.status,
    input.startedAt,
    endedAt,
    stableHash({ phase: input.phase, retryIndex: input.retryIndex, metadata: input.metadata }),
  ].join(":");
  return {
    conversationId: input.conversationId,
    eventId: `desktop_v2_run_${stableHash(sourceEventKey)}`,
    sourceEventKey,
    type: conversationV2RunEventType(input.status),
    occurredAt: endedAt || input.startedAt,
    turnId: input.attemptId,
    runId: input.attemptId,
    payload: {
      authority: "lifecycle",
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
      ...(input.retryIndex !== undefined ? { retryIndex: input.retryIndex } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      status: input.status,
      timingQuality: "recorded",
      startedAt: input.startedAt,
      ...(input.status === "running" ? {} : { endedAt: endedAt || input.startedAt }),
    },
  };
}
