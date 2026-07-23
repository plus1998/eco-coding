import type { GitWorkingTreeStatus } from "../shared/ipc";

export const WORKSPACE_GIT_STATUS_CACHE_TTL_MS = 60_000;

export interface WorkspaceGitStatusCacheEntry {
  status: GitWorkingTreeStatus;
  fetchedAt: number;
}

export type WorkspaceGitStatusCache = Record<string, WorkspaceGitStatusCacheEntry>;

export function readFreshWorkspaceGitStatus(
  cache: WorkspaceGitStatusCache,
  workspacePath: string,
  now: number,
  ttlMs = WORKSPACE_GIT_STATUS_CACHE_TTL_MS,
): GitWorkingTreeStatus | undefined {
  const entry = cache[workspacePath];
  if (!entry || now - entry.fetchedAt >= ttlMs) {
    return undefined;
  }
  return entry.status;
}

export function shouldRefreshWorkspaceGitStatus(
  cache: WorkspaceGitStatusCache,
  workspacePath: string,
  now: number,
  force = false,
): boolean {
  return force || readFreshWorkspaceGitStatus(cache, workspacePath, now) === undefined;
}

export function cacheWorkspaceGitStatus(
  cache: WorkspaceGitStatusCache,
  workspacePath: string,
  status: GitWorkingTreeStatus,
  fetchedAt: number,
): WorkspaceGitStatusCache {
  return {
    ...cache,
    [workspacePath]: { status, fetchedAt },
  };
}
