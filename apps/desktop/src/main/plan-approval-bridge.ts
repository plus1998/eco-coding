import type { PlanApprovalDecision, PlanApprovalRequest } from "../shared/ipc";

interface PendingPlanApproval {
  threadId: string;
  request: PlanApprovalRequest;
  promise: Promise<PlanApprovalDecision>;
  resolve: (decision: PlanApprovalDecision) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingPlanApproval>();

export function registerPendingPlanApproval(
  threadId: string,
  request: PlanApprovalRequest,
): Promise<PlanApprovalDecision> {
  const existing = pending.get(request.toolUseId);
  if (existing) {
    if (existing.threadId !== threadId) {
      return Promise.reject(
        new Error(`Plan approval ${request.toolUseId} is already pending for another thread.`),
      );
    }
    return existing.promise;
  }

  let resolveDecision!: (decision: PlanApprovalDecision) => void;
  let rejectDecision!: (error: Error) => void;
  const promise = new Promise<PlanApprovalDecision>((resolve, reject) => {
    resolveDecision = resolve;
    rejectDecision = reject;
  });
  pending.set(request.toolUseId, {
    threadId,
    request,
    promise,
    resolve: resolveDecision,
    reject: rejectDecision,
  });
  return promise;
}

export function getPendingPlanApprovalWaitForThread(
  threadId: string,
): Promise<PlanApprovalDecision> | undefined {
  for (const entry of pending.values()) {
    if (entry.threadId === threadId) {
      return entry.promise;
    }
  }
  return undefined;
}

export function getPendingPlanApprovalForThread(threadId: string): PlanApprovalRequest | undefined {
  for (const entry of pending.values()) {
    if (entry.threadId === threadId) {
      return entry.request;
    }
  }
  return undefined;
}

export function getPendingPlanApprovalByToolUseId(toolUseId: string): PlanApprovalRequest | undefined {
  return pending.get(toolUseId)?.request;
}

export function resolvePendingPlanApproval(toolUseId: string, decision: PlanApprovalDecision): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) {
    return false;
  }
  pending.delete(toolUseId);
  entry.resolve(decision);
  return true;
}

export function cancelPlanApprovalsForThread(threadId: string, reason: string): boolean {
  let cancelled = false;
  for (const [toolUseId, entry] of pending) {
    if (entry.threadId !== threadId) {
      continue;
    }
    pending.delete(toolUseId);
    entry.reject(new Error(reason));
    cancelled = true;
  }
  return cancelled;
}
