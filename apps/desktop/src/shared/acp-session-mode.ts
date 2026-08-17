import { resolveSessionMode, type SessionMode, type SessionModeSource } from "./session-mode";

/**
 * Cursor ACP advertises sessionModes agent / plan / ask (no debug).
 * Pass through Eco sessionMode for ACP cores.
 */
export function resolveSessionModeForCore(input: {
  coreKind?: string | null | undefined;
  source?: SessionModeSource;
  sessionMode?: SessionMode;
}): SessionMode {
  if (input.sessionMode !== undefined) {
    return resolveSessionMode({ sessionMode: input.sessionMode });
  }
  return resolveSessionMode(input.source);
}

/** Composer Plan/Ask UI — Cursor ACP supports plan/ask natively. */
export function coreSupportsPlanAskModes(coreKind?: string | null): boolean {
  return (
    coreKind === "claude" ||
    coreKind === "codex" ||
    coreKind === "pi" ||
    coreKind === "acp" ||
    coreKind === "cursor"
  );
}
