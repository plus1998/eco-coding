import { estimateContextTokens, type ParsedUsage } from "@eco/runtime";
import type { AgentRole, BillingUsageSource, ThreadUsageSnapshot } from "../shared/ipc";
import type { ContextMonitorSnapshot } from "./context-window-monitor";

const SUBAGENT_BILLING_ROLES = ["explore", "architect", "coder", "reviewer", "tester"] as const;

export type SubagentBillingRole = (typeof SUBAGENT_BILLING_ROLES)[number];

export function isSubagentBillingRole(role: string): role is SubagentBillingRole {
  return (SUBAGENT_BILLING_ROLES as readonly string[]).includes(role);
}

export function sdkPayloadHasModelUsage(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const modelUsage = (payload as Record<string, unknown>).modelUsage;
  return typeof modelUsage === "object" && modelUsage !== null && !Array.isArray(modelUsage);
}

/** Authoritative SDK usage without session modelUsage (e.g. message_delta stream). */
export function isSdkIncrementalStreamUsage(authoritative: boolean, payload: unknown): boolean {
  return authoritative && !sdkPayloadHasModelUsage(payload);
}

export function buildAssistantUsageRequestKey(messageId: string): string {
  return `sdk-assistant:${messageId}`;
}

export function shouldBillAssistantSubagentUsage(input: {
  role: AgentRole;
  messageId: string | undefined;
  otelTokenBilled: boolean | undefined;
}): input is { role: SubagentBillingRole; messageId: string; otelTokenBilled: false | undefined } {
  return Boolean(input.messageId) && isSubagentBillingRole(input.role) && input.otelTokenBilled !== true;
}

export function nextOtelRequestDedupId(currentSeq: number | undefined): {
  seq: number;
  dedupId: string;
} {
  const seq = (currentSeq ?? 0) + 1;
  return { seq, dedupId: String(seq) };
}

export function shouldUpdateContextFromUsageSource(source: BillingUsageSource | undefined): boolean {
  return source !== "otel";
}

export function buildUsageSnapshotForRole(input: {
  usage: ParsedUsage;
  role: AgentRole;
  monitorSnap?: ContextMonitorSnapshot;
  modelId?: string;
  fallbackContext: "estimate" | "none";
}): ThreadUsageSnapshot {
  const roleContext = input.monitorSnap?.roles.find((role) => role.role === input.role);
  const contextTokens =
    roleContext?.occupied ?? (input.fallbackContext === "estimate" ? estimateContextTokens(input.usage) : 0);

  return {
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    cacheReadTokens: input.usage.cacheReadTokens,
    cacheCreationTokens: input.usage.cacheCreationTokens,
    contextTokens,
    ...(roleContext && {
      contextLimit: roleContext.limit,
      occupancyPct: roleContext.occupancyPct,
    }),
    ...(input.modelId && { modelId: input.modelId }),
  };
}
