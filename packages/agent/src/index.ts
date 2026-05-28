import type { AgentRole, AgentRoleRoute, ModelProfile } from "../../shared/src";
import { resolveModelRoute, type ResolvedModelRoute } from "../../model-router/src";
import type { RunningThread, ThreadStartRequest, ThreadSupervisor } from "../../runtime/src";
import { createWorktreePlan, type GitWorktreeService, type WorktreePlan } from "../../workspace/src";

export interface StartThreadInput {
  threadId: string;
  title: string;
  workspacePath: string;
  prompt: string;
  roles: AgentRole[];
  roleRoutes: AgentRoleRoute[];
  modelProfiles: ModelProfile[];
}

export interface StartThreadResult {
  running: RunningThread;
  worktree: WorktreePlan;
  routes: ResolvedModelRoute[];
}

export class ThreadOrchestrator {
  constructor(
    private readonly supervisor: ThreadSupervisor,
    private readonly worktreeService: Pick<GitWorktreeService, "createWorktree">,
  ) {}

  async start(input: StartThreadInput): Promise<StartThreadResult> {
    const routes = resolveRoutes(input.roles, input.roleRoutes, input.modelProfiles);
    const worktree = createWorktreePlan(input.workspacePath, input.threadId);
    await this.worktreeService.createWorktree(worktree);

    const request: ThreadStartRequest = {
      threadId: input.threadId,
      title: input.title,
      workspacePath: input.workspacePath,
      prompt: input.prompt,
      routes,
      worktree,
    };

    return {
      running: this.supervisor.startThread(request),
      worktree,
      routes,
    };
  }
}

export function resolveRoutes(
  roles: readonly AgentRole[],
  roleRoutes: readonly AgentRoleRoute[],
  modelProfiles: readonly ModelProfile[],
): ResolvedModelRoute[] {
  return roles.map((role) => {
    const resolution = resolveModelRoute(role, roleRoutes, modelProfiles);
    if (!resolution.ok) {
      throw new Error(resolution.failure.reason);
    }
    return resolution.route;
  });
}
