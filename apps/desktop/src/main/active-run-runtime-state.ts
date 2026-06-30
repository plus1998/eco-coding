import type { WorktreePlan } from "@eco/workspace";

export interface ActiveRunRuntimeStateInput {
  controller: AbortController;
  worktreePlan?: WorktreePlan;
}

interface ActiveRunRuntimeState {
  controller: AbortController;
  worktreePlan?: WorktreePlan;
  bashRememberPrefixes: string[];
}

export class ActiveRunRuntimeStateStore {
  private readonly runs = new Map<string, ActiveRunRuntimeState>();

  startRun(threadId: string, input: ActiveRunRuntimeStateInput): void {
    this.runs.set(threadId, {
      controller: input.controller,
      bashRememberPrefixes: [],
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

  bashRememberPrefixes(threadId: string): readonly string[] {
    return this.runs.get(threadId)?.bashRememberPrefixes ?? [];
  }

  rememberBashPrefix(threadId: string, prefix: string): void {
    const trimmed = prefix.trim();
    if (!trimmed) {
      return;
    }
    const run = this.runs.get(threadId);
    if (!run) {
      return;
    }
    if (run.bashRememberPrefixes.includes(trimmed)) {
      return;
    }
    run.bashRememberPrefixes.push(trimmed);
  }
}
