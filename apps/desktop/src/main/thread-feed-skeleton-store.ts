import type {
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRunProjectionAgent,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadSubagentSessionTiming,
  ThreadSummary,
} from "../shared/ipc";
import { excludeAgentScopedFeedTimelineItems } from "../shared/thread-run-projection-skeleton";
import type { AgentInstanceRecord, RunAttemptRecord } from "./usage-ledger";

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

export function resolveFeedSkeletonPatchAgents(
  cachedAgents: readonly ThreadRunProjectionAgent[],
  instances: readonly AgentInstanceRecord[],
): ThreadRunProjectionAgent[] {
  if (cachedAgents.length > 0) {
    return [...cachedAgents];
  }
  return instances.map((agent) => ({
    agentId: agent.agentId,
    role: agent.role,
    kind: agent.kind,
    status: agent.status,
    startedAt: agent.startedAt,
    durationMs: 0,
    timeline: [],
    ...(agent.runAttemptId && { runAttemptId: agent.runAttemptId }),
    ...(agent.parentToolUseId && { parentToolUseId: agent.parentToolUseId }),
    ...(agent.endedAt && { endedAt: agent.endedAt }),
  }));
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
      (left, right) => left.startedAt.localeCompare(right.startedAt) || left.retryIndex - right.retryIndex,
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
    timeline: excludeAgentScopedFeedTimelineItems(snapshot.timeline),
    ...(billing && { billing }),
    ...(threadContext && { context: threadContext }),
    ...(subagentTimings.length > 0 && { subagentTimings: [...subagentTimings] }),
    historyRevision: context.getHistoryRevision(threadId),
  };
}
