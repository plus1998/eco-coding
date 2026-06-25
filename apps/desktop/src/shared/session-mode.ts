export const SESSION_MODES = ["agent", "plan", "ask"] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export interface SessionModeSource {
  sessionMode?: SessionMode;
}

export function isSessionMode(value: unknown): value is SessionMode {
  return typeof value === "string" && (SESSION_MODES as readonly string[]).includes(value);
}

export function normalizeSessionMode(value: unknown): SessionMode {
  return isSessionMode(value) ? value : "agent";
}

export function resolveSessionMode(source?: SessionModeSource): SessionMode {
  return normalizeSessionMode(source?.sessionMode);
}

export function isAskSessionMode(source?: SessionModeSource): boolean {
  return resolveSessionMode(source) === "ask";
}

export function isPlanSessionMode(source?: SessionModeSource): boolean {
  return resolveSessionMode(source) === "plan";
}
