export const SESSION_MODES = ["agent", "plan", "ask"] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export interface SessionModeSource {
  sessionMode?: SessionMode;
  planModeEnabled?: boolean;
}

export function isSessionMode(value: unknown): value is SessionMode {
  return typeof value === "string" && (SESSION_MODES as readonly string[]).includes(value);
}

/** Resolve persisted session mode; legacy threads use planModeEnabled only. */
export function resolveSessionMode(source: SessionModeSource): SessionMode {
  if (isSessionMode(source.sessionMode)) {
    return source.sessionMode;
  }
  return source.planModeEnabled ? "plan" : "agent";
}

export function sessionModeToPlanModeEnabled(mode: SessionMode): boolean {
  return mode === "plan";
}

/** Keep sessionMode and planModeEnabled aligned when reading or writing config. */
export function syncSessionModeFields(source: SessionModeSource): {
  sessionMode: SessionMode;
  planModeEnabled: boolean;
} {
  const sessionMode = resolveSessionMode(source);
  return {
    sessionMode,
    planModeEnabled: sessionModeToPlanModeEnabled(sessionMode),
  };
}

export function isAskSessionMode(source: SessionModeSource): boolean {
  return resolveSessionMode(source) === "ask";
}

export function isPlanSessionMode(source: SessionModeSource): boolean {
  return resolveSessionMode(source) === "plan";
}
