import type { WorktreePlan } from "@eco/workspace";

export interface ActiveRunRuntimeStateInput {
  controller: AbortController;
  worktreePlan?: WorktreePlan;
}

interface ActiveRunRuntimeState {
  controller: AbortController;
  worktreePlan?: WorktreePlan;
}

export class ActiveRunRuntimeStateStore {
  private readonly runs = new Map<string, ActiveRunRuntimeState>();

  startRun(threadId: string, input: ActiveRunRuntimeStateInput): void {
    this.runs.set(threadId, {
      controller: input.controller,
      ...(input.worktreePlan && { worktreePlan: input.worktreePlan }),
    });
  }

  finishRun(threadId: string): void {
    this.runs.delete(threadId);
  }

  hasRun(threadId: string): boolean {
    return this.runs.has(threadId);
  }

  abortRun(threadId: string, reason: string): boolean {
    const run = this.runs.get(threadId);
    if (!run) {
      return false;
    }
    run.controller.abort(reason);
    return true;
  }

  worktreePlan(threadId: string): WorktreePlan | undefined {
    return this.runs.get(threadId)?.worktreePlan;
  }

  setWorktreePlan(threadId: string, worktreePlan: WorktreePlan): void {
    const run = this.runs.get(threadId);
    if (!run) {
      return;
    }
    run.worktreePlan = worktreePlan;
  }
}
