import type { WorktreePlan } from "@eco/workspace";

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

export function parseThreadCancelRequest(payload: unknown): {
  threadId: string;
  worktreeDisposition?: WorktreeCancelDisposition;
} | null {
  if (typeof payload === "string") {
    const threadId = payload.trim();
    return threadId ? { threadId } : null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const threadId = typeof record.threadId === "string" ? record.threadId.trim() : "";
  if (!threadId) {
    return null;
  }
  return { threadId };
}
