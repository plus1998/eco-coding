import fs from "node:fs/promises";
import path from "node:path";
import { evaluateBashPolicy } from "../../bash-policy/src";
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

export interface ShellCommandRequest {
  command: string;
  cwd: string;
  workspacePath: string;
}

export interface PolicyDecision {
  action: ApprovalAction;
  riskLevel: ApprovalRiskLevel;
  reason: string;
}

export function evaluateCommand(request: CommandRequest): PolicyDecision {
  return toPolicyDecision(
    evaluateBashPolicy({
      command: request.command.join(" "),
      cwd: request.cwd,
      workspacePath: request.workspacePath,
      mode: "auto",
    }),
  );
}

export function evaluateShellCommandText(request: ShellCommandRequest): PolicyDecision {
  return toPolicyDecision(
    evaluateBashPolicy({
      command: request.command,
      cwd: request.cwd,
      workspacePath: request.workspacePath,
      mode: "auto",
    }),
  );
}

function toPolicyDecision(decision: ReturnType<typeof evaluateBashPolicy>): PolicyDecision {
  return {
    action: decision.action,
    riskLevel: decision.riskLevel,
    reason: decision.reason,
  };
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

/** Direct-edit session: agent cwd is the opened workspace (no isolated worktree). */
export function createSessionPlan(workspacePath: string, threadId: string): WorktreePlan {
  const safeThreadId = threadId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const resolved = path.resolve(workspacePath);
  return {
    workspacePath: resolved,
    worktreePath: resolved,
    branchName: `eco/${safeThreadId}`,
  };
}

export function isDirectWorkspacePlan(plan: Pick<WorktreePlan, "workspacePath" | "worktreePath">): boolean {
  return path.resolve(plan.worktreePath) === path.resolve(plan.workspacePath);
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

  async isInsideWorktree(worktreePath: string): Promise<boolean> {
    const result = await this.runner.run(["git", "rev-parse", "--is-inside-work-tree"], worktreePath);
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }

  async ensureGitRepository(workspacePath: string): Promise<void> {
    const result = await this.runner.run(["git", "rev-parse", "--show-toplevel"], workspacePath);
    if (result.exitCode !== 0) {
      throw new Error(`Workspace is not a Git repository: ${result.stderr || result.stdout}`);
    }
  }

  async ensureGitHasCommits(workspacePath: string): Promise<void> {
    await this.ensureGitRepository(workspacePath);
    const result = await this.runner.run(["git", "rev-parse", "--verify", "HEAD"], workspacePath);
    if (result.exitCode !== 0) {
      throw new Error(
        'Git 仓库还没有任何提交。请先至少创建一次提交（例如 git add . && git commit -m "initial commit"），再开始编码线程。',
      );
    }
  }

  async createWorktree(plan: WorktreePlan): Promise<void> {
    await this.ensureGitHasCommits(plan.workspacePath);
    const result = await this.runner.run(
      ["git", "worktree", "add", "-B", plan.branchName, plan.worktreePath, "HEAD"],
      plan.workspacePath,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr || result.stdout}`);
    }
  }

  async removeWorktree(plan: WorktreePlan): Promise<void> {
    await this.ensureGitRepository(plan.workspacePath);

    const removeResult = await this.runner.run(
      ["git", "worktree", "remove", "--force", plan.worktreePath],
      plan.workspacePath,
    );
    if (removeResult.exitCode !== 0) {
      await this.runner.run(["git", "worktree", "prune"], plan.workspacePath);
    }

    await this.runner.run(["git", "branch", "-D", plan.branchName], plan.workspacePath);
  }

  async collectWorktreeChanges(plan: WorktreePlan): Promise<{ files: string[]; diff: string }> {
    await this.stageWorktreeChanges(plan);
    const baseSha = await this.resolveDiffBase(plan);

    const nameResult = await this.runner.run(["git", "diff", "--name-only", baseSha], plan.worktreePath);
    if (nameResult.exitCode !== 0) {
      throw new Error(formatGitCommandFailure("Failed to list changed files", nameResult));
    }
    const files = nameResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const diffResult = await this.runner.run(["git", "diff", "--binary", baseSha], plan.worktreePath);
    if (diffResult.exitCode !== 0) {
      throw new Error(`Failed to produce diff: ${diffResult.stderr || diffResult.stdout}`);
    }

    return { files, diff: diffResult.stdout };
  }

  async diff(plan: WorktreePlan): Promise<string> {
    const { diff } = await this.collectWorktreeChanges(plan);
    return diff;
  }

  async changedFiles(plan: WorktreePlan): Promise<string[]> {
    const baseSha = await this.resolveDiffBase(plan);
    const [tracked, untracked] = await Promise.all([
      this.listTrackedChangedFiles(plan, baseSha),
      this.listUntrackedFiles(plan),
    ]);
    return [...new Set([...tracked, ...untracked])];
  }

  private async listUntrackedFiles(plan: WorktreePlan): Promise<string[]> {
    const result = await this.runner.run(
      ["git", "ls-files", "--others", "--exclude-standard"],
      plan.worktreePath,
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list untracked files: ${result.stderr || result.stdout}`);
    }
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /** Stage agent edits (including new untracked files) so diff/apply can merge them. */
  private async stageWorktreeChanges(plan: WorktreePlan): Promise<void> {
    if (isDirectWorkspacePlan(plan)) {
      return;
    }

    const result = await this.runner.run(["git", "add", "-A"], plan.worktreePath);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to stage worktree changes: ${result.stderr || result.stdout}`);
    }
  }

  /** Diff base: merge point between workspace HEAD and the isolated branch (includes commits + dirty files). */
  private async resolveDiffBase(plan: WorktreePlan): Promise<string> {
    const attempts: Array<{ cwd: string; args: string[] }> = [
      { cwd: plan.workspacePath, args: ["git", "merge-base", "HEAD", plan.branchName] },
      { cwd: plan.worktreePath, args: ["git", "merge-base", "HEAD", plan.branchName] },
      { cwd: plan.worktreePath, args: ["git", "merge-base", plan.branchName, "HEAD"] },
    ];
    for (const attempt of attempts) {
      const mergeBase = await this.runner.run(attempt.args, attempt.cwd);
      if (mergeBase.exitCode === 0 && mergeBase.stdout.trim()) {
        return mergeBase.stdout.trim();
      }
    }
    return "HEAD";
  }

  private parseNameOnlyDiff(stdout: string): string[] {
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async listTrackedChangedFiles(plan: WorktreePlan, baseSha: string): Promise<string[]> {
    const diffAttempts = [
      ["git", "diff", "--name-only", baseSha],
      ["git", "diff", "--name-only", "HEAD"],
      ["git", "diff", "--name-only"],
    ] as const;

    let lastFailure = { exitCode: 1, stdout: "", stderr: "" };
    for (const args of diffAttempts) {
      const result = await this.runner.run([...args], plan.worktreePath);
      if (result.exitCode === 0) {
        return this.parseNameOnlyDiff(result.stdout);
      }
      lastFailure = result;
    }

    const status = await this.runner.run(["git", "status", "--porcelain"], plan.worktreePath);
    if (status.exitCode === 0) {
      return status.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.length >= 4 ? line.slice(3).trim() : line))
        .filter(Boolean);
    }
    lastFailure = status;

    throw new Error(formatGitCommandFailure("Failed to list changed files", lastFailure));
  }

  async discardWorktreeChanges(plan: WorktreePlan): Promise<void> {
    if (isDirectWorkspacePlan(plan)) {
      return;
    }

    const reset = await this.runner.run(["git", "reset", "--hard", "HEAD"], plan.worktreePath);
    if (reset.exitCode !== 0) {
      throw new Error(`Failed to reset worktree: ${reset.stderr || reset.stdout}`);
    }

    const clean = await this.runner.run(["git", "clean", "-fd"], plan.worktreePath);
    if (clean.exitCode !== 0) {
      throw new Error(`Failed to clean worktree: ${clean.stderr || clean.stdout}`);
    }
  }

  async applyApprovedDiff(plan: WorktreePlan): Promise<void> {
    const { files: changedFiles, diff } = await this.collectWorktreeChanges(plan);
    await this.applyWorktreeDiff(plan, diff, changedFiles);
  }

  async applyWorktreeDiff(
    plan: WorktreePlan,
    diff: string,
    changedFiles: readonly string[] = [],
  ): Promise<void> {
    if (!diff.trim() && changedFiles.length === 0) {
      return;
    }

    if (changedFiles.length > 0) {
      await this.materializeWorktreeFiles(plan, changedFiles);
      return;
    }

    if (!diff.trim()) {
      return;
    }

    const result = await this.runner.run(["git", "apply", "--whitespace=nowarn", "-"], plan.workspacePath, {
      stdin: diff,
    });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to apply approved diff: ${result.stderr || result.stdout}`);
    }
  }

  /**
   * Copy final file contents from the isolated worktree into the workspace.
   * Unlike `git apply`, this succeeds when the workspace has drifted (e.g. agent edits
   * leaked to the main checkout during multi-pass review, a known Claude Code worktree issue).
   */
  private async materializeWorktreeFiles(plan: WorktreePlan, changedFiles: readonly string[]): Promise<void> {
    for (const relPath of changedFiles) {
      const normalized = relPath.replace(/\\/g, "/");
      if (!normalized || normalized.includes("..")) {
        throw new Error(`Refusing to merge unsafe path: ${relPath}`);
      }

      const src = path.join(plan.worktreePath, normalized);
      const dest = path.join(plan.workspacePath, normalized);
      if (!isInsidePath(src, plan.worktreePath) || !isInsidePath(dest, plan.workspacePath)) {
        throw new Error(`Refusing to merge path outside workspace: ${relPath}`);
      }

      if (await pathExists(src)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
        continue;
      }

      try {
        await fs.unlink(dest);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isInsidePath(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function formatGitCommandFailure(
  prefix: string,
  result: { exitCode: number; stdout: string; stderr: string },
): string {
  const detail = result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`;
  return `${prefix}: ${detail}`;
}
