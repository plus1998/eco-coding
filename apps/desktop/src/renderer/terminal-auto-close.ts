export const PACKAGE_SCRIPT_AUTO_CLOSE_MS = 5_000;

export interface TerminalAutoCloseState {
  sessionId: string;
  deadline: number;
  remainingSeconds: number;
}

/** Drop countdowns whose tab no longer hosts the finished session. */
export function pruneStaleAutoCloseEntries(
  autoCloseByTabId: Record<string, TerminalAutoCloseState>,
  sessionsByTabId: Record<string, string | undefined>,
): Record<string, TerminalAutoCloseState> {
  let changed = false;
  const next: Record<string, TerminalAutoCloseState> = {};
  for (const [tabId, countdown] of Object.entries(autoCloseByTabId)) {
    if (sessionsByTabId[tabId] === countdown.sessionId) {
      next[tabId] = countdown;
      continue;
    }
    changed = true;
  }
  return changed ? next : autoCloseByTabId;
}

/** Only close tabs that still map to the session the countdown was opened for. */
export function listExpiredAutoCloseTabIds(
  autoCloseByTabId: Record<string, TerminalAutoCloseState>,
  sessionsByTabId: Record<string, string | undefined>,
  now: number,
): string[] {
  return Object.entries(autoCloseByTabId)
    .filter(
      ([tabId, countdown]) => countdown.deadline <= now && sessionsByTabId[tabId] === countdown.sessionId,
    )
    .map(([tabId]) => tabId);
}

export function createAutoCloseState(
  sessionId: string,
  now = Date.now(),
  durationMs = PACKAGE_SCRIPT_AUTO_CLOSE_MS,
): TerminalAutoCloseState {
  return {
    sessionId,
    deadline: now + durationMs,
    remainingSeconds: Math.ceil(durationMs / 1_000),
  };
}

export function tickAutoCloseRemainingSeconds(
  countdown: TerminalAutoCloseState,
  now: number,
): TerminalAutoCloseState {
  const remainingSeconds = Math.max(1, Math.ceil((countdown.deadline - now) / 1_000));
  if (remainingSeconds === countdown.remainingSeconds) {
    return countdown;
  }
  return { ...countdown, remainingSeconds };
}
