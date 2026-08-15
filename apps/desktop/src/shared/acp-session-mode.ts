import { resolveSessionMode, type SessionMode, type SessionModeSource } from "./session-mode";

/**
 * ACP host only advertises sessionModes `["agent"]`.
 * Force agent whenever the thread/draft core is ACP (or legacy cursor).
 */
export function resolveSessionModeForCore(input: {
  coreKind?: string | null | undefined;
  source?: SessionModeSource;
  sessionMode?: SessionMode;
}): SessionMode {
  if (input.coreKind === "acp" || input.coreKind === "cursor") {
    return "agent";
  }
  if (input.sessionMode !== undefined) {
    return resolveSessionMode({ sessionMode: input.sessionMode });
  }
  return resolveSessionMode(input.source);
}

/** Composer Plan/Ask UI is only meaningful for cores that support those modes. */
export function coreSupportsPlanAskModes(coreKind?: string | null): boolean {
  return coreKind !== "acp" && coreKind !== "cursor";
}
