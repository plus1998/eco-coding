import type { FollowUpDeliveryMode } from "./ipc";

export function coreSupportsMidTurnFollowUp(coreKind: string | undefined): coreKind is "claude" | "codex" {
  return coreKind === "claude" || coreKind === "codex";
}

/** Interrupt current turn then send follow-up (ACP has no mid-turn inject). */
export function coreSupportsFollowUpEscalate(coreKind: string | undefined): boolean {
  return coreSupportsMidTurnFollowUp(coreKind) || coreKind === "acp";
}

/** ACP maps "steer" to cancel + resume; Claude/Codex use mid-turn inject. */
export function coreUsesInterruptForSteer(coreKind: string | undefined): boolean {
  return coreKind === "acp";
}

export function resolveFollowUpDeliveryModeForCore(
  coreKind: string | undefined,
  requested: FollowUpDeliveryMode,
): FollowUpDeliveryMode {
  if (coreSupportsMidTurnFollowUp(coreKind) || coreKind === "acp") {
    return requested;
  }
  return "queue";
}
