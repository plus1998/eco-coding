import type {
  BashApprovalRequest,
  ClarificationRequest,
  ThreadPendingFollowUp,
  ThreadPendingPlan,
  ThreadSessionBootstrapResult,
  ThreadSubagentSessionTiming,
  ThreadSummary,
  ThreadUsageSnapshotResult,
} from "../shared/ipc";
import { buildThreadPendingPlanView } from "./thread-pending-plan-view";
import {
  buildThreadUsageSnapshotResult,
  type ThreadUsageSnapshotRuntimeServices,
} from "./thread-usage-snapshot-runtime";

export interface ThreadSessionBootstrapServices {
  getThread(threadId: string): ThreadSummary | undefined;
  listFollowUps(threadId: string): ThreadPendingFollowUp[];
  getPendingPlan(threadId: string): (ThreadPendingPlan & { routesJson?: string }) | undefined;
  getPendingBashApproval(threadId: string): BashApprovalRequest | undefined;
  getPendingClarification(threadId: string): ClarificationRequest | undefined;
  listSubagentSessionTimings(threadId: string): ThreadSubagentSessionTiming[];
  usageSnapshotServices: ThreadUsageSnapshotRuntimeServices;
}

export interface ThreadSessionBootstrapOptions {
  includeUsage?: boolean;
}

export function buildThreadSessionBootstrap(
  threadId: string,
  services: ThreadSessionBootstrapServices,
  options: ThreadSessionBootstrapOptions = {},
): ThreadSessionBootstrapResult {
  const id = threadId.trim();
  if (!id) {
    return {
      followUps: [],
      subagentSessions: [],
      usage: {},
    };
  }

  const thread = services.getThread(id);
  const followUps = services.listFollowUps(id);
  const pendingPlan = buildThreadPendingPlanView(services.getPendingPlan(id));
  const pendingBash = services.getPendingBashApproval(id);
  const pendingClarification = services.getPendingClarification(id);
  const subagentSessions = services.listSubagentSessionTimings(id);
  const usage = options.includeUsage
    ? buildThreadUsageSnapshotResult(id, services.usageSnapshotServices)
    : {};

  return {
    ...(thread && { thread }),
    followUps,
    ...(pendingPlan && { pendingPlan }),
    ...(pendingBash && { pendingBash }),
    ...(pendingClarification && { pendingClarification }),
    subagentSessions,
    usage: usage satisfies ThreadUsageSnapshotResult,
  };
}
