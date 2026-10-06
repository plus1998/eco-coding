import type { PlanApprovalDecision, PlanApprovalRequest } from "../shared/ipc";

interface PendingPlanApproval {
  threadId: string;
  request: PlanApprovalRequest;
  promise: Promise<PlanApprovalDecision>;
  resolve: (decision: PlanApprovalDecision) => void;
  reject: (error: Error) => void;
}

export interface PlanApprovalCommandIdentity {
  principalId: string;
  clientCommandId: string;
}

interface ContinuationAcknowledgement {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
}

const pending = new Map<string, PendingPlanApproval>();
const commandBindings = new Map<string, PlanApprovalCommandIdentity>();
const continuationAcknowledgements = new Map<string, ContinuationAcknowledgement>();

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

/**
 * Bind a durable plan command before waking the in-process SDK waiter. The
 * binding lets the waiter acknowledge that the decision was actually received
 * by the runtime, instead of treating resolve() itself as continuation proof.
 */
export function bindPendingPlanApprovalCommand(
  toolUseId: string,
  command: PlanApprovalCommandIdentity,
): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) return false;
  const existing = commandBindings.get(toolUseId);
  if (
    existing &&
    (existing.principalId !== command.principalId || existing.clientCommandId !== command.clientCommandId)
  ) {
    return false;
  }
  commandBindings.set(toolUseId, command);
  if (!continuationAcknowledgements.has(toolUseId)) {
    let resolveAcknowledgement!: () => void;
    let rejectAcknowledgement!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveAcknowledgement = resolve;
      rejectAcknowledgement = reject;
    });
    // The bridge may be cancelled before the command handler starts waiting;
    // keep the internal deferred from becoming an unhandled rejection. Callers
    // still receive the rejection through waitForPlanApprovalContinuation().
    void promise.catch(() => {});
    continuationAcknowledgements.set(toolUseId, {
      promise,
      resolve: resolveAcknowledgement,
      reject: rejectAcknowledgement,
      settled: false,
    });
  }
  return true;
}

export function getPendingPlanApprovalCommand(toolUseId: string): PlanApprovalCommandIdentity | undefined {
  return commandBindings.get(toolUseId);
}

export function waitForPlanApprovalContinuation(toolUseId: string, timeoutMs = 15_000): Promise<void> {
  const acknowledgement = continuationAcknowledgements.get(toolUseId);
  if (!acknowledgement) {
    return Promise.reject(new Error(`Plan approval ${toolUseId} has no durable command binding.`));
  }
  if (timeoutMs <= 0) return acknowledgement.promise;
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for the plan approval to reach the SDK runtime."));
    }, timeoutMs);
    acknowledgement.promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function acknowledgePlanApprovalContinuation(toolUseId: string): boolean {
  const acknowledgement = continuationAcknowledgements.get(toolUseId);
  if (!acknowledgement || acknowledgement.settled) return false;
  acknowledgement.settled = true;
  acknowledgement.resolve();
  return true;
}

export function rejectPlanApprovalContinuation(toolUseId: string, error: Error): boolean {
  const acknowledgement = continuationAcknowledgements.get(toolUseId);
  if (!acknowledgement || acknowledgement.settled) return false;
  acknowledgement.settled = true;
  acknowledgement.reject(error);
  return true;
}

export function clearPlanApprovalCommandBinding(toolUseId: string): void {
  commandBindings.delete(toolUseId);
  continuationAcknowledgements.delete(toolUseId);
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
    const acknowledgement = continuationAcknowledgements.get(toolUseId);
    if (acknowledgement && !acknowledgement.settled) {
      acknowledgement.settled = true;
      acknowledgement.reject(new Error(reason));
    }
    commandBindings.delete(toolUseId);
    continuationAcknowledgements.delete(toolUseId);
    entry.reject(new Error(reason));
    cancelled = true;
  }
  return cancelled;
}
