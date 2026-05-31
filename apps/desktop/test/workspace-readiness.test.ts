import { describe, expect, it } from "vitest";
import { workspaceSupportsWorktree } from "../src/shared/workspace-readiness";
import type { WorkspaceInfo } from "../src/shared/ipc";

function workspace(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    path: "/tmp/project",
    isGitRepository: false,
    hasGitCommits: false,
    dirtyFileCount: 0,
    ...overrides,
  };
}

describe("workspaceSupportsWorktree", () => {
  it("returns false when not a git repository", () => {
    expect(workspaceSupportsWorktree(workspace())).toBe(false);
  });

  it("returns false when git repo has no commits", () => {
    expect(
      workspaceSupportsWorktree(workspace({ isGitRepository: true, hasGitCommits: false })),
    ).toBe(false);
  });

  it("returns true when git repo has commits", () => {
    expect(
      workspaceSupportsWorktree(workspace({ isGitRepository: true, hasGitCommits: true })),
    ).toBe(true);
  });
});
