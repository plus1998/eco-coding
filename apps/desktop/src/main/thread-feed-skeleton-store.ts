import type {
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadSummary,
} from "../shared/ipc";
import type { ThreadSubagentSessionTiming } from "../shared/ipc";
import type { RunAttemptRecord } from "./usage-ledger";

export interface FeedSkeletonPatchState {
  trackedItems: ThreadRunProjectionTimelineItem[];
}

export interface ThreadFeedSkeletonRecord {
  historyRevision: number;
  maxEventSequence: number;
  snapshot: ThreadRunProjectionSnapshot;
  patchState?: FeedSkeletonPatchState;
}

export interface ThreadFeedSkeletonHydrationContext {
  getThread(threadId: string): ThreadSummary | undefined;
  listRunAttempts(threadId: string): readonly RunAttemptRecord[];
  getBilling(threadId: string): ThreadBillingSnapshot | undefined;
  getContext(threadId: string): ThreadContextSnapshot | undefined;
  getHistoryRevision(threadId: string): number;
  getSubagentTimings(threadId: string): readonly ThreadSubagentSessionTiming[];
}

export function isThreadFeedSkeletonFresh(
  record: ThreadFeedSkeletonRecord,
  historyRevision: number,
  maxEventSequence: number,
): boolean {
  return record.historyRevision === historyRevision && record.maxEventSequence === maxEventSequence;
}

export function mapRunAttemptsForFeedSkeleton(
  attempts: readonly RunAttemptRecord[],
): ThreadRunProjectionAttempt[] {
  return [...attempts]
    .map((attempt) => ({
      attemptId: attempt.attemptId,
      phase: attempt.phase,
      retryIndex: attempt.retryIndex,
      status: attempt.status,
      startedAt: attempt.startedAt,
      ...(attempt.endedAt && { endedAt: attempt.endedAt }),
    }))
    .sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) || left.retryIndex - right.retryIndex,
    );
}

export function hydrateThreadFeedSkeletonSnapshot(
  snapshot: ThreadRunProjectionSnapshot,
  threadId: string,
  context: ThreadFeedSkeletonHydrationContext,
): ThreadRunProjectionSnapshot {
  const thread = context.getThread(threadId);
  const attempts = mapRunAttemptsForFeedSkeleton(context.listRunAttempts(threadId));
  const currentAttemptId =
    attempts.find((attempt) => attempt.status === "running")?.attemptId ?? attempts.at(-1)?.attemptId;
  const billing = context.getBilling(threadId);
  const threadContext = context.getContext(threadId);
  const subagentTimings = context.getSubagentTimings(threadId);
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      threadId,
      ...(thread?.status && { status: thread.status }),
      ...(thread?.message !== undefined && { message: thread.message }),
      generatedAt: new Date().toISOString(),
      ...(currentAttemptId && { currentAttemptId }),
    },
    attempts,
    ...(billing && { billing }),
    ...(threadContext && { context: threadContext }),
    ...(subagentTimings.length > 0 && { subagentTimings: [...subagentTimings] }),
    historyRevision: context.getHistoryRevision(threadId),
  };
}
