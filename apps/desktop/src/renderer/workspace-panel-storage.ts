const STORAGE_KEY = "eco.workspace-panel";

export interface ProjectWorkspacePanelState {
  open: boolean;
}

export type WorkspacePanelWorkspaceState = Record<string, ProjectWorkspacePanelState>;

export function createProjectWorkspacePanelState(open = false): ProjectWorkspacePanelState {
  return { open };
}

export function readWorkspacePanelWorkspaceState(): WorkspacePanelWorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const result: WorkspacePanelWorkspaceState = {};
    for (const [path, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const record = value as Partial<ProjectWorkspacePanelState>;
      result[path] = { open: record.open === true };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveWorkspacePanelWorkspaceState(state: WorkspacePanelWorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

export function getProjectWorkspacePanelState(
  state: WorkspacePanelWorkspaceState,
  workspacePath: string,
): ProjectWorkspacePanelState | undefined {
  return state[workspacePath];
}
