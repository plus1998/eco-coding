import type { FollowUpDeliveryMode } from "./ipc";

export const ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED =
  "Cursor ACP 不支持中断当前轮次插入后续消息；消息会在本轮结束后发送。";

export type AcpFollowUpEnqueuePlan = { kind: "default" } | { kind: "force_queue" };

export function coreSupportsMidTurnFollowUp(
  coreKind: string | undefined,
): coreKind is "claude" | "codex" {
  return coreKind === "claude" || coreKind === "codex";
}

export function coreSupportsFollowUpEscalate(coreKind: string | undefined): boolean {
  return coreSupportsMidTurnFollowUp(coreKind);
}

export function shouldForceQueuedFollowUp(coreKind: string | undefined): boolean {
  return coreKind === "acp";
}

export function resolveFollowUpDeliveryModeForCore(
  coreKind: string | undefined,
  requested: FollowUpDeliveryMode,
): FollowUpDeliveryMode {
  return coreSupportsMidTurnFollowUp(coreKind) ? requested : "queue";
}

export function resolveAcpFollowUpEnqueuePlan(input: {
  coreKind?: string | undefined;
  attachmentCount: number;
}): AcpFollowUpEnqueuePlan {
  if (input.coreKind !== "acp") {
    return { kind: "default" };
  }
  return { kind: "force_queue" };
}

export function assertAcpFollowUpEscalateAllowed(coreKind: string | undefined): void {
  if (coreKind === "acp") {
    throw new Error(ACP_FOLLOW_UP_ESCALATE_UNSUPPORTED);
  }
}
