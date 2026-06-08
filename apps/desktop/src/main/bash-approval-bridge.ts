import type { BashApprovalDecision, BashApprovalRequest } from "../shared/ipc";

interface PendingBashApproval {
  threadId: string;
  request: BashApprovalRequest;
  resolve: (decision: BashApprovalDecision) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingBashApproval>();

export function registerPendingBashApproval(
  threadId: string,
  request: BashApprovalRequest,
): Promise<BashApprovalDecision> {
  if (pending.has(request.toolUseId)) {
    return Promise.reject(new Error(`Bash approval ${request.toolUseId} is already pending.`));
  }

  return new Promise<BashApprovalDecision>((resolve, reject) => {
    pending.set(request.toolUseId, {
      threadId,
      request,
      resolve,
      reject,
    });
  });
}

export function getPendingBashApprovalForThread(threadId: string): BashApprovalRequest | undefined {
  for (const entry of pending.values()) {
    if (entry.threadId === threadId) {
      return entry.request;
    }
  }
  return undefined;
}

export function getPendingBashApprovalByToolUseId(toolUseId: string): BashApprovalRequest | undefined {
  return pending.get(toolUseId)?.request;
}

export function resolvePendingBashApproval(toolUseId: string, decision: BashApprovalDecision): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) {
    return false;
  }
  pending.delete(toolUseId);
  entry.resolve(decision);
  return true;
}

export function cancelBashApprovalsForThread(threadId: string, reason: string): void {
  for (const [toolUseId, entry] of pending) {
    if (entry.threadId !== threadId) {
      continue;
    }
    pending.delete(toolUseId);
    entry.reject(new Error(reason));
  }
}
