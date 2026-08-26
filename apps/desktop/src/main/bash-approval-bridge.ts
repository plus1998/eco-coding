import type { BashApprovalDecision, BashApprovalRequest } from "../shared/ipc";

export interface BashApprovalResolution {
  decision: BashApprovalDecision;
  feedback?: string;
}

interface PendingBashApproval {
  threadId: string;
  request: BashApprovalRequest;
  resolve: (resolution: BashApprovalResolution) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingBashApproval>();

export function buildResolvedBashApprovalThreadPatch(_decision: BashApprovalDecision): {
  status: "running";
  message: string;
} {
  return {
    status: "running",
    message: "",
  };
}

export function registerPendingBashApproval(
  threadId: string,
  request: BashApprovalRequest,
): Promise<BashApprovalResolution> {
  if (pending.has(request.toolUseId)) {
    return Promise.reject(new Error(`Bash approval ${request.toolUseId} is already pending.`));
  }

  return new Promise<BashApprovalResolution>((resolve, reject) => {
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

export function listPendingBashApprovalsForThread(threadId: string): BashApprovalRequest[] {
  const requests: BashApprovalRequest[] = [];
  for (const entry of pending.values()) {
    if (entry.threadId === threadId) {
      requests.push(entry.request);
    }
  }
  return requests;
}

export function getPendingBashApprovalByToolUseId(toolUseId: string): BashApprovalRequest | undefined {
  return pending.get(toolUseId)?.request;
}

export function resolvePendingBashApproval(toolUseId: string, resolution: BashApprovalResolution): boolean {
  const entry = pending.get(toolUseId);
  if (!entry) {
    return false;
  }
  pending.delete(toolUseId);
  entry.resolve(resolution);
  return true;
}

/**
 * Mid-run switch to Eco「完全访问」: host-approve every parked execution card for the thread.
 * Does not touch plan approvals. Uses one-shot `approved` (no remember-prefix / session grant).
 */
export function approveAllPendingBashApprovalsForThread(threadId: string): BashApprovalRequest[] {
  const approved: BashApprovalRequest[] = [];
  for (const [toolUseId, entry] of pending) {
    if (entry.threadId !== threadId) {
      continue;
    }
    pending.delete(toolUseId);
    entry.resolve({ decision: "approved" });
    approved.push(entry.request);
  }
  return approved;
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
