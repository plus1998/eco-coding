import type {
  BashApprovalRequest,
  ClarificationRequest,
  ThreadPendingFollowUp,
  ThreadPendingPlan,
  ThreadSessionBootstrapResult,
  ThreadSummary,
} from "../shared/ipc";
import { buildThreadPendingPlanView } from "./thread-pending-plan-view";

export interface ThreadSessionBootstrapServices {
  getThread(threadId: string): ThreadSummary | undefined;
  listFollowUps(threadId: string): ThreadPendingFollowUp[];
  getPendingPlan(threadId: string): (ThreadPendingPlan & { routesJson?: string }) | undefined;
  getPendingBashApproval(threadId: string): BashApprovalRequest | undefined;
  getPendingClarification(threadId: string): ClarificationRequest | undefined;
}

export function buildThreadSessionBootstrap(
  threadId: string,
  services: ThreadSessionBootstrapServices,
): ThreadSessionBootstrapResult {
  const id = threadId.trim();
  if (!id) {
    return {
      followUps: [],
    };
  }

  const thread = services.getThread(id);
  const followUps = services.listFollowUps(id);
  const pendingPlan = buildThreadPendingPlanView(services.getPendingPlan(id));
  const pendingBash = services.getPendingBashApproval(id);
  const pendingClarification = services.getPendingClarification(id);

  return {
    ...(thread && { thread }),
    followUps,
    ...(pendingPlan && { pendingPlan }),
    ...(pendingBash && { pendingBash }),
    ...(pendingClarification && { pendingClarification }),
  };
}
