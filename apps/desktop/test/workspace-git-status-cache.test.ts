import { expect, test } from "bun:test";
import type { GitWorkingTreeStatus } from "../src/shared/ipc";
import {
  cacheWorkspaceGitStatus,
  readFreshWorkspaceGitStatus,
  shouldRefreshWorkspaceGitStatus,
  WORKSPACE_GIT_STATUS_CACHE_TTL_MS,
} from "../src/renderer/workspace-git-status-cache";

function status(workspacePath: string, insertions: number): GitWorkingTreeStatus {
  return {
    workspacePath,
    isGitRepository: true,
    hasGitCommits: true,
    dirtyFileCount: 1,
    insertions,
    deletions: 0,
    canCommit: true,
    aheadCount: 0,
    behindCount: 0,
    hasUpstream: false,
    branches: ["main"],
    branch: "main",
  };
}

test("workspace git status cache isolates projects", () => {
  let cache = {};
  cache = cacheWorkspaceGitStatus(cache, "/repo/a", status("/repo/a", 10), 1_000);
  cache = cacheWorkspaceGitStatus(cache, "/repo/b", status("/repo/b", 20), 1_000);

  expect(readFreshWorkspaceGitStatus(cache, "/repo/a", 2_000)?.insertions).toBe(10);
  expect(readFreshWorkspaceGitStatus(cache, "/repo/b", 2_000)?.insertions).toBe(20);
  expect(readFreshWorkspaceGitStatus(cache, "/repo/c", 2_000)).toBeUndefined();
});

test("workspace git status cache expires after one minute", () => {
  const cache = cacheWorkspaceGitStatus({}, "/repo/a", status("/repo/a", 10), 1_000);

  expect(
    readFreshWorkspaceGitStatus(cache, "/repo/a", 1_000 + WORKSPACE_GIT_STATUS_CACHE_TTL_MS - 1),
  ).toBeDefined();
  expect(
    readFreshWorkspaceGitStatus(cache, "/repo/a", 1_000 + WORKSPACE_GIT_STATUS_CACHE_TTL_MS),
  ).toBeUndefined();
});

test("forced workspace git status refresh ignores a fresh cache entry", () => {
  const cache = cacheWorkspaceGitStatus({}, "/repo/a", status("/repo/a", 10), 1_000);

  expect(shouldRefreshWorkspaceGitStatus(cache, "/repo/a", 2_000)).toBe(false);
  expect(shouldRefreshWorkspaceGitStatus(cache, "/repo/a", 2_000, true)).toBe(true);
});
