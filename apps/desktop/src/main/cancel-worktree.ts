import type { WorktreePlan } from "@eco/workspace";
import type { WorktreeCancelDisposition } from "../shared/ipc";

export interface FinalizeCancelledRunDeps {
  isIsolatedWorktreePlan: (plan: Pick<WorktreePlan, "workspacePath" | "worktreePath">) => boolean;
  changedFiles: (plan: WorktreePlan) => Promise<string[]>;
  applyWorktreeChanges: (
    plan: WorktreePlan,
  ) => Promise<{ files: string[]; message: string; diff: string }>;
  saveAppliedDiff: (threadId: string, workspacePath: string, diff: string, files: string[]) => void;
  discardWorktreeChanges: (plan: WorktreePlan) => Promise<void>;
  cleanupWorktreeForThread: (threadId: string) => Promise<void>;
  updateThread: (threadId: string, patch: { status: "idle" | "completed"; message: string }) => void;
  emitThreadEvent: (
    threadId: string,
    type: string,
    message: string,
    role: "system",
  ) => void;
}

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

/** When the UI did not send a disposition, keep changes if any exist; otherwise allow cleanup. */
export async function resolveCancelDisposition(
  plan: WorktreePlan,
  explicit: WorktreeCancelDisposition | undefined,
  changedFiles: (plan: WorktreePlan) => Promise<string[]>,
): Promise<WorktreeCancelDisposition> {
  if (explicit) {
    return explicit;
  }
  const files = await changedFiles(plan);
  return files.length > 0 ? "keep" : "discard";
}

export async function finalizeCancelledRun(
  threadId: string,
  worktreePlan: WorktreePlan,
  explicitDisposition: WorktreeCancelDisposition | undefined,
  deps: FinalizeCancelledRunDeps,
): Promise<void> {
  if (!deps.isIsolatedWorktreePlan(worktreePlan)) {
    deps.updateThread(threadId, { status: "idle", message: "已取消。" });
    return;
  }

  const disposition = await resolveCancelDisposition(
    worktreePlan,
    explicitDisposition,
    deps.changedFiles,
  );

  switch (disposition) {
    case "apply": {
      try {
        const { files, message, diff } = await deps.applyWorktreeChanges(worktreePlan);
        deps.saveAppliedDiff(threadId, worktreePlan.workspacePath, diff, files);
        await deps.cleanupWorktreeForThread(threadId);
        deps.updateThread(threadId, { status: "completed", message });
        deps.emitThreadEvent(threadId, "worktree.applied", message, "system");
      } catch (applyError) {
        const detail = applyError instanceof Error ? applyError.message : String(applyError);
        deps.updateThread(threadId, {
          status: "idle",
          message: `已停止，但合并到工作区失败：${detail}。可在右侧「应用到工作区」重试。`,
        });
        deps.emitThreadEvent(threadId, "worktree.apply_failed", detail, "system");
      }
      return;
    }
    case "discard": {
      try {
        await deps.discardWorktreeChanges(worktreePlan);
        deps.emitThreadEvent(threadId, "worktree.restored", "已丢弃隔离工作树中的更改。", "system");
      } catch (error) {
        console.error("Failed to discard worktree on cancel:", error);
      }
      await deps.cleanupWorktreeForThread(threadId);
      deps.updateThread(threadId, {
        status: "idle",
        message: "已取消，隔离工作树更改已丢弃。",
      });
      return;
    }
    case "keep":
    default: {
      deps.updateThread(threadId, {
        status: "idle",
        message: "已停止。可在右侧「应用到工作区」合并更改。",
      });
      deps.emitThreadEvent(threadId, "thread.idle", "已停止。", "system");
    }
  }
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
  const disposition = record.worktreeDisposition;
  if (
    disposition === "apply" ||
    disposition === "keep" ||
    disposition === "discard"
  ) {
    return { threadId, worktreeDisposition: disposition };
  }
  return { threadId };
}
