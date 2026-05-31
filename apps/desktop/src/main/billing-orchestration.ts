import type { AgentRole } from "../shared/ipc";

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
export function isSdkIncrementalStreamUsage(
  authoritative: boolean,
  payload: unknown,
): boolean {
  return authoritative && !sdkPayloadHasModelUsage(payload);
}

/** Skip result token billing when OTel already recorded per-request tokens this run. */
export function shouldSkipSdkResultTokenBilling(otelTokenBilled: boolean | undefined): boolean {
  return otelTokenBilled === true;
}

export function buildAssistantUsageRequestKey(messageId: string): string {
  return `sdk-assistant:${messageId}`;
}

export function shouldBillAssistantSubagentUsage(input: {
  role: AgentRole;
  messageId: string | undefined;
  otelTokenBilled: boolean | undefined;
}): input is { role: SubagentBillingRole; messageId: string; otelTokenBilled: false | undefined } {
  return (
    Boolean(input.messageId) &&
    isSubagentBillingRole(input.role) &&
    input.otelTokenBilled !== true
  );
}

export function nextOtelRequestDedupId(currentSeq: number | undefined): {
  seq: number;
  dedupId: string;
} {
  const seq = (currentSeq ?? 0) + 1;
  return { seq, dedupId: String(seq) };
}
