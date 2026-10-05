import { i18n } from "./i18n";

const STORAGE_KEY = "eco.terminal";
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

/**
 * A tab is either a local shell or an SSH session. The tab strip renders a
 * different glyph per kind so a stack of tabs stays readable.
 */
export type TerminalTabKind = "local" | "ssh";

export interface TerminalTabRecord {
  id: string;
  label: string;
  kind: TerminalTabKind;
  /** SSH endpoint (`user@host[:port]`) shown in the tab tooltip. */
  endpoint?: string;
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

export function createTerminalTab(
  label: string,
  kind: TerminalTabKind = "local",
  endpoint?: string,
): TerminalTabRecord {
  const trimmedEndpoint = endpoint?.trim();
  return {
    id: createTerminalTabId(),
    label: label.trim() || i18n.t("terminal.title"),
    kind,
    ...(kind === "ssh" && trimmedEndpoint ? { endpoint: trimmedEndpoint } : {}),
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
  const label =
    typeof record.label === "string" && record.label.trim() ? record.label.trim() : i18n.t("terminal.title");
  const kind = record.kind === "ssh" ? "ssh" : "local";
  const endpoint = kind === "ssh" && typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  return {
    id: record.id.trim(),
    label,
    kind,
    ...(endpoint ? { endpoint } : {}),
  };
}

function normalizeProjectTerminalState(
  value: unknown,
  fallbackLabel: string,
): ProjectTerminalState | undefined {
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

function withUniqueLabel(base: string, existingTabs: TerminalTabRecord[]): string {
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

export function nextTerminalTabLabel(workspaceLabel: string, existingTabs: TerminalTabRecord[]): string {
  return withUniqueLabel(workspaceLabel.trim() || i18n.t("terminal.title"), existingTabs);
}

export interface InjectedTerminalSessionIdentity {
  kind?: TerminalTabKind;
  label?: string;
  endpoint?: string;
}

/**
 * Bind an injected PTY (npm script / background task / SSH session) to a tab without
 * stealing a live session. Occupied tabs keep their current process; idle/empty tabs
 * can be reused.
 *
 * An SSH session never takes over an idle local tab: its tab must carry the bookmark
 * name and the SSH glyph, so it always gets a dedicated tab.
 */
export function resolveTerminalTabForInjectedSession(
  options: {
    state: ProjectTerminalState;
    workspaceLabel: string;
    sessionId: string;
    sessionByTabId: Readonly<Record<string, string | undefined>>;
  } & InjectedTerminalSessionIdentity,
): { state: ProjectTerminalState; tabId: string } {
  const existingTab = options.state.tabs.find((tab) => options.sessionByTabId[tab.id] === options.sessionId);
  if (existingTab) {
    return {
      state: { ...options.state, open: true, activeTabId: existingTab.id },
      tabId: existingTab.id,
    };
  }

  if (options.kind === "ssh") {
    const base =
      options.label?.trim() ||
      options.endpoint?.trim() ||
      options.workspaceLabel.trim() ||
      i18n.t("terminal.title");
    const tab = createTerminalTab(withUniqueLabel(base, options.state.tabs), "ssh", options.endpoint);
    return {
      state: {
        ...options.state,
        open: true,
        tabs: [...options.state.tabs, tab],
        activeTabId: tab.id,
      },
      tabId: tab.id,
    };
  }

  const activeTab = options.state.tabs.find((tab) => tab.id === options.state.activeTabId);
  const idleTab =
    activeTab && !options.sessionByTabId[activeTab.id]
      ? activeTab
      : options.state.tabs.find((tab) => !options.sessionByTabId[tab.id]);
  if (idleTab) {
    return {
      state: { ...options.state, open: true, activeTabId: idleTab.id },
      tabId: idleTab.id,
    };
  }

  const tab = createTerminalTab(nextTerminalTabLabel(options.workspaceLabel, options.state.tabs));
  return {
    state: {
      ...options.state,
      open: true,
      tabs: [...options.state.tabs, tab],
      activeTabId: tab.id,
    },
    tabId: tab.id,
  };
}

export { DEFAULT_HEIGHT as DEFAULT_TERMINAL_HEIGHT, MIN_HEIGHT as MIN_TERMINAL_HEIGHT };
