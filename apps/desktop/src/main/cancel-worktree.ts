import type { WorktreePlan } from "@eco/workspace";
import type { ThreadCancelRequest } from "../shared/ipc";

export interface FinalizeCancelledRunDeps {
  updateThread: (threadId: string, patch: { status: "idle" | "completed"; message: string }) => void;
}

/** @deprecated Worktree dispositions removed; cancel always keeps the SDK session checkpoint. */
export type WorktreeCancelDisposition = "apply" | "keep" | "discard";

export function takePendingCancelDisposition(
  pending: Map<string, WorktreeCancelDisposition>,
  threadId: string,
): WorktreeCancelDisposition | undefined {
  const disposition = pending.get(threadId);
  if (disposition) {
    pending.delete(threadId);
  }
  return disposition;
}

export async function finalizeCancelledRun(
  threadId: string,
  _worktreePlan: WorktreePlan,
  _explicitDisposition: WorktreeCancelDisposition | undefined,
  deps: FinalizeCancelledRunDeps,
  _message = "",
): Promise<void> {
  deps.updateThread(threadId, {
    status: "idle",
    message: "",
  });
}

export function parseThreadCancelRequest(payload: unknown): ThreadCancelRequest | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const principalId = typeof record.principalId === "string" ? record.principalId.trim() : "";
  const clientCommandId = typeof record.clientCommandId === "string" ? record.clientCommandId.trim() : "";
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  const expectedHistoryRevision = record.expectedHistoryRevision;
  if (
    !principalId ||
    !clientCommandId ||
    !threadId ||
    typeof expectedHistoryRevision !== "number" ||
    !Number.isSafeInteger(expectedHistoryRevision) ||
    expectedHistoryRevision < 0
  ) {
    return null;
  }
  const worktreeDisposition = record.worktreeDisposition;
  if (
    worktreeDisposition !== undefined &&
    worktreeDisposition !== "apply" &&
    worktreeDisposition !== "keep" &&
    worktreeDisposition !== "discard"
  ) {
    return null;
  }
  return {
    principalId,
    clientCommandId,
    threadId,
    expectedHistoryRevision,
    ...(worktreeDisposition ? { worktreeDisposition } : {}),
  };
}
