import { useCallback, useSyncExternalStore } from "react";
import { i18n } from "./i18n";

export type WorkspaceGitActionPhase = "generating" | "committing" | "pushing";

export interface WorkspaceGitActionSnapshot {
  phase: WorkspaceGitActionPhase;
  operationId: number;
}

const actionsByWorkspace = new Map<string, WorkspaceGitActionSnapshot>();
const listenersByWorkspace = new Map<string, Set<() => void>>();
let nextOperationId = 1;

function notify(workspacePath: string): void {
  for (const listener of listenersByWorkspace.get(workspacePath) ?? []) {
    listener();
  }
}

export function getWorkspaceGitCommitEntryLabel(phase: WorkspaceGitActionPhase | null | undefined): string {
  switch (phase) {
    case "generating":
      return i18n.t("workspaceGit.action.generating");
    case "committing":
      return i18n.t("workspaceGit.action.committing");
    case "pushing":
      return i18n.t("workspaceGit.action.pushing");
    default:
      return i18n.t("workspaceGit.action.commitOrPush");
  }
}

export interface WorkspaceGitActionSettlement {
  shouldRefresh: boolean;
  shouldClose: boolean;
  errorMessage?: string;
}

/**
 * Decide post-action UI settlement for commit/push flows.
 * - Full success: refresh once and close.
 * - Commit succeeded but a later step failed (e.g. push): refresh once, keep dialog open with the action error.
 * - Failure before any commit: no refresh, keep dialog open with the action error.
 */
export function planWorkspaceGitActionSettlement(input: {
  actionError?: string;
  committedSuccessfully: boolean;
}): WorkspaceGitActionSettlement {
  if (input.actionError) {
    return {
      shouldRefresh: input.committedSuccessfully,
      shouldClose: false,
      errorMessage: input.actionError,
    };
  }
  return {
    shouldRefresh: true,
    shouldClose: true,
  };
}

export function getWorkspaceGitActionSnapshot(
  workspacePath: string | undefined,
): WorkspaceGitActionSnapshot | null {
  if (!workspacePath) {
    return null;
  }
  return actionsByWorkspace.get(workspacePath) ?? null;
}

export function subscribeWorkspaceGitAction(workspacePath: string, listener: () => void): () => void {
  const listeners = listenersByWorkspace.get(workspacePath) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByWorkspace.set(workspacePath, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByWorkspace.delete(workspacePath);
    }
  };
}

/** Start a workspace-scoped operation. Returns null when one is already running. */
export function beginWorkspaceGitAction(
  workspacePath: string,
  phase: WorkspaceGitActionPhase,
): number | null {
  if (actionsByWorkspace.has(workspacePath)) {
    return null;
  }
  const operationId = nextOperationId++;
  actionsByWorkspace.set(workspacePath, { phase, operationId });
  notify(workspacePath);
  return operationId;
}

export function setWorkspaceGitActionPhase(
  workspacePath: string,
  operationId: number,
  phase: WorkspaceGitActionPhase,
): boolean {
  const current = actionsByWorkspace.get(workspacePath);
  if (!current || current.operationId !== operationId) {
    return false;
  }
  if (current.phase === phase) {
    return true;
  }
  actionsByWorkspace.set(workspacePath, { phase, operationId });
  notify(workspacePath);
  return true;
}

/** Clear only the operation that started with this token. */
export function clearWorkspaceGitAction(workspacePath: string, operationId: number): boolean {
  const current = actionsByWorkspace.get(workspacePath);
  if (!current || current.operationId !== operationId) {
    return false;
  }
  actionsByWorkspace.delete(workspacePath);
  notify(workspacePath);
  return true;
}

/** Test helper: wipe all in-memory workspace action state. */
export function resetWorkspaceGitActionStore(): void {
  actionsByWorkspace.clear();
  listenersByWorkspace.clear();
  nextOperationId = 1;
}

export function useWorkspaceGitAction(workspacePath: string | undefined): WorkspaceGitActionSnapshot | null {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!workspacePath) {
        return () => undefined;
      }
      return subscribeWorkspaceGitAction(workspacePath, listener);
    },
    [workspacePath],
  );
  const getSnapshot = useCallback(() => getWorkspaceGitActionSnapshot(workspacePath), [workspacePath]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
