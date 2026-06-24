import { expect, test } from "bun:test";

import {
  gitStatusToSummary,
  workspaceGitStatusFingerprint,
} from "../src/main/workspace-git-status-publisher";
import type { GitWorkingTreeStatus } from "../src/shared/ipc";

function makeStatus(overrides: Partial<GitWorkingTreeStatus> = {}): GitWorkingTreeStatus {
  return {
    workspacePath: "/tmp/repo",
    isGitRepository: true,
    hasGitCommits: true,
    branches: ["main"],
    dirtyFileCount: 2,
    insertions: 10,
    deletions: 3,
    canCommit: true,
    aheadCount: 0,
    behindCount: 0,
    hasUpstream: true,
    ...overrides,
  };
}

test("workspaceGitStatusFingerprint changes only when summary stats change", () => {
  const first = workspaceGitStatusFingerprint(gitStatusToSummary(makeStatus()));
  const same = workspaceGitStatusFingerprint(
    gitStatusToSummary(makeStatus({ branch: "feature" })),
  );
  const changed = workspaceGitStatusFingerprint(
    gitStatusToSummary(makeStatus({ dirtyFileCount: 3 })),
  );

  expect(same).toBe(first);
  expect(changed).not.toBe(first);
});

test("gitStatusToSummary keeps only pill fields", () => {
  expect(gitStatusToSummary(makeStatus())).toEqual({
    workspacePath: "/tmp/repo",
    dirtyFileCount: 2,
    insertions: 10,
    deletions: 3,
  });
});
