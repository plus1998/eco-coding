import type { FollowUpDeliveryMode } from "./ipc";

export function coreSupportsMidTurnFollowUp(
  coreKind: string | undefined,
): coreKind is "claude" | "codex" | "pi" {
  return coreKind === "claude" || coreKind === "codex" || coreKind === "pi";
}

/** Interrupt current turn then send follow-up (ACP has no mid-turn inject of its own). */
export function coreSupportsFollowUpEscalate(coreKind: string | undefined): boolean {
  return coreSupportsMidTurnFollowUp(coreKind) || coreKind === "acp";
}

/** ACP maps "steer" to cancel + resume; Claude/Codex/PI use mid-turn inject. */
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
