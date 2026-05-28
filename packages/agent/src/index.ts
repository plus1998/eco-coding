import type { ApprovalService } from "../../approval/src";
import { type ResolvedModelRoute, resolveModelRoute } from "../../model-router/src";
import type {
  RunningThread,
  SdkToolPermissionDecision,
  SdkToolPermissionRequest,
  ThreadStartRequest,
  ThreadSupervisor,
} from "../../runtime/src";
import type { AgentRole, AgentRoleRoute, ModelProfile } from "../../shared/src";
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

export interface ApprovalBackedPermissionOptions {
  approvalService: ApprovalService;
  threadId: string;
  workspacePath: string;
  cwd: string;
}

export function createApprovalBackedPermissionHandler(options: ApprovalBackedPermissionOptions) {
  return async (request: SdkToolPermissionRequest): Promise<SdkToolPermissionDecision> => {
    const context = {
      threadId: options.threadId,
      agentId: request.agentId ?? "sdk",
    };

    if (request.toolName === "Bash" && typeof request.input.command === "string") {
      const approval = await options.approvalService.requestForShellCommand(context, {
        command: request.input.command,
        cwd: options.cwd,
        workspacePath: options.workspacePath,
      });

      if (approval) {
        return {
          behavior: "deny",
          message: `Approval required: ${approval.reason}`,
          interrupt: approval.decision === "pending",
        };
      }
    }

    const filePath = extractFilePath(request.input);
    if ((request.toolName === "Write" || request.toolName === "Edit") && filePath) {
      const approval = await options.approvalService.requestForFileWrite(context, {
        filePath,
        workspacePath: options.workspacePath,
      });

      if (approval) {
        return {
          behavior: "deny",
          message: `Approval required: ${approval.reason}`,
          interrupt: approval.decision === "pending",
        };
      }
    }

    return { behavior: "allow", updatedInput: request.input };
  };
}

function extractFilePath(input: Record<string, unknown>): string | undefined {
  for (const key of ["file_path", "filePath", "path"]) {
    if (typeof input[key] === "string") {
      return input[key];
    }
  }
  return undefined;
}
