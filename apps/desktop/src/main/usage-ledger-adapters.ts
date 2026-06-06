import crypto from "node:crypto";
import type { ParsedUsage } from "@eco/runtime";
import type { AgentRole } from "../shared/ipc";
import {
  buildUsageLedgerEventKey,
  type UsageLedgerEvent,
  type UsageLedgerKind,
  type UsageLedgerSource,
} from "./usage-ledger";

export interface UsageLedgerModelUsage {
  role?: AgentRole;
  modelId: string;
  usage: ParsedUsage;
  sdkCostUsd?: number;
}

export interface BuildSdkUsageLedgerEventsInput {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  models: readonly UsageLedgerModelUsage[];
  totalCostUsd?: number;
  agentId?: string;
  parentToolUseId?: string;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface BuildSingleUsageLedgerEventInput {
  threadId: string;
  role: AgentRole;
  source: UsageLedgerSource;
  sourceEventId: string;
  usageKind?: UsageLedgerKind;
  usage: ParsedUsage;
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
      requestKey: input.requestKey,
      modelId: entry.modelId,
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
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
    ...(input.requestKey && { requestKey: input.requestKey }),
    ...(input.providerRequestId && { providerRequestId: input.providerRequestId }),
    ...(input.sdkMessageId && { sdkMessageId: input.sdkMessageId }),
    ...(modelId && { modelId }),
    ...(input.reportedCostUsd !== undefined && { reportedCostUsd: input.reportedCostUsd }),
    ...(input.metadata && Object.keys(input.metadata).length > 0 && { metadata: input.metadata }),
  };
}

function usageLedgerEventId(idempotencyKey: string): string {
  const hash = crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24);
  return `ule_${hash}`;
}
