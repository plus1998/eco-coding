import type { ClarificationRequest } from "../shared/ipc";

/** Always render the authoritative queue head; discard older in-flight snapshots. */
export function createClarificationQueueSync(deps: {
  getPending(threadId: string): Promise<ClarificationRequest | undefined>;
  apply(threadId: string, request: ClarificationRequest | undefined): void;
}) {
  const revisions = new Map<string, number>();
  return async (threadId: string): Promise<void> => {
    const revision = (revisions.get(threadId) ?? 0) + 1;
    revisions.set(threadId, revision);
    const request = await deps.getPending(threadId);
    if (revisions.get(threadId) === revision) deps.apply(threadId, request);
  };
}
