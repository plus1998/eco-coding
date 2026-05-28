import path from "node:path";
import type { ApprovalRiskLevel } from "../../shared/src";

export type ApprovalAction = "allow" | "ask" | "deny";

export interface CommandRequest {
  command: string[];
  cwd: string;
  workspacePath: string;
}

export interface FileWriteRequest {
  filePath: string;
  workspacePath: string;
}

export interface PolicyDecision {
  action: ApprovalAction;
  riskLevel: ApprovalRiskLevel;
  reason: string;
}

const PACKAGE_INSTALL_COMMANDS = new Set(["npm", "pnpm", "yarn", "bun"]);
const PACKAGE_INSTALL_ARGS = new Set(["install", "i", "add", "remove"]);
const ALWAYS_ASK_COMMANDS = new Set(["docker", "sudo"]);

export function evaluateCommand(request: CommandRequest): PolicyDecision {
  const [program, ...args] = request.command;
  if (!program) {
    return { action: "deny", riskLevel: "high", reason: "Empty command is not allowed" };
  }

  if (!isInsidePath(request.cwd, request.workspacePath)) {
    return {
      action: "deny",
      riskLevel: "critical",
      reason: "Command cwd is outside the workspace",
    };
  }

  if (program === "rm") {
    return { action: "ask", riskLevel: "critical", reason: "File deletion requires approval" };
  }

  if (program === "git" && args[0] === "reset") {
    return { action: "ask", riskLevel: "critical", reason: "git reset requires approval" };
  }

  if (program === "git" && args[0] === "clean") {
    return { action: "ask", riskLevel: "high", reason: "git clean can delete files" };
  }

  if (PACKAGE_INSTALL_COMMANDS.has(program) && args.some((arg) => PACKAGE_INSTALL_ARGS.has(arg))) {
    return {
      action: "ask",
      riskLevel: "medium",
      reason: "Dependency changes require approval",
    };
  }

  if (ALWAYS_ASK_COMMANDS.has(program)) {
    return { action: "ask", riskLevel: "high", reason: `${program} requires approval` };
  }

  return { action: "allow", riskLevel: "low", reason: "Command is allowed by default policy" };
}

export function evaluateFileWrite(request: FileWriteRequest): PolicyDecision {
  if (!isInsidePath(request.filePath, request.workspacePath)) {
    return {
      action: "deny",
      riskLevel: "critical",
      reason: "File write is outside the workspace",
    };
  }

  return {
    action: "allow",
    riskLevel: "low",
    reason: "File write is inside the workspace",
  };
}

export interface WorktreePlan {
  workspacePath: string;
  worktreePath: string;
  branchName: string;
}

export function createWorktreePlan(workspacePath: string, threadId: string): WorktreePlan {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9._-]/g, "-");
  return {
    workspacePath,
    worktreePath: path.join(workspacePath, ".eco", "worktrees", safeThreadId),
    branchName: `eco/${safeThreadId}`,
  };
}

export interface CommandRunner {
  run(
    command: string[],
    cwd: string,
    options?: { stdin?: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export class GitWorktreeService {
  constructor(private readonly runner: CommandRunner) {}

  async ensureGitRepository(workspacePath: string): Promise<void> {
    const result = await this.runner.run(["git", "rev-parse", "--show-toplevel"], workspacePath);
    if (result.exitCode !== 0) {
      throw new Error(`Workspace is not a Git repository: ${result.stderr || result.stdout}`);
    }
  }

  async createWorktree(plan: WorktreePlan): Promise<void> {
    await this.ensureGitRepository(plan.workspacePath);
    const result = await this.runner.run(
      ["git", "worktree", "add", "-B", plan.branchName, plan.worktreePath, "HEAD"],
      plan.workspacePath,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr || result.stdout}`);
    }
  }

  async diff(plan: WorktreePlan): Promise<string> {
    const result = await this.runner.run(["git", "diff", "--binary", "HEAD"], plan.worktreePath);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to produce diff: ${result.stderr || result.stdout}`);
    }
    return result.stdout;
  }

  async changedFiles(plan: WorktreePlan): Promise<string[]> {
    const result = await this.runner.run(["git", "diff", "--name-only", "HEAD"], plan.worktreePath);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list changed files: ${result.stderr || result.stdout}`);
    }
    return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  async applyApprovedDiff(plan: WorktreePlan): Promise<void> {
    const diff = await this.diff(plan);
    if (!diff.trim()) {
      return;
    }

    const result = await this.runner.run(
      ["git", "apply", "--whitespace=nowarn", "-"],
      plan.workspacePath,
      { stdin: diff },
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to apply approved diff: ${result.stderr || result.stdout}`);
    }
  }
}

export function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
