import type { RunAttemptStatus, UsageLedgerEvent } from "./usage-ledger";
import { buildSingleUsageLedgerEvent } from "./usage-ledger-adapters";

export interface InterruptedStreamPartialSettlementInput {
  events: readonly UsageLedgerEvent[];
  runAttemptId: string;
  runStatus: Exclude<RunAttemptStatus, "running" | "completed">;
  observedAt?: string;
}

const SETTLED_FROM_EVENT_ID = "settledFromEventId";

export function buildInterruptedStreamPartialSettlementEvents(
  input: InterruptedStreamPartialSettlementInput,
): UsageLedgerEvent[] {
  const alreadySettled = new Set(
    input.events
      .map((event) => readSettledFromEventId(event.metadata))
      .filter((eventId): eventId is string => Boolean(eventId)),
  );
  const settlements: UsageLedgerEvent[] = [];

  for (const event of input.events) {
    if (
      event.usageKind !== "request_partial" ||
      event.runAttemptId !== input.runAttemptId ||
      alreadySettled.has(event.id)
    ) {
      continue;
    }
    settlements.push(buildInterruptedStreamPartialSettlementEvent(event, input));
    alreadySettled.add(event.id);
  }

  return settlements;
}

function buildInterruptedStreamPartialSettlementEvent(
  event: UsageLedgerEvent,
  input: InterruptedStreamPartialSettlementInput,
): UsageLedgerEvent {
  return buildSingleUsageLedgerEvent({
    threadId: event.threadId,
    role: event.role,
    source: event.source,
    sourceEventId: `${event.sourceEventId}:settled:${input.runStatus}`,
    usageKind: "request_final",
    usage: {
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheReadTokens: event.cacheReadTokens,
      cacheCreationTokens: event.cacheCreationTokens,
    },
    runAttemptId: input.runAttemptId,
    ...(event.agentId && { agentId: event.agentId }),
    ...(event.parentToolUseId && { parentToolUseId: event.parentToolUseId }),
    ...(event.requestKey && { requestKey: `${event.requestKey}:settled:${input.runStatus}` }),
    ...(event.providerRequestId && { providerRequestId: event.providerRequestId }),
    ...(event.sdkMessageId && { sdkMessageId: event.sdkMessageId }),
    ...(event.modelId && { modelId: event.modelId }),
    ...(event.reportedCostUsd !== undefined && { reportedCostUsd: event.reportedCostUsd }),
    ...(input.observedAt && { observedAt: input.observedAt }),
    metadata: {
      ...(event.metadata ?? {}),
      path: "settleInterruptedStreamPartialUsage",
      settlement: "interrupted_stream_partial",
      runStatus: input.runStatus,
      [SETTLED_FROM_EVENT_ID]: event.id,
      settledFromSourceEventId: event.sourceEventId,
    },
  });
}

function readSettledFromEventId(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) {
    return undefined;
  }
  const value = metadata[SETTLED_FROM_EVENT_ID];
  return typeof value === "string" && value.trim() ? value : undefined;
}
