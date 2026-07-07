/** Tracks request.started shadow events already persisted per thread (current run). */
const persistedRequestStartedByThread = new Map<string, Set<string>>();

export function markRequestStartedPersisted(threadId: string, requestId: string): boolean {
  const trimmed = requestId.trim();
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

export function clearRequestStartedPersisted(threadId: string, requestId?: string): void {
  if (requestId?.trim()) {
    persistedRequestStartedByThread.get(threadId)?.delete(requestId.trim());
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
