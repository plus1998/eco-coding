import type { TerminalTabKind } from "./terminal-panel-storage";

type ProjectSessionMap = Map<string, CachedTerminalSession>;

interface CachedTerminalSession {
  sessionId: string;
  kind: TerminalTabKind;
  label?: string;
  endpoint?: string;
}

/** Tab identity carried alongside the session id. */
export interface TerminalSessionIdentity {
  kind?: TerminalTabKind;
  label?: string;
  endpoint?: string;
}

export interface TerminalSessionCacheEntry {
  tabId: string;
  sessionId: string;
  kind: TerminalTabKind;
  label?: string;
  endpoint?: string;
}

const sessionsByWorkspace = new Map<string, ProjectSessionMap>();

function projectSessionsFor(workspacePath: string): ProjectSessionMap {
  let projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    projectSessions = new Map();
    sessionsByWorkspace.set(workspacePath, projectSessions);
  }
  return projectSessions;
}

function toCachedSession(sessionId: string, identity?: TerminalSessionIdentity): CachedTerminalSession {
  const label = identity?.label?.trim();
  const endpoint = identity?.endpoint?.trim();
  return {
    sessionId,
    kind: identity?.kind ?? "local",
    ...(label ? { label } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

export function getTerminalSessionId(workspacePath: string, tabId: string): string | undefined {
  return sessionsByWorkspace.get(workspacePath)?.get(tabId)?.sessionId;
}

export function setTerminalSessionId(
  workspacePath: string,
  tabId: string,
  sessionId: string,
  identity?: TerminalSessionIdentity,
): void {
  projectSessionsFor(workspacePath).set(tabId, toCachedSession(sessionId, identity));
}

export function hasTerminalSessionsForProject(workspacePath: string): boolean {
  return (sessionsByWorkspace.get(workspacePath)?.size ?? 0) > 0;
}

export function listTerminalSessionEntriesForProject(workspacePath: string): TerminalSessionCacheEntry[] {
  const projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    return [];
  }
  return [...projectSessions.entries()].map(([tabId, session]) => ({ tabId, ...session }));
}

export function replaceTerminalSessionsForProject(
  workspacePath: string,
  entries: readonly TerminalSessionCacheEntry[],
): void {
  if (entries.length === 0) {
    sessionsByWorkspace.delete(workspacePath);
    return;
  }
  const next = new Map<string, CachedTerminalSession>();
  for (const entry of entries) {
    if (!entry.tabId.trim() || !entry.sessionId.trim()) {
      continue;
    }
    next.set(entry.tabId, toCachedSession(entry.sessionId, entry));
  }
  if (next.size === 0) {
    sessionsByWorkspace.delete(workspacePath);
    return;
  }
  sessionsByWorkspace.set(workspacePath, next);
}

export function deleteTerminalSessionId(workspacePath: string, tabId: string): string | undefined {
  const projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    return undefined;
  }
  const sessionId = projectSessions.get(tabId)?.sessionId;
  projectSessions.delete(tabId);
  if (projectSessions.size === 0) {
    sessionsByWorkspace.delete(workspacePath);
  }
  return sessionId;
}

export function listTerminalSessionsForProject(
  workspacePath: string,
  tabIds: readonly string[],
): Record<string, string> {
  const projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const tabId of tabIds) {
    const sessionId = projectSessions.get(tabId)?.sessionId;
    if (sessionId) {
      next[tabId] = sessionId;
    }
  }
  return next;
}

export function clearTerminalSessionsForProject(workspacePath: string): string[] {
  const projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    return [];
  }
  const sessionIds = [...projectSessions.values()].map((session) => session.sessionId);
  sessionsByWorkspace.delete(workspacePath);
  return sessionIds;
}
