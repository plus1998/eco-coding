type ProjectSessionMap = Map<string, string>;

const sessionsByWorkspace = new Map<string, ProjectSessionMap>();

function projectSessionsFor(workspacePath: string): ProjectSessionMap {
  let projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    projectSessions = new Map();
    sessionsByWorkspace.set(workspacePath, projectSessions);
  }
  return projectSessions;
}

export function getTerminalSessionId(workspacePath: string, tabId: string): string | undefined {
  return sessionsByWorkspace.get(workspacePath)?.get(tabId);
}

export function setTerminalSessionId(workspacePath: string, tabId: string, sessionId: string): void {
  projectSessionsFor(workspacePath).set(tabId, sessionId);
}

export function deleteTerminalSessionId(workspacePath: string, tabId: string): string | undefined {
  const projectSessions = sessionsByWorkspace.get(workspacePath);
  if (!projectSessions) {
    return undefined;
  }
  const sessionId = projectSessions.get(tabId);
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
    const sessionId = projectSessions.get(tabId);
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
  const sessionIds = [...projectSessions.values()];
  sessionsByWorkspace.delete(workspacePath);
  return sessionIds;
}
