import crypto from "node:crypto";
import type { ParsedUsage, RequestBillingDelta } from "@eco/runtime";
import type { RuntimeAgentRole } from "../shared/ipc";
import {
  buildUsageLedgerEventKey,
  type UsageLedgerEvent,
  type UsageLedgerKind,
  type UsageLedgerSource,
} from "./usage-ledger";
import {
  USAGE_LEDGER_COMPUTED_BILLING_METADATA_KEY,
  serializeUsageLedgerComputedBilling,
} from "./usage-ledger-cost-metadata";

export interface UsageLedgerModelUsage {
  role?: RuntimeAgentRole;
  modelId: string;
  usage: ParsedUsage;
  sdkCostUsd?: number;
  computedBilling?: RequestBillingDelta;
}

export interface BuildSdkUsageLedgerEventsInput {
  threadId: string;
  role: RuntimeAgentRole;
  requestKey: string;
  models: readonly UsageLedgerModelUsage[];
  totalCostUsd?: number;
  runAttemptId?: string;
  agentId?: string;
  parentToolUseId?: string;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildSingleUsageLedgerEventInput {
  threadId: string;
  role: RuntimeAgentRole;
  source: UsageLedgerSource;
  sourceEventId: string;
  usageKind?: UsageLedgerKind;
  usage: ParsedUsage;
  computedBilling?: RequestBillingDelta;
  runAttemptId?: string;
  agentId?: string;
  parentToolUseId?: string;
  requestKey?: string;
  providerRequestId?: string;
  sdkMessageId?: string;
  modelId?: string;
  reportedCostUsd?: number;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export function buildSdkUsageLedgerEvents(
  input: BuildSdkUsageLedgerEventsInput,
): UsageLedgerEvent[] {
  return input.models.map((entry) => {
    const reportedCostUsd =
      entry.sdkCostUsd ?? (input.models.length === 1 ? input.totalCostUsd : undefined);
    return buildSingleUsageLedgerEvent({
      threadId: input.threadId,
      role: entry.role ?? input.role,
      source: "sdk",
      sourceEventId: input.requestKey,
      usageKind: "request_final",
      usage: entry.usage,
      ...(entry.computedBilling && { computedBilling: entry.computedBilling }),
      requestKey: input.requestKey,
      modelId: entry.modelId,
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.agentId && { agentId: input.agentId }),
      ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
      ...(reportedCostUsd !== undefined && { reportedCostUsd }),
      ...(input.observedAt && { observedAt: input.observedAt }),
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.totalCostUsd !== undefined && { sdkTotalCostUsd: input.totalCostUsd }),
      },
    });
  });
}

export function buildSingleUsageLedgerEvent(
  input: BuildSingleUsageLedgerEventInput,
): UsageLedgerEvent {
  const usageKind = input.usageKind ?? "request_final";
  const modelId = input.modelId ?? input.usage.modelId;
  const metadata = buildMetadata(input.metadata, input.computedBilling);
  const idempotencyKey = buildUsageLedgerEventKey({
    threadId: input.threadId,
    source: input.source,
    sourceEventId: input.sourceEventId,
    usageKind,
    ...(modelId && { modelId }),
  });

  return {
    id: usageLedgerEventId(idempotencyKey),
    idempotencyKey,
    threadId: input.threadId,
    source: input.source,
    sourceEventId: input.sourceEventId,
    usageKind,
    role: input.role,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheCreationTokens: input.usage.cacheCreationTokens,
    observedAt: input.observedAt ?? new Date().toISOString(),
    attribution: input.agentId
      ? { status: "attributed", agentId: input.agentId }
      : { status: "unattributed", reason: "agent_id_missing" },
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(input.requestKey && { requestKey: input.requestKey }),
    ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
    ...(input.sdkMessageId && { sdkMessageId: input.sdkMessageId }),
    ...(modelId && { modelId }),
    ...(input.reportedCostUsd !== undefined && { reportedCostUsd: input.reportedCostUsd }),
    ...(metadata && { metadata }),
  };
}

function usageLedgerEventId(idempotencyKey: string): string {
  const hash = crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24);
  return `ule_${hash}`;
}

function buildMetadata(
  metadata: Record<string, unknown> | undefined,
  computedBilling: RequestBillingDelta | undefined,
): Record<string, unknown> | undefined {
  const output = { ...(metadata ?? {}) };
  if (computedBilling) {
    output[USAGE_LEDGER_COMPUTED_BILLING_METADATA_KEY] =
      serializeUsageLedgerComputedBilling(computedBilling);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}
