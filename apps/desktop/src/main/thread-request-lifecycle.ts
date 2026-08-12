/** Tracks request.started shadow events by immutable logical request id per thread. */
const persistedRequestStartedByThread = new Map<string, Set<string>>();

/** @param logicalRequestId immutable Bridge logical request id — never provider/display id */
export function markRequestStartedPersisted(threadId: string, logicalRequestId: string): boolean {
  const trimmed = logicalRequestId.trim();
  if (!trimmed) {
    return false;
  }
  let ids = persistedRequestStartedByThread.get(threadId);
  if (!ids) {
    ids = new Set();
    persistedRequestStartedByThread.set(threadId, ids);
  }
  if (ids.has(trimmed)) {
    return false;
  }
  ids.add(trimmed);
  return true;
}

export function clearRequestStartedPersisted(threadId: string, logicalRequestId?: string): void {
  if (logicalRequestId?.trim()) {
    persistedRequestStartedByThread.get(threadId)?.delete(logicalRequestId.trim());
    return;
  }
  persistedRequestStartedByThread.delete(threadId);
}

export type RequestTerminalStage = "completed" | "failed" | "cancelled";

export function requestTerminalLiveType(stage: RequestTerminalStage): `request.${RequestTerminalStage}` {
  return `request.${stage}`;
}

export function requestTerminalMessage(stage: RequestTerminalStage, detail?: string): string {
  if (detail?.trim()) {
    return detail.trim();
  }
  void stage;
  return "";
}
