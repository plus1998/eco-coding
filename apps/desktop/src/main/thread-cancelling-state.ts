/** In-memory overlay: a thread is winding down after the user asked to stop. Not persisted. */

const cancellingThreadIds = new Set<string>();

export function markThreadCancelling(threadId: string): boolean {
  const id = threadId.trim();
  if (!id) {
    return false;
  }
  const added = !cancellingThreadIds.has(id);
  cancellingThreadIds.add(id);
  return added;
}

export function clearThreadCancelling(threadId: string): boolean {
  const id = threadId.trim();
  if (!id) {
    return false;
  }
  return cancellingThreadIds.delete(id);
}

export function isThreadCancelling(threadId: string): boolean {
  return cancellingThreadIds.has(threadId.trim());
}

export function shouldKeepThreadCancelling(status: string): boolean {
  return status === "running" || status === "queued";
}

export function attachThreadCancelling<T extends { id: string; cancelling?: boolean }>(thread: T): T {
  if (!cancellingThreadIds.has(thread.id)) {
    if (!thread.cancelling) {
      return thread;
    }
    const next = { ...thread };
    delete next.cancelling;
    return next;
  }
  return { ...thread, cancelling: true };
}

export function attachThreadListCancelling<T extends { id: string; cancelling?: boolean }>(
  threads: readonly T[],
): T[] {
  return threads.map((thread) => attachThreadCancelling(thread));
}
