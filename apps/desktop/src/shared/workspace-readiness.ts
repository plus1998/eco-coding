import type { WorkspaceInfo } from "./ipc";

/** Git repo with at least one commit — required for isolated worktrees. */
export function workspaceSupportsWorktree(workspace: WorkspaceInfo): boolean {
  return workspace.isGitRepository && workspace.hasGitCommits === true;
}
