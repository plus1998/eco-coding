const STORAGE_KEY = "eco.terminal";
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

export interface TerminalTabRecord {
  id: string;
  label: string;
}

export interface ProjectTerminalState {
  open: boolean;
  height: number;
  tabs: TerminalTabRecord[];
  activeTabId: string;
}

export type TerminalWorkspaceState = Record<string, ProjectTerminalState>;

export function createTerminalTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createTerminalTab(label: string): TerminalTabRecord {
  return {
    id: createTerminalTabId(),
    label: label.trim() || "终端",
  };
}

export function createProjectTerminalState(label: string, open = true): ProjectTerminalState {
  const tab = createTerminalTab(label);
  return {
    open,
    height: DEFAULT_HEIGHT,
    tabs: [tab],
    activeTabId: tab.id,
  };
}

function normalizeHeight(height: unknown): number {
  if (typeof height !== "number" || !Number.isFinite(height)) {
    return DEFAULT_HEIGHT;
  }
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));
}

function normalizeTab(value: unknown): TerminalTabRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Partial<TerminalTabRecord>;
  if (typeof record.id !== "string" || !record.id.trim()) {
    return undefined;
  }
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : "终端";
  return { id: record.id.trim(), label };
}

function normalizeProjectTerminalState(value: unknown, fallbackLabel: string): ProjectTerminalState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Partial<ProjectTerminalState>;
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map(normalizeTab).filter((tab): tab is TerminalTabRecord => tab !== undefined)
    : [];
  if (tabs.length === 0) {
    return createProjectTerminalState(fallbackLabel, record.open === true);
  }
  const activeTabId =
    typeof record.activeTabId === "string" && tabs.some((tab) => tab.id === record.activeTabId)
      ? record.activeTabId
      : tabs[0]!.id;
  return {
    open: record.open === true,
    height: normalizeHeight(record.height),
    tabs,
    activeTabId,
  };
}

export function readTerminalWorkspaceState(): TerminalWorkspaceState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as {
      projects?: unknown;
      open?: boolean;
      height?: number;
    };
    if (parsed.projects && typeof parsed.projects === "object") {
      const next: TerminalWorkspaceState = {};
      for (const [workspacePath, state] of Object.entries(parsed.projects)) {
        if (typeof workspacePath !== "string" || !workspacePath.trim()) {
          continue;
        }
        const normalized = normalizeProjectTerminalState(state, workspacePath);
        if (normalized) {
          next[workspacePath] = normalized;
        }
      }
      return next;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveTerminalWorkspaceState(state: TerminalWorkspaceState): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      projects: state,
    }),
  );
}

export function getProjectTerminalState(
  state: TerminalWorkspaceState,
  workspacePath: string,
): ProjectTerminalState | undefined {
  return state[workspacePath];
}

export function clampTerminalHeight(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(height)));
}

export function nextTerminalTabLabel(workspaceLabel: string, existingTabs: TerminalTabRecord[]): string {
  const base = workspaceLabel.trim() || "终端";
  const taken = new Set(existingTabs.map((tab) => tab.label));
  if (!taken.has(base)) {
    return base;
  }
  let index = 2;
  while (taken.has(`${base} ${index}`)) {
    index += 1;
  }
  return `${base} ${index}`;
}

export { DEFAULT_HEIGHT as DEFAULT_TERMINAL_HEIGHT, MIN_HEIGHT as MIN_TERMINAL_HEIGHT };
