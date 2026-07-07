import { collectProfileAssignedMcpServers, defaultSubagentAvailability } from "@eco/runtime";
import {
  Activity,
  AlertCircle,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Cloud,
  CornerDownRight,
  FolderOpen,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  Monitor,
  PanelBottom,
  PanelRight,
  Pencil,
  Plug,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  type LucideIcon,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";
import { AppMessage, useAppMessage } from "./AppMessage";
import { GitSettingsPanel } from "./GitSettingsPanel";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import {
  formatPromptCacheConfigDriftHint,
  resolvePromptCacheConfigDrift,
  resolvePromptCacheProfileLabel,
} from "../shared/prompt-cache-config";
import {
  buildThreadRuntimeConfigFromDefaults,
  type BackgroundTerminalTask,
  normalizeThreadRuntimeConfig,
  type BashApprovalRequest,
  type ClarificationRequest,
  type CoderTodoItem,
  deriveSubagentEnabledFromProfile,
  deriveMcpServersEnabled,
  getDefaultAgentProfileId,
  listEnabledGlobalMcpServerKeys,
  type LinkAgentsSkillsResult,
  type McpServerCheckResult,
  type McpServerConfigInput,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type OrchestrationProfile,
  type GitSettingsSnapshot,
  type GitWorkingTreeStatus,
  type PackageScriptsListResult,
  type ProxyBridgeSettingsSnapshot,
  type RouteCapabilityHint,
  type RoutePricingHint,
  resolveThreadAgentProfile,
  runtimeRoleRoutesFromAgentProfile,
  type CenterServerSettingsInput,
  type CenterServerSettingsSnapshot,
  type CenterServerSignInRequest,
  type CenterServerSignUpRequest,
  type SkillsListResult,
  type SubagentRole,
  type TerminalSessionView,
  type ThreadActivityRewindTarget,
  type ThreadBillingSnapshot,
  type ThreadContextSnapshot,
  type ThreadLiveEvent,
  type ThreadPendingFollowUp,
  type ThreadPendingPlan,
  type ThreadRunProjectionSnapshot,
  type ThreadRuntimeConfig,
  type ThreadStatus,
  type ThreadSubagentMetricsSummary,
  type ThreadSubagentSessionTiming,
  type ThreadSummary,
  type ThreadUsageSnapshot,
  type WorkflowSettingsSnapshot,
  type WorkspaceDiffResult,
  type WorkspaceInfo,
} from "../shared/ipc";
import {
  HOME_PROJECT_DISPLAY_NAME,
  HOME_PROJECT_IMPORTED_AT,
  isHomeProjectPath,
} from "../shared/home-project";
import { isEcoSdkModelAlias, pickDisplayModelId } from "../shared/model-id";
import {
  dedupeSkillsByName,
  listSdkReadyProjectSkills,
  parseExplicitSkillNames,
  promptIncludesSkillName,
  type SkillInfo,
} from "../shared/skills";
import { isContinuableThreadStatus } from "../shared/thread-continuation";
import {
  extractPlanFailureMessage,
  resolveThreadMessageFromLiveEvent,
  shouldUpdateThreadSummaryFromLiveEvent,
} from "../shared/thread-failure-message";
import { buildThreadUsageSummary } from "../shared/thread-usage-summary";
import { ActivityLogView } from "./ActivityLogView";
import { areCodingRoutesReady, isAgentProfileReady } from "./agent-profile-readiness";
import { findSelectableAgentProfileSummary } from "./agent-profile-summary";
import { BashApprovalPanel, type BashApprovalResolutionInput } from "./BashApprovalPanel";
import { ComposerDockMorph } from "./ComposerDockMorph";
import { ClarificationPanel } from "./ClarificationPanel";
import { ComposerAgentModels } from "./ComposerAgentModels";
import { ComposerMcpServers } from "./ComposerMcpServers";
import { ComposerBashReviewToggle } from "./ComposerBashReviewToggle";
import { ComposerPlanModeToggle } from "./ComposerPlanModeToggle";
import { withSessionMode, type SessionMode } from "../shared/plan-mode-ui";
import { ComposerRoutePopover, ComposerRoutePopoverTrigger } from "./ComposerRoutePopover";
import { ComposerSkillsBar } from "./ComposerSkillsBar";
import { ComposerThreadUsagePills } from "./ComposerThreadUsagePills";
import { ComposerSkillsInput, type ComposerSkillsInputHandle } from "./ComposerSkillsInput";
import { ComposerSkillsSlashMenu } from "./ComposerSkillsSlashMenu";
import { buildComposerAgentModelLabels } from "./composer-agent-model-labels";
import {
  COMPOSER_MAX_IMAGES,
  type ComposerImageAttachment,
  fromPromptImageAttachments,
  readImageFileAsAttachment,
  toPromptImageAttachments,
} from "./composer-attachments";
import { buildComposerSavedProfile } from "./composer-profile-save";
import {
  applySlashSkillSelection,
  buildSkillMap,
  filterSkillsForSlash,
  parseSlashQuery,
} from "./composer-skills";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { ModelsSettingsPanel, type ModelsSettingsTab } from "./ModelsSettingsPanel";
import { PackageScriptsDialog } from "./PackageScriptsDialog";
import { waitForOverlayDismiss } from "./package-script-ui";
import { PlanApprovalPanel } from "./PlanApprovalPanel";
import { ProjectSidebarTree } from "./ProjectSidebarTree";
import {
  buildInitialProjectOrder,
  ensureHomeProjectFirst,
  type ProjectReorderPosition,
  prependProjectOrder,
  reorderProjectPaths,
  sortProjectsByOrder,
  sortThreadsForSidebar,
} from "./project-sidebar-order";
import { buildRuntimeAgentDisplayNames } from "./runtime-agent-display";
import { buildRuntimeAgentThemes } from "./runtime-agent-theme";
import { COMPOSER_SEND_ICON_PX } from "./composer-icon-metrics";
import { CenterServerSettingsPanel } from "./CenterServerSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";
import { StopThreadConfirmDialog } from "./StopThreadConfirmDialog";
import {
  SubagentTaskDrawer,
  TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID,
  TASK_PANEL_REVIEW_TAB_ID,
  type TaskPanelActiveTab,
} from "./SubagentTaskDrawer";
import { WorkspaceFloatingCards } from "./WorkspaceFloatingCards";
import { TerminalPanel } from "./TerminalPanel";
import {
  createProjectTerminalState,
  DEFAULT_TERMINAL_HEIGHT,
  getProjectTerminalState,
  readTerminalWorkspaceState,
  saveTerminalWorkspaceState,
  type ProjectTerminalState,
  type TerminalTabRecord,
  type TerminalWorkspaceState,
} from "./terminal-panel-storage";
import {
  hasTerminalSessionsForProject,
  listTerminalSessionEntriesForProject,
  replaceTerminalSessionsForProject,
} from "./terminal-session-cache";
import {
  createProjectWorkspacePanelState,
  getProjectWorkspacePanelState,
  readWorkspacePanelWorkspaceState,
  saveWorkspacePanelWorkspaceState,
  type WorkspacePanelWorkspaceState,
} from "./workspace-panel-storage";
import {
  formatThreadFollowUpPreview,
  isLiveFollowUpThreadStatus,
  mergeThreadFollowUp,
  queuedThreadFollowUps,
  sortThreadFollowUps,
} from "./thread-follow-up-ui";
import { mergeThreadRunProjectionUpdate } from "./run-projection-merge";
import {
  buildThreadRunProjectionViewModel,
  isProjectionUserPromptItem,
  isThreadAutoCompactSuspended,
  isThreadContextCompactionInFlight,
  isThreadPromptCacheInvalidated,
  projectionItemToDetailBlock,
  type ThreadRunProjectionMainFeedEntry,
} from "./thread-run-projection-view";
import { type AppTheme, persistAppTheme, readStoredAppTheme, subscribeToSystemTheme } from "./theme";
import { subscribeToWindowFocus } from "./window-focus";
import "./themes.css";
import "./styles.css";
import "./theme-overrides.css";

const TASK_PANEL_WIDTH_STORAGE_KEY = "eco.task-panel.width";
const DEFAULT_TASK_PANEL_WIDTH = 480;
const MIN_TASK_PANEL_WIDTH = 360;
const MAX_TASK_PANEL_WIDTH = 760;

function clampTaskPanelWidth(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TASK_PANEL_WIDTH;
  }
  return Math.min(MAX_TASK_PANEL_WIDTH, Math.max(MIN_TASK_PANEL_WIDTH, Math.round(value)));
}

function readTaskPanelWidth(): number {
  try {
    if (typeof localStorage === "undefined") {
      return DEFAULT_TASK_PANEL_WIDTH;
    }
    const raw = localStorage.getItem(TASK_PANEL_WIDTH_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_TASK_PANEL_WIDTH;
    }
    return clampTaskPanelWidth(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_TASK_PANEL_WIDTH;
  }
}

function saveTaskPanelWidth(width: number): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(TASK_PANEL_WIDTH_STORAGE_KEY, String(clampTaskPanelWidth(width)));
  } catch {
    // ignore quota and private-mode storage errors
  }
}

const emptySettings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  orchestrationProfiles: [],
};

function findOrchestrationProfileBySelectionId(
  settings: ModelSettingsSnapshot,
  selectionId: string,
): OrchestrationProfile | undefined {
  return settings.orchestrationProfiles.find((profile) => profile.id === selectionId);
}

const recentProjectsStorageKey = "eco.recent-projects";
const projectOrderStorageKey = "eco.project-order";
const pinnedProjectsStorageKey = "eco.sidebar.pinned-projects";
const pinnedThreadsStorageKey = "eco.sidebar.pinned-threads";
const collapsedProjectsStorageKey = "eco.sidebar.collapsed-projects";
const hiddenProjectsStorageKey = "eco.sidebar.hidden-projects";
const sidebarThreadsCollapsed = 5;

interface RecentProject {
  path: string;
  name: string;
  /** Set once when the project is first opened in the app; used for stable sidebar order. */
  importedAt: string;
}

type SettingsSectionId = "general" | "providers" | "mcp" | "centerServer" | "models" | "skills" | "git";

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
}

interface SettingsNavGroup {
  label: string;
  sections: SettingsSection[];
}

const settingsNavGroups: SettingsNavGroup[] = [
  {
    label: "个人",
    sections: [{ id: "general", label: "外观", icon: Monitor }],
  },
  {
    label: "集成",
    sections: [
      { id: "providers", label: "模型服务商", icon: Settings2 },
      { id: "mcp", label: "MCP", icon: Plug },
      { id: "centerServer", label: "连接", icon: Cloud },
    ],
  },
  {
    label: "编码",
    sections: [
      { id: "models", label: "智能体构建器", icon: SlidersHorizontal },
      { id: "skills", label: "Skills", icon: Sparkles },
      { id: "git", label: "Git", icon: GitBranch },
    ],
  },
];

const settingsSections = settingsNavGroups.flatMap((group) => group.sections);

const emptyCenterServerSettings: CenterServerSettingsSnapshot = {
  settings: {
    enabled: false,
    serverUrl: "",
    deviceName: "Eco Desktop",
    hasDeviceSecret: false,
    hasRefreshToken: false,
  },
  status: { state: "disabled" },
};

const emptyMcpSettings: McpSettingsSnapshot = { servers: [] };

const emptyGitSettings: GitSettingsSnapshot = {
  commitMessageRoleByProfileId: {},
  commitMessageCandidateModelIdByProfileId: {},
};

interface ComposerRewindTarget extends ThreadActivityRewindTarget {
  threadId: string;
}

interface ComposerDraft {
  prompt: string;
  attachments: ComposerImageAttachment[];
  rewindTarget?: ComposerRewindTarget;
}

interface TerminalProjectSyncResult {
  state?: ProjectTerminalState;
  cacheEntries: Array<{ tabId: string; sessionId: string }>;
}

const RESTORED_TERMINAL_TAB_PREFIX = "session:";

function terminalTabIdForSession(sessionId: string): string {
  return `${RESTORED_TERMINAL_TAB_PREFIX}${sessionId}`;
}

function buildTerminalStateForLiveSessions(
  existing: ProjectTerminalState | undefined,
  workspacePath: string,
  workspaceLabel: string,
  sessions: readonly TerminalSessionView[],
): TerminalProjectSyncResult {
  if (sessions.length === 0) {
    return { cacheEntries: [] };
  }

  const cachedEntries = listTerminalSessionEntriesForProject(workspacePath);
  const tabsById = new Map((existing?.tabs ?? []).map((tab) => [tab.id, tab]));
  const tabIdBySessionId = new Map(cachedEntries.map((entry) => [entry.sessionId, entry.tabId]));
  const usedLabels = new Set<string>();
  const cacheEntries: Array<{ tabId: string; sessionId: string }> = [];

  const tabs = sessions.map((session, index): TerminalTabRecord => {
    const cachedTabId = tabIdBySessionId.get(session.sessionId);
    const restoredTabId = terminalTabIdForSession(session.sessionId);
    const existingTab = cachedTabId ? tabsById.get(cachedTabId) : tabsById.get(restoredTabId);
    if (existingTab) {
      usedLabels.add(existingTab.label);
      cacheEntries.push({ tabId: existingTab.id, sessionId: session.sessionId });
      return existingTab;
    }

    const labelBase = workspaceLabel.trim() || "终端";
    const baseLabel = index === 0 ? labelBase : `${labelBase} ${index + 1}`;
    let label = baseLabel;
    let suffix = 2;
    while (usedLabels.has(label)) {
      label = `${baseLabel} ${suffix}`;
      suffix += 1;
    }
    usedLabels.add(label);
    const tab = { id: terminalTabIdForSession(session.sessionId), label };
    cacheEntries.push({ tabId: tab.id, sessionId: session.sessionId });
    return tab;
  });

  const firstTab = tabs[0];
  if (!firstTab) {
    return { cacheEntries: [] };
  }
  const activeTabId =
    existing?.activeTabId && tabs.some((tab) => tab.id === existing.activeTabId)
      ? existing.activeTabId
      : firstTab.id;

  return {
    state: {
      open: true,
      height: existing?.height ?? DEFAULT_TERMINAL_HEIGHT,
      tabs,
      activeTabId,
    },
    cacheEntries,
  };
}

function composerContextKeyFromParts(threadId?: string, projectPath?: string): string | undefined {
  if (threadId) {
    return `thread:${threadId}`;
  }
  if (projectPath) {
    return `landing:${projectPath}`;
  }
  return undefined;
}

function measureTopbarFeedOverlap(scrollBody: HTMLElement, topbar: HTMLElement): boolean {
  const feed = scrollBody.querySelector(".codex-feed-stack");
  if (!feed) {
    return false;
  }
  const feedRect = feed.getBoundingClientRect();
  const zones = [
    topbar.querySelector(".activity-header h2"),
    topbar.querySelector(".codex-main-toolbar"),
  ].filter((node): node is Element => node instanceof Element);
  if (zones.length === 0) {
    return false;
  }
  return zones.some((zone) => {
    const zoneRect = zone.getBoundingClientRect();
    if (zoneRect.width <= 0 || zoneRect.height <= 0) {
      return false;
    }
    return feedRect.left < zoneRect.right - 1 && feedRect.right > zoneRect.left + 1;
  });
}

function threadIdFromComposerContextKey(key: string): string | undefined {
  return key.startsWith("thread:") ? key.slice("thread:".length) : undefined;
}

function persistComposerDraftSnapshot(
  store: Record<string, ComposerDraft>,
  key: string,
  snapshot: {
    prompt: string;
    attachments: readonly ComposerImageAttachment[];
    rewindTarget?: ComposerRewindTarget;
  },
) {
  const threadId = threadIdFromComposerContextKey(key);
  const rewindTarget =
    snapshot.rewindTarget && (!threadId || snapshot.rewindTarget.threadId === threadId)
      ? snapshot.rewindTarget
      : undefined;
  if (!snapshot.prompt.trim() && snapshot.attachments.length === 0 && !rewindTarget) {
    delete store[key];
    return;
  }
  store[key] = {
    prompt: snapshot.prompt,
    attachments: [...snapshot.attachments],
    ...(rewindTarget && { rewindTarget }),
  };
}

function clearComposerDraft(store: Record<string, ComposerDraft>, key: string | undefined) {
  if (key) {
    delete store[key];
  }
}

const ACTIVITY_FEED_STICK_THRESHOLD_PX = 120;
const ACTIVITY_FEED_SCROLL_JUMP_THRESHOLD_PX = 200;
const ACTIVITY_FEED_USER_SCROLL_DELTA_PX = 2;
const ACTIVITY_FEED_FORCE_SCROLL_MS = 800;
const ACTIVITY_FEED_LAYOUT_SCROLL_DEBOUNCE_MS = 80;
const WORKSPACE_CARDS_RESPONSIVE_GAP_PX = 18;
const WORKSPACE_CARDS_RESPONSIVE_HYSTERESIS_PX = 48;
const WORKSPACE_CARDS_FALLBACK_HIDE_WIDTH_PX = 1360;
const WORKSPACE_CARDS_FALLBACK_SHOW_WIDTH_PX = 1420;

type ActivityFeedScrollJump = "bottom" | "top";
type ActivityFeedUserScrollDirection = "up" | "down";

interface ActivityUserMessageNavItem {
  id: string;
  userMessage: string;
  fileNames: string[];
  index: number;
  agentReply?: string;
}

interface ActivityUserMessageNavItemDraft {
  id: string;
  userMessage: string;
  index: number;
  fileNames: Set<string>;
  agentReply?: string;
}

function resolveActivityFeedScrollJump(
  scrollTop: number,
  distanceFromBottom: number,
  userScrollDirection: ActivityFeedUserScrollDirection | null,
): ActivityFeedScrollJump | null {
  if (!userScrollDirection) {
    return null;
  }
  if (distanceFromBottom <= ACTIVITY_FEED_SCROLL_JUMP_THRESHOLD_PX) {
    return null;
  }
  if (scrollTop <= ACTIVITY_FEED_SCROLL_JUMP_THRESHOLD_PX) {
    return null;
  }
  return userScrollDirection === "up" ? "top" : "bottom";
}

function normalizeActivityUserMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clipActivityUserMessageText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function buildActivityUserMessageNavItem(
  id: string,
  text: string,
  index: number,
): ActivityUserMessageNavItemDraft {
  return {
    id,
    userMessage: normalizeActivityUserMessageText(text) || `用户消息 ${index + 1}`,
    index,
    fileNames: new Set(),
  };
}

function finishActivityUserMessageNavItem(
  draft: ActivityUserMessageNavItemDraft,
): ActivityUserMessageNavItem {
  const agentReply = draft.agentReply ? normalizeActivityUserMessageText(draft.agentReply) : "";
  return {
    id: draft.id,
    userMessage: draft.userMessage,
    fileNames: [...draft.fileNames],
    index: draft.index,
    ...(agentReply && { agentReply }),
  };
}

function activityUserMessageAriaLabel(item: ActivityUserMessageNavItem): string {
  return `跳到${clipActivityUserMessageText(item.userMessage, 34)}`;
}

function formatActivityUserMessageFileList(fileNames: readonly string[]): string {
  return fileNames.join(" · ");
}

function collectActivityUserMessageRoundItem(
  draft: ActivityUserMessageNavItemDraft,
  item: Parameters<typeof projectionItemToDetailBlock>[0],
  options?: { collectReply?: boolean },
) {
  const block = projectionItemToDetailBlock(item);
  if (!block) {
    return;
  }
  if (options?.collectReply && block.kind === "narrative" && !block.streaming && block.text.trim()) {
    draft.agentReply = block.text;
    return;
  }
  if (block.kind !== "action") {
    return;
  }
  if (block.fileChange) {
    draft.fileNames.add(block.fileChange.fileName || block.fileChange.path);
  }
}

function collectActivityUserMessageRoundEntry(
  draft: ActivityUserMessageNavItemDraft,
  entry: ThreadRunProjectionMainFeedEntry,
) {
  if (entry.kind === "timeline") {
    collectActivityUserMessageRoundItem(draft, entry.item, { collectReply: true });
    return;
  }
  if (entry.kind === "tool-group") {
    for (const child of entry.entries) {
      collectActivityUserMessageRoundItem(draft, child.item);
    }
    return;
  }
  if (entry.kind === "agent-echo") {
    collectActivityUserMessageRoundItem(draft, entry.item);
    return;
  }
  for (const item of entry.card.agent.timeline) {
    collectActivityUserMessageRoundItem(draft, item);
  }
}

function ActivityUserMessageNavigator({
  items,
  activeId,
  onJump,
}: {
  items: ActivityUserMessageNavItem[];
  activeId?: string;
  onJump: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string>();
  if (items.length === 0) {
    return null;
  }
  const resolvedActiveId = activeId && items.some((item) => item.id === activeId) ? activeId : items[0]?.id;
  const hoveredIndex = hoveredId ? items.findIndex((item) => item.id === hoveredId) : -1;
  const hoveredItem = hoveredIndex >= 0 ? items[hoveredIndex] : undefined;
  const clearHoverIfLeaving = (nextTarget: EventTarget | null, currentTarget: EventTarget) => {
    if (nextTarget instanceof Node && currentTarget instanceof Node && currentTarget.contains(nextTarget)) {
      return;
    }
    setHoveredId(undefined);
  };

  return (
    <nav
      className="activity-user-message-nav"
      aria-label="用户消息列表"
      onPointerLeave={() => setHoveredId(undefined)}
      onBlur={(event) => clearHoverIfLeaving(event.relatedTarget, event.currentTarget)}
    >
      <ol className="activity-user-message-nav-list">
        {items.map((item, index) => {
          const active = item.id === resolvedActiveId;
          const hoverDistance = hoveredIndex >= 0 ? Math.abs(index - hoveredIndex) : -1;
          const buttonClassName = [
            "activity-user-message-nav-button",
            active ? "is-active" : "",
            hoverDistance === 0 ? "is-hovered" : "",
            hoverDistance === 1 ? "is-neighbor-1" : "",
            hoverDistance === 2 ? "is-neighbor-2" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={item.id} className="activity-user-message-nav-item">
              <button
                type="button"
                className={buttonClassName}
                onClick={() => onJump(item.id)}
                onFocus={() => setHoveredId(item.id)}
                onPointerEnter={() => setHoveredId(item.id)}
                aria-label={activityUserMessageAriaLabel(item)}
                aria-current={active ? "location" : undefined}
              >
                <span className="activity-user-message-nav-line" aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>
      {hoveredItem ? (
        <span className="activity-user-message-nav-card" role="tooltip">
          <span className="activity-user-message-nav-card-user">
            {clipActivityUserMessageText(hoveredItem.userMessage, 132)}
          </span>
          {hoveredItem.agentReply ? (
            <span className="activity-user-message-nav-card-agent">
              {clipActivityUserMessageText(hoveredItem.agentReply, 150)}
            </span>
          ) : null}
          {hoveredItem.fileNames.length > 0 ? (
            <span
              className="activity-user-message-nav-card-files"
              title={formatActivityUserMessageFileList(hoveredItem.fileNames)}
            >
              {formatActivityUserMessageFileList(hoveredItem.fileNames)}
            </span>
          ) : null}
        </span>
      ) : null}
    </nav>
  );
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readStoredAppTheme());

  useEffect(() => {
    persistAppTheme(appTheme);
  }, [appTheme]);

  useEffect(() => {
    if (appTheme !== "system") {
      return undefined;
    }
    return subscribeToSystemTheme(() => {
      persistAppTheme("system");
    });
  }, [appTheme]);

  useEffect(() => subscribeToWindowFocus(), []);
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [projectWorkspace, setProjectWorkspace] = useState<WorkspaceInfo>();
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>();
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<Set<string>>(() => new Set());
  const [expandedProjectThreadPaths, setExpandedProjectThreadPaths] = useState<Set<string>>(() => new Set());
  const [hiddenProjectPaths, setHiddenProjectPaths] = useState<Set<string>>(() => new Set());
  const [pinnedProjectPaths, setPinnedProjectPaths] = useState<Set<string>>(() => new Set());
  const [pinnedThreadIds, setPinnedThreadIds] = useState<Set<string>>(() => new Set());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [homeProjectPath, setHomeProjectPath] = useState<string>();
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const projectOrderInitializedRef = useRef(false);
  const prevThreadStatusByIdRef = useRef(new Map<string, ThreadStatus>());
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [settings, setSettings] = useState<ModelSettingsSnapshot>(emptySettings);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsSnapshot>(emptyMcpSettings);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettingsSnapshot>({
    sessionMode: "agent",
  });
  const [centerServerSettings, setCenterServerSettings] =
    useState<CenterServerSettingsSnapshot>(emptyCenterServerSettings);

  useEffect(() => {
    if (!window.eco?.onCenterServerStatusChange) {
      return undefined;
    }
    return window.eco.onCenterServerStatusChange((snapshot) => {
      setCenterServerSettings(snapshot);
    });
  }, []);
  const [skillsSnapshot, setSkillsSnapshot] = useState<SkillsListResult>();
  const [proxyBridgeSettings, setProxyBridgeSettings] = useState<ProxyBridgeSettingsSnapshot | null>(null);
  const [isSavingProxyBridgeSettings, setIsSavingProxyBridgeSettings] = useState(false);
  const [composerRoutePopoverOpen, setComposerRoutePopoverOpen] = useState(false);
  const [modelsSettingsTab, setModelsSettingsTab] = useState<ModelsSettingsTab>("subagents");
  const composerRouteButtonRef = useRef<HTMLButtonElement>(null);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const [composerCursor, setComposerCursor] = useState(0);
  const [composerSkillActiveIndex, setComposerSkillActiveIndex] = useState(0);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsLinking, setSkillsLinking] = useState(false);
  const [skillsLinkResult, setSkillsLinkResult] = useState<LinkAgentsSkillsResult>();
  const [prompt, setPrompt] = useState("");
  const [composerRewindTarget, setComposerRewindTarget] = useState<ComposerRewindTarget>();
  const [composerAttachments, setComposerAttachments] = useState<ComposerImageAttachment[]>([]);
  const [plannerCapability, setPlannerCapability] = useState<RouteCapabilityHint>();
  const [composerImageNotice, setComposerImageNotice] = useState<string>();
  const [isOpening, setIsOpening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [planActionBusy, setPlanActionBusy] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string>();
  const [pendingPlansByThread, setPendingPlansByThread] = useState<Record<string, ThreadPendingPlan>>({});
  const [pendingClarificationsByThread, setPendingClarificationsByThread] = useState<
    Record<string, ClarificationRequest>
  >({});
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [pendingBashApprovalsByThread, setPendingBashApprovalsByThread] = useState<
    Record<string, BashApprovalRequest>
  >({});
  const [bashApprovalBusy, setBashApprovalBusy] = useState(false);
  const [followUpsByThread, setFollowUpsByThread] = useState<Record<string, ThreadPendingFollowUp[]>>({});
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpCancelBusyId, setFollowUpCancelBusyId] = useState<string>();
  const [followUpEscalateBusyId, setFollowUpEscalateBusyId] = useState<string>();
  const [editingFollowUpId, setEditingFollowUpId] = useState<string>();
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string>();
  const {
    showError: showAppMessageError,
    dismiss: dismissAppMessage,
    state: appMessageState,
  } = useAppMessage();
  const showAppMessageErrorRef = useRef(showAppMessageError);
  showAppMessageErrorRef.current = showAppMessageError;
  const [subagentTimingsByThread, setSubagentTimingsByThread] = useState<
    Record<string, ThreadSubagentSessionTiming[]>
  >({});
  const [subagentMetricsByThread, setSubagentMetricsByThread] = useState<
    Record<string, ThreadSubagentMetricsSummary[]>
  >({});
  const [runProjectionByThread, setRunProjectionByThread] = useState<
    Record<string, ThreadRunProjectionSnapshot>
  >({});
  const [usageByThread, setUsageByThread] = useState<Record<string, Record<string, ThreadUsageSnapshot>>>({});
  const [billingByThread, setBillingByThread] = useState<Record<string, ThreadBillingSnapshot>>({});
  const [contextByThread, setContextByThread] = useState<Record<string, ThreadContextSnapshot>>({});
  const [modelByThread, setModelByThread] = useState<Record<string, Record<string, string>>>({});
  const [todosByThread, setTodosByThread] = useState<Record<string, CoderTodoItem[]>>({});
  const [cancelBusy, setCancelBusy] = useState(false);
  const [stopConfirm, setStopConfirm] = useState<{ changedFiles: string[] }>();
  const [composerRuntimeConfig, setComposerRuntimeConfig] = useState<ThreadRuntimeConfig | null>(null);
  const [gitStatus, setGitStatus] = useState<GitWorkingTreeStatus>();
  const [gitStatusBusy, setGitStatusBusy] = useState(false);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const gitStatusRequestRef = useRef(0);
  const [gitSettings, setGitSettings] = useState<GitSettingsSnapshot>(emptyGitSettings);
  const [scriptsDialogOpen, setScriptsDialogOpen] = useState(false);
  const [packageScripts, setPackageScripts] = useState<PackageScriptsListResult>();
  const [storedTerminalByProject] = useState<TerminalWorkspaceState>(() => readTerminalWorkspaceState());
  const [terminalByProject, setTerminalByProject] = useState<TerminalWorkspaceState>({});
  const [workspacePanelByProject, setWorkspacePanelByProject] = useState<WorkspacePanelWorkspaceState>(() =>
    readWorkspacePanelWorkspaceState(),
  );
  const [backgroundTerminalTasks, setBackgroundTerminalTasks] = useState<BackgroundTerminalTask[]>([]);
  const [selectedSubagentAgentId, setSelectedSubagentAgentId] = useState<string>();
  const [taskPanelActiveTab, setTaskPanelActiveTab] = useState<TaskPanelActiveTab>(TASK_PANEL_REVIEW_TAB_ID);
  const [openSubagentTabIds, setOpenSubagentTabIds] = useState<string[]>([]);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskPanelFullscreen, setTaskPanelFullscreen] = useState(false);
  const [taskPanelWidth, setTaskPanelWidth] = useState(readTaskPanelWidth);
  const [workspaceCardsAutoHidden, setWorkspaceCardsAutoHidden] = useState(false);
  const [workspaceCardsManualRevealProjectPath, setWorkspaceCardsManualRevealProjectPath] =
    useState<string>();
  const taskPanelResizeRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
  const [reviewDiff, setReviewDiff] = useState<WorkspaceDiffResult>();
  const [reviewDiffLoading, setReviewDiffLoading] = useState(false);
  const [reviewDiffError, setReviewDiffError] = useState<string>();
  const [reviewSelectedPath, setReviewSelectedPath] = useState<string>();
  const [scriptsBusy, setScriptsBusy] = useState(false);
  const [injectedTerminalSessionId, setInjectedTerminalSessionId] = useState<string | null>(null);
  const [terminalLifecycleEpoch, setTerminalLifecycleEpoch] = useState(0);
  const [routePricingHints, setRoutePricingHints] = useState<RoutePricingHint[]>([]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    if (!window.eco) {
      setError("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
      return undefined;
    }

    void Promise.all([
      window.eco.getCurrentWorkspace(),
      window.eco.getHomeProjectPath(),
      window.eco.listThreads(),
      window.eco.getModelSettings(),
      window.eco.getMcpSettings(),
      window.eco.getWorkflowSettings(),
      window.eco.getCenterServerSettings(),
      window.eco.getProxyBridgeSettings(),
    ]).then(
      ([
        currentWorkspace,
        resolvedHomeProjectPath,
        currentThreads,
        modelSettings,
        mcp,
        workflow,
        centerServer,
        proxyBridge,
      ]) => {
        setHomeProjectPath(resolvedHomeProjectPath);
        setWorkspace(currentWorkspace);
        if (currentWorkspace) {
          setSelectedProjectPath(currentWorkspace.path);
          registerImportedProject(
            currentWorkspace.path,
            isHomeProjectPath(currentWorkspace.path, resolvedHomeProjectPath)
              ? HOME_PROJECT_DISPLAY_NAME
              : currentWorkspace.name,
            resolvedHomeProjectPath,
          );
        }
        setThreads(currentThreads);
        setSettings(modelSettings);
        setMcpSettings(mcp);
        setWorkflowSettings(workflow);
        setCenterServerSettings(centerServer);
        setProxyBridgeSettings(proxyBridge);
      },
    );

    let threadListRefreshTimer: number | undefined;
    let runProjectionFullRefreshTimer: number | undefined;
    const ensureThreadListed = (threadId: string) => {
      setThreads((current) => {
        if (current.some((thread) => thread.id === threadId)) {
          return current;
        }
        if (threadListRefreshTimer !== undefined) {
          window.clearTimeout(threadListRefreshTimer);
        }
        threadListRefreshTimer = window.setTimeout(() => {
          threadListRefreshTimer = undefined;
          void window.eco!.listThreads().then(setThreads);
        }, 120);
        return current;
      });
    };
    const scheduleSelectedRunProjectionFullRefresh = (threadId: string) => {
      if (
        selectedThreadIdRef.current !== threadId ||
        typeof window.eco?.getThreadRunProjection !== "function"
      ) {
        return;
      }
      if (runProjectionFullRefreshTimer !== undefined) {
        window.clearTimeout(runProjectionFullRefreshTimer);
      }
      runProjectionFullRefreshTimer = window.setTimeout(() => {
        runProjectionFullRefreshTimer = undefined;
        if (
          selectedThreadIdRef.current !== threadId ||
          typeof window.eco?.getThreadRunProjection !== "function"
        ) {
          return;
        }
        void window.eco.getThreadRunProjection(threadId).then((projection) => {
          if (!projection || selectedThreadIdRef.current !== threadId) {
            return;
          }
          setRunProjectionByThread((current) => ({
            ...current,
            [threadId]: mergeThreadRunProjectionUpdate(current[threadId], projection),
          }));
        });
      }, 300);
    };

    const unsubscribe = window.eco.onThreadEvent((event) => {
      if (!isThreadLiveEvent(event) || event.threadId === "settings") {
        return;
      }

      ensureThreadListed(event.threadId);

      if (event.type === "thread.deleted") {
        clearThreadClientState(event.threadId);
        return;
      }

      if (event.type === "thread.run_projection_updated" && event.projection) {
        const preserveHistory = userDetachedFromBottomRef.current;
        setRunProjectionByThread((current) => ({
          ...current,
          [event.threadId]: mergeThreadRunProjectionUpdate(current[event.threadId], event.projection!, {
            preserveHistory,
          }),
        }));
        scheduleSelectedRunProjectionFullRefresh(event.threadId);
        return;
      }

      if (event.title) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === event.threadId ? { ...thread, title: event.title ?? thread.title } : thread,
          ),
        );
        if (event.type === "thread.title_updated" || event.type === "thread.title_delta") {
          return;
        }
      }

      if (event.type === "thread.title_failed" && event.threadId === selectedThreadIdRef.current) {
        showAppMessageErrorRef.current("会话标题生成失败");
        return;
      }

      if (event.todoList) {
        setTodosByThread((current) => ({
          ...current,
          [event.threadId]: event.todoList ?? [],
        }));
        if (event.type === "thread.todos_updated") {
          return;
        }
      }

      if (shouldUpdateThreadSummaryFromLiveEvent(event.type)) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === event.threadId
              ? {
                  ...thread,
                  message: resolveThreadMessageFromLiveEvent(event.type, event.message),
                  status: statusFromLiveEvent(event.type, thread.status),
                  updatedAt: new Date().toISOString(),
                }
              : thread,
          ),
        );
      }

      if (event.type === "thread.plan_cleared" || event.type === "thread.completed") {
        clearPendingPlanForThread(event.threadId);
      }

      if (event.plan && event.threadId) {
        upsertPendingPlanForThread(event.threadId, {
          threadId: event.threadId,
          userPrompt: event.plan.userPrompt,
          analysis: event.plan.analysis,
          plan: event.plan.plan,
          workspacePath: "",
          worktreePath: "",
        });
      }

      if (event.runtimeConfig) {
        const runtimeConfig = event.runtimeConfig;
        setThreads((current) =>
          current.map((thread) => (thread.id === event.threadId ? { ...thread, runtimeConfig } : thread)),
        );
      }

      if (event.type.startsWith("clarification.")) {
        if (event.type === "clarification.requested" && event.clarification) {
          upsertPendingClarificationForThread(event.threadId, event.clarification);
          return;
        }
        if (window.eco) {
          void window.eco.getPendingClarification(event.threadId).then((clarification) => {
            if (clarification) {
              upsertPendingClarificationForThread(event.threadId, clarification);
            } else {
              clearPendingClarificationForThread(event.threadId);
            }
          });
        }
      }

      if (event.type === "bash_approval.requested" && event.bashApproval) {
        upsertPendingBashApprovalForThread(event.threadId, event.bashApproval);
      }

      if (event.type === "plan_approval.requested" && event.plan) {
        upsertPendingPlanForThread(event.threadId, {
          threadId: event.threadId,
          userPrompt: event.plan.userPrompt,
          analysis: event.plan.analysis,
          plan: event.plan.plan,
          workspacePath: "",
          worktreePath: "",
          ...(event.plan.planFilePath ? { planFilePath: event.plan.planFilePath } : {}),
        });
      }

      if (event.followUp) {
        setFollowUpsByThread((current) => ({
          ...current,
          [event.threadId]: mergeThreadFollowUp(current[event.threadId] ?? [], event.followUp!),
        }));
        if (
          event.type === "thread.follow_up.escalated" &&
          typeof window.eco?.listThreadFollowUps === "function"
        ) {
          void window.eco.listThreadFollowUps(event.threadId).then((result) => {
            setFollowUpsByThread((current) => ({
              ...current,
              [event.threadId]: sortThreadFollowUps(result.followUps),
            }));
          });
        }
      }

      if (event.type.startsWith("bash_approval.")) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === event.threadId
              ? {
                  ...thread,
                  message: event.message,
                  status: event.type === "bash_approval.requested" ? "running" : thread.status,
                  updatedAt: new Date().toISOString(),
                }
              : thread,
          ),
        );
      }
      if (event.type.startsWith("plan_approval.")) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === event.threadId
              ? {
                  ...thread,
                  message: event.message,
                  status: event.type === "plan_approval.requested" ? "awaiting_plan" : thread.status,
                  updatedAt: new Date().toISOString(),
                }
              : thread,
          ),
        );
      }
      if (
        event.type === "bash_approval.approved" ||
        event.type === "bash_approval.rejected" ||
        event.type === "bash_approval.denied" ||
        event.type === "plan_approval.denied" ||
        event.type === "thread.completed" ||
        event.type === "thread.failed" ||
        event.type === "thread.idle" ||
        event.type === "thread.stopped"
      ) {
        clearPendingBashApprovalForThread(event.threadId);
      }
      if (event.type === "plan_approval.denied") {
        clearPendingPlanForThread(event.threadId);
      }

      if (event.type === "thread.usage_updated" && event.usage) {
        const roleKey = String(event.role ?? "planner");
        setUsageByThread((current) => ({
          ...current,
          [event.threadId]: {
            ...(current[event.threadId] ?? {}),
            [roleKey]: event.usage!,
          },
        }));
        if (event.billing) {
          setBillingByThread((current) => ({
            ...current,
            [event.threadId]: event.billing!,
          }));
        }
        const modelId = event.modelId ?? event.usage.modelId;
        if (modelId && !isEcoSdkModelAlias(modelId)) {
          setModelByThread((current) => ({
            ...current,
            [event.threadId]: {
              ...(current[event.threadId] ?? {}),
              [roleKey]: modelId.trim(),
            },
          }));
        }
        return;
      }

      if (event.type === "thread.context_updated" && event.context) {
        setContextByThread((current) => ({
          ...current,
          [event.threadId]: event.context!,
        }));
        return;
      }

      if (event.type === "thread.subagent_timing_updated" && event.subagentSessions) {
        setSubagentTimingsByThread((current) => ({
          ...current,
          [event.threadId]: event.subagentSessions!,
        }));
        return;
      }

      if (
        (event.type === "thread.awaiting_plan" ||
          event.type === "thread.execution_failed" ||
          event.type === "plan_approval.requested") &&
        !event.plan &&
        window.eco
      ) {
        void window.eco.getPendingPlan(event.threadId).then((plan) => {
          if (plan) {
            upsertPendingPlanForThread(event.threadId, plan);
          }
        });
      }
    });
    return () => {
      if (threadListRefreshTimer !== undefined) {
        window.clearTimeout(threadListRefreshTimer);
      }
      if (runProjectionFullRefreshTimer !== undefined) {
        window.clearTimeout(runProjectionFullRefreshTimer);
      }
      unsubscribe();
    };
  }, []);

  const selectedThreadStatus = threads.find((thread) => thread.id === selectedThreadId)?.status;

  useEffect(() => {
    if (!selectedThreadId || !window.eco) {
      return;
    }

    let cancelled = false;

    if (typeof window.eco.getThreadRunProjection === "function") {
      void window.eco.getThreadRunProjection(selectedThreadId).then((projection) => {
        if (cancelled || !projection) {
          return;
        }
        setRunProjectionByThread((current) => ({
          ...current,
          [selectedThreadId]: mergeThreadRunProjectionUpdate(current[selectedThreadId], projection),
        }));
      });
    }

    // Preload may be stale until Electron restarts; skip rather than throw.
    if (typeof window.eco.listSubagentSessions === "function") {
      void window.eco.listSubagentSessions(selectedThreadId).then((sessions) => {
        if (cancelled) {
          return;
        }
        setSubagentTimingsByThread((current) => ({
          ...current,
          [selectedThreadId]: sessions,
        }));
      });
    }

    if (typeof window.eco.listSubagentMetrics === "function") {
      void window.eco.listSubagentMetrics(selectedThreadId).then((metrics) => {
        if (cancelled) {
          return;
        }
        setSubagentMetricsByThread((current) => ({
          ...current,
          [selectedThreadId]: metrics,
        }));
      });
    }

    if (window.eco) {
      void window.eco.getPendingPlan(selectedThreadId).then((plan) => {
        if (cancelled) {
          return;
        }
        if (plan) {
          upsertPendingPlanForThread(selectedThreadId, plan);
        } else {
          clearPendingPlanForThread(selectedThreadId);
        }
      });
      void window.eco.getPendingClarification(selectedThreadId).then((clarification) => {
        if (cancelled) {
          return;
        }
        if (clarification) {
          upsertPendingClarificationForThread(selectedThreadId, clarification);
        } else {
          clearPendingClarificationForThread(selectedThreadId);
        }
      });
      if (typeof window.eco.getPendingBashApproval === "function") {
        void window.eco.getPendingBashApproval(selectedThreadId).then((approval) => {
          if (cancelled) {
            return;
          }
          if (approval) {
            upsertPendingBashApprovalForThread(selectedThreadId, approval);
          } else {
            clearPendingBashApprovalForThread(selectedThreadId);
          }
        });
      }
      if (typeof window.eco.listThreadFollowUps === "function") {
        void window.eco.listThreadFollowUps(selectedThreadId).then((result) => {
          if (cancelled) {
            return;
          }
          setFollowUpsByThread((current) => ({
            ...current,
            [selectedThreadId]: sortThreadFollowUps(result.followUps),
          }));
        });
      }
      void window.eco.listThreadTodos(selectedThreadId).then((todos) => {
        if (cancelled) {
          return;
        }
        setTodosByThread((current) => ({
          ...current,
          [selectedThreadId]: todos,
        }));
      });
      void window.eco.getThreadUsageSnapshot(selectedThreadId).then((snapshot) => {
        if (cancelled) {
          return;
        }
        if (snapshot.billing) {
          setBillingByThread((current) => ({
            ...current,
            [selectedThreadId]: snapshot.billing!,
          }));
        }
        if (snapshot.context) {
          setContextByThread((current) => ({
            ...current,
            [selectedThreadId]: snapshot.context!,
          }));
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedThreadId, selectedThreadStatus]);

  useEffect(() => {
    const saved = window.localStorage.getItem(recentProjectsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as Array<RecentProject & { lastUsedAt?: string; importedAt?: string }>;
      if (Array.isArray(parsed)) {
        setRecentProjects(
          parsed.map((project) => ({
            path: project.path,
            name: project.name,
            importedAt: project.importedAt ?? project.lastUsedAt ?? new Date(0).toISOString(),
          })),
        );
      }
    } catch {
      window.localStorage.removeItem(recentProjectsStorageKey);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(projectOrderStorageKey);
    if (!saved) {
      return;
    }
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setProjectOrder(parsed);
        projectOrderInitializedRef.current = true;
      }
    } catch {
      window.localStorage.removeItem(projectOrderStorageKey);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(pinnedProjectsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setPinnedProjectPaths(new Set(parsed));
      }
    } catch {
      window.localStorage.removeItem(pinnedProjectsStorageKey);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(pinnedThreadsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setPinnedThreadIds(new Set(parsed));
      }
    } catch {
      window.localStorage.removeItem(pinnedThreadsStorageKey);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(collapsedProjectsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setCollapsedProjectPaths(new Set(parsed));
      }
    } catch {
      window.localStorage.removeItem(collapsedProjectsStorageKey);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(hiddenProjectsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setHiddenProjectPaths(new Set(parsed));
      }
    } catch {
      window.localStorage.removeItem(hiddenProjectsStorageKey);
    }
  }, []);

  const mergedProjects = useMemo(() => {
    const merged = new Map<string, RecentProject>();
    if (homeProjectPath) {
      merged.set(homeProjectPath, {
        path: homeProjectPath,
        name: HOME_PROJECT_DISPLAY_NAME,
        importedAt: HOME_PROJECT_IMPORTED_AT,
      });
    }
    for (const project of recentProjects) {
      if (homeProjectPath && isHomeProjectPath(project.path, homeProjectPath)) {
        continue;
      }
      merged.set(project.path, project);
    }
    if (workspace) {
      const existing = merged.get(workspace.path);
      const workspaceName =
        homeProjectPath && isHomeProjectPath(workspace.path, homeProjectPath)
          ? HOME_PROJECT_DISPLAY_NAME
          : workspace.name;
      if (existing) {
        merged.set(workspace.path, { ...existing, name: workspaceName });
      }
    }
    for (const thread of threads) {
      if (!merged.has(thread.workspacePath)) {
        const workspaceThreads = threads.filter((item) => item.workspacePath === thread.workspacePath);
        const importedAt = workspaceThreads.reduce(
          (earliest, item) => (item.createdAt < earliest ? item.createdAt : earliest),
          workspaceThreads[0]!.createdAt,
        );
        merged.set(thread.workspacePath, {
          path: thread.workspacePath,
          name:
            homeProjectPath && isHomeProjectPath(thread.workspacePath, homeProjectPath)
              ? HOME_PROJECT_DISPLAY_NAME
              : pathToName(thread.workspacePath),
          importedAt,
        });
      }
    }
    return [...merged.values()].filter(
      (project) =>
        !hiddenProjectPaths.has(project.path) ||
        (homeProjectPath !== undefined && isHomeProjectPath(project.path, homeProjectPath)),
    );
  }, [hiddenProjectPaths, homeProjectPath, recentProjects, threads, workspace]);

  const projects = useMemo(
    () => ensureHomeProjectFirst(sortProjectsByOrder(mergedProjects, projectOrder), homeProjectPath),
    [homeProjectPath, mergedProjects, projectOrder],
  );

  useEffect(() => {
    if (projectOrderInitializedRef.current || mergedProjects.length === 0) {
      return;
    }
    const initial = buildInitialProjectOrder(mergedProjects);
    setProjectOrder(initial);
    window.localStorage.setItem(projectOrderStorageKey, JSON.stringify(initial));
    projectOrderInitializedRef.current = true;
  }, [mergedProjects]);

  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, ThreadSummary[]>();
    for (const thread of threads) {
      const bucket = grouped.get(thread.workspacePath) ?? [];
      bucket.push(thread);
      grouped.set(thread.workspacePath, bucket);
    }
    for (const [path, projectThreads] of grouped) {
      grouped.set(path, sortThreadsForSidebar(projectThreads, pinnedThreadIds));
    }
    return grouped;
  }, [pinnedThreadIds, threads]);

  const projectTree = useMemo(
    () =>
      projects.map((project) => {
        const projectThreads = threadsByProject.get(project.path) ?? [];
        const threadsExpanded = expandedProjectThreadPaths.has(project.path);
        const visibleCount = threadsExpanded ? projectThreads.length : sidebarThreadsCollapsed;
        return {
          project: {
            ...project,
            pinned: pinnedProjectPaths.has(project.path),
            isHome: homeProjectPath ? isHomeProjectPath(project.path, homeProjectPath) : false,
          },
          projectThreads,
          collapsed: collapsedProjectPaths.has(project.path),
          visibleThreads: projectThreads.slice(0, visibleCount),
          hasMore: !threadsExpanded && projectThreads.length > visibleCount,
        };
      }),
    [
      collapsedProjectPaths,
      expandedProjectThreadPaths,
      homeProjectPath,
      pinnedProjectPaths,
      projects,
      threadsByProject,
    ],
  );

  const currentProjectPath = useMemo(() => {
    if (selectedProjectPath && projects.some((project) => project.path === selectedProjectPath)) {
      return selectedProjectPath;
    }
    if (workspace && !hiddenProjectPaths.has(workspace.path)) {
      return workspace.path;
    }
    return projects[0]?.path;
  }, [hiddenProjectPaths, projects, selectedProjectPath, workspace]);
  const currentProjectName = useMemo(() => {
    if (!currentProjectPath) {
      return "项目";
    }
    const project = projects.find((item) => item.path === currentProjectPath);
    return project?.name ?? pathToName(currentProjectPath);
  }, [currentProjectPath, projects]);
  const currentTerminalState = useMemo(() => {
    if (!currentProjectPath) {
      return undefined;
    }
    return getProjectTerminalState(terminalByProject, currentProjectPath);
  }, [currentProjectPath, terminalByProject]);
  const currentWorkspacePanelState = useMemo(() => {
    if (!currentProjectPath) {
      return undefined;
    }
    return getProjectWorkspacePanelState(workspacePanelByProject, currentProjectPath);
  }, [currentProjectPath, workspacePanelByProject]);
  useEffect(() => {
    setReviewDiff(undefined);
    setReviewDiffLoading(false);
    setReviewDiffError(undefined);
    setReviewSelectedPath(undefined);
  }, [currentProjectPath]);
  const updateProjectTerminal = useCallback((workspacePath: string, next: ProjectTerminalState) => {
    setTerminalByProject((current) => ({
      ...current,
      [workspacePath]: next,
    }));
  }, []);
  const toggleTerminalForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    setTerminalByProject((current) => {
      const existing = current[currentProjectPath];
      const stored = storedTerminalByProject[currentProjectPath];
      const hasLiveSessions = hasTerminalSessionsForProject(currentProjectPath);
      if (existing?.open && hasLiveSessions) {
        return {
          ...current,
          [currentProjectPath]: { ...existing, open: false },
        };
      }
      if (!hasLiveSessions || !existing || existing.tabs.length === 0) {
        const nextState = createProjectTerminalState(currentProjectName, true);
        return {
          ...current,
          [currentProjectPath]: {
            ...nextState,
            height: existing?.height ?? stored?.height ?? nextState.height,
          },
        };
      }
      return {
        ...current,
        [currentProjectPath]: { ...existing, open: true },
      };
    });
  }, [currentProjectName, currentProjectPath, storedTerminalByProject]);
  const toggleWorkspacePanelForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    const desiredOpen = currentWorkspacePanelState?.open === true;
    if (
      desiredOpen &&
      workspaceCardsAutoHidden &&
      workspaceCardsManualRevealProjectPath !== currentProjectPath
    ) {
      setWorkspaceCardsManualRevealProjectPath(currentProjectPath);
      return;
    }
    const nextOpen = taskDrawerOpen ? true : !desiredOpen;
    setWorkspacePanelByProject((current) => {
      const existing = current[currentProjectPath];
      return {
        ...current,
        [currentProjectPath]: existing
          ? { ...existing, open: nextOpen }
          : createProjectWorkspacePanelState(nextOpen),
      };
    });
    setWorkspaceCardsManualRevealProjectPath((current) => {
      if (nextOpen) {
        return taskDrawerOpen || workspaceCardsAutoHidden ? currentProjectPath : undefined;
      }
      return current === currentProjectPath ? undefined : current;
    });
    if (taskDrawerOpen) {
      setTaskDrawerOpen(false);
      setTaskPanelFullscreen(false);
    }
  }, [
    currentProjectPath,
    currentWorkspacePanelState?.open,
    taskDrawerOpen,
    workspaceCardsAutoHidden,
    workspaceCardsManualRevealProjectPath,
  ]);
  const activeThread = useMemo(
    () => (selectedThreadId ? threads.find((thread) => thread.id === selectedThreadId) : undefined),
    [selectedThreadId, threads],
  );
  const pendingPlan = activeThread ? pendingPlansByThread[activeThread.id] : undefined;
  const pendingClarification = activeThread ? pendingClarificationsByThread[activeThread.id] : undefined;
  const pendingBashApproval = activeThread ? pendingBashApprovalsByThread[activeThread.id] : undefined;

  function upsertPendingPlanForThread(threadId: string, plan: ThreadPendingPlan) {
    setPendingPlansByThread((current) => ({ ...current, [threadId]: plan }));
  }

  function clearPendingPlanForThread(threadId: string) {
    setPendingPlansByThread((current) => removeRecordKey(current, threadId));
  }

  function upsertPendingClarificationForThread(threadId: string, clarification: ClarificationRequest) {
    setPendingClarificationsByThread((current) => ({ ...current, [threadId]: clarification }));
  }

  function clearPendingClarificationForThread(threadId: string) {
    setPendingClarificationsByThread((current) => removeRecordKey(current, threadId));
  }

  function upsertPendingBashApprovalForThread(threadId: string, approval: BashApprovalRequest) {
    setPendingBashApprovalsByThread((current) => ({ ...current, [threadId]: approval }));
  }

  function clearPendingBashApprovalForThread(threadId: string) {
    setPendingBashApprovalsByThread((current) => removeRecordKey(current, threadId));
  }
  const composerContextKey = useMemo(
    () => composerContextKeyFromParts(activeThread?.id, activeThread ? undefined : currentProjectPath),
    [activeThread?.id, currentProjectPath],
  );
  const composerDraftsByKeyRef = useRef<Record<string, ComposerDraft>>({});
  const prevComposerContextKeyRef = useRef<string | undefined>(undefined);
  const composerPromptRef = useRef(prompt);
  const composerAttachmentsRef = useRef(composerAttachments);
  const composerRewindTargetRef = useRef(composerRewindTarget);
  composerPromptRef.current = prompt;
  composerAttachmentsRef.current = composerAttachments;
  composerRewindTargetRef.current = composerRewindTarget;
  useEffect(() => {
    saveTerminalWorkspaceState(terminalByProject);
  }, [terminalByProject]);
  useEffect(() => {
    saveWorkspacePanelWorkspaceState(workspacePanelByProject);
  }, [workspacePanelByProject]);
  useEffect(() => {
    saveTaskPanelWidth(taskPanelWidth);
  }, [taskPanelWidth]);
  useEffect(() => {
    if (!currentProjectPath) {
      return undefined;
    }

    let cancelled = false;
    const workspacePath = currentProjectPath;
    const workspaceLabel = currentProjectName;
    const loadLiveSessions = async (): Promise<TerminalSessionView[]> => {
      if (!window.eco?.listTerminalSessions) {
        return listTerminalSessionEntriesForProject(workspacePath).map((entry) => ({
          sessionId: entry.sessionId,
          workspacePath,
        }));
      }
      try {
        return await window.eco.listTerminalSessions({ workspacePath });
      } catch {
        return [];
      }
    };

    void loadLiveSessions().then((sessions) => {
      if (cancelled) {
        return;
      }
      setTerminalByProject((current) => {
        const existing = current[workspacePath] ?? storedTerminalByProject[workspacePath];
        const syncResult = buildTerminalStateForLiveSessions(
          existing,
          workspacePath,
          workspaceLabel,
          sessions,
        );
        replaceTerminalSessionsForProject(workspacePath, syncResult.cacheEntries);
        if (!syncResult.state) {
          const currentState = current[workspacePath];
          if (currentState?.open && currentState.tabs.length > 0) {
            return current;
          }
          if (currentState === undefined) {
            return current;
          }
          const next = { ...current };
          delete next[workspacePath];
          return next;
        }
        return {
          ...current,
          [workspacePath]: syncResult.state,
        };
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeThread?.id,
    currentProjectName,
    currentProjectPath,
    storedTerminalByProject,
    terminalLifecycleEpoch,
  ]);
  const workspacePanelModeRef = useRef<{
    projectPath?: string;
    inConversation?: boolean;
  }>({});
  useEffect(() => {
    if (!currentProjectPath) {
      return;
    }
    const inConversation = Boolean(activeThread && activeThread.workspacePath === currentProjectPath);
    const prev = workspacePanelModeRef.current;
    const projectChanged = prev.projectPath !== currentProjectPath;
    const modeChanged = !projectChanged && prev.inConversation !== inConversation;
    workspacePanelModeRef.current = {
      projectPath: currentProjectPath,
      inConversation,
    };
    setWorkspacePanelByProject((current) => {
      const existing = current[currentProjectPath];
      if (projectChanged) {
        if (existing !== undefined) {
          return current;
        }
        return {
          ...current,
          [currentProjectPath]: createProjectWorkspacePanelState(inConversation),
        };
      }
      if (!modeChanged) {
        return current;
      }
      return {
        ...current,
        [currentProjectPath]: existing
          ? { ...existing, open: inConversation }
          : createProjectWorkspacePanelState(inConversation),
      };
    });
  }, [activeThread?.id, activeThread?.workspacePath, currentProjectPath]);
  useEffect(() => {
    if (!currentProjectPath) {
      return undefined;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "`" && event.key !== "~") {
        return;
      }
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      toggleTerminalForCurrentProject();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentProjectPath, toggleTerminalForCurrentProject]);
  const activeComposerRewindTarget =
    activeThread && composerRewindTarget?.threadId === activeThread.id ? composerRewindTarget : undefined;
  useEffect(() => {
    if (!currentProjectPath || !window.eco) {
      setProjectWorkspace(undefined);
      return undefined;
    }

    let cancelled = false;
    void window.eco.inspectWorkspace(currentProjectPath).then((info) => {
      if (!cancelled) {
        setProjectWorkspace(info);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentProjectPath]);

  const refreshGitStatus = useCallback(
    async (workspacePath?: string) => {
      const path = workspacePath ?? currentProjectPath;
      if (!path || !window.eco) {
        setGitStatus(undefined);
        setGitStatusLoading(false);
        return;
      }
      const requestId = gitStatusRequestRef.current + 1;
      gitStatusRequestRef.current = requestId;
      setGitStatusLoading(true);
      try {
        const status = await window.eco.getGitStatus(path);
        if (requestId === gitStatusRequestRef.current) {
          setGitStatus(status);
        }
      } catch {
        if (requestId === gitStatusRequestRef.current) {
          setGitStatus(undefined);
        }
      } finally {
        if (requestId === gitStatusRequestRef.current) {
          setGitStatusLoading(false);
        }
      }
    },
    [currentProjectPath],
  );

  useEffect(() => {
    setGitStatus(undefined);
    void refreshGitStatus();
  }, [currentProjectPath, refreshGitStatus]);

  const refreshPackageScripts = useCallback(async () => {
    if (!currentProjectPath || !window.eco) {
      setPackageScripts(undefined);
      return;
    }
    setScriptsBusy(true);
    try {
      const result = await window.eco.listPackageScripts(currentProjectPath);
      setPackageScripts(result);
    } catch {
      setPackageScripts(undefined);
    } finally {
      setScriptsBusy(false);
    }
  }, [currentProjectPath]);

  useEffect(() => {
    setPackageScripts(undefined);
    void refreshPackageScripts();
  }, [refreshPackageScripts]);

  useEffect(() => {
    if (!currentProjectPath || !window.eco?.watchPackageJson) {
      return undefined;
    }
    void window.eco.watchPackageJson(currentProjectPath);
    if (!window.eco.onPackageJsonChanged) {
      return undefined;
    }
    return window.eco.onPackageJsonChanged((workspacePath) => {
      if (workspacePath === currentProjectPath) {
        void refreshPackageScripts();
      }
    });
  }, [currentProjectPath, refreshPackageScripts]);

  useEffect(() => {
    const onFocus = () => {
      void refreshPackageScripts();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPackageScripts]);

  useEffect(() => {
    if (!currentProjectPath) {
      return;
    }
    let shouldRefresh = false;
    for (const thread of threads) {
      if (thread.workspacePath !== currentProjectPath) {
        continue;
      }
      const previousStatus = prevThreadStatusByIdRef.current.get(thread.id);
      if (previousStatus === undefined) {
        prevThreadStatusByIdRef.current.set(thread.id, thread.status);
        continue;
      }
      if (isActiveThreadStatus(previousStatus) && !isActiveThreadStatus(thread.status)) {
        shouldRefresh = true;
      }
      prevThreadStatusByIdRef.current.set(thread.id, thread.status);
    }
    if (shouldRefresh) {
      void refreshPackageScripts();
    }
  }, [threads, currentProjectPath, refreshPackageScripts]);

  const showPackageScriptsEntry = Boolean(
    packageScripts?.hasPackageJson && packageScripts.scripts.length > 0,
  );

  const refreshBackgroundTerminalTasks = useCallback(async () => {
    if (!currentProjectPath || !window.eco?.listBackgroundTerminalTasks) {
      setBackgroundTerminalTasks([]);
      return;
    }
    try {
      const tasks = await window.eco.listBackgroundTerminalTasks({ workspacePath: currentProjectPath });
      setBackgroundTerminalTasks(tasks);
    } catch {
      setBackgroundTerminalTasks([]);
    }
  }, [currentProjectPath]);

  useEffect(() => {
    void refreshBackgroundTerminalTasks();
  }, [refreshBackgroundTerminalTasks]);

  useEffect(() => {
    if (!window.eco?.onTerminalEvent) {
      return undefined;
    }
    return window.eco.onTerminalEvent((event) => {
      if (event.type === "started" || event.type === "exit" || event.type === "error") {
        void refreshBackgroundTerminalTasks();
      }
      if (event.type === "exit" || event.type === "error") {
        setTerminalLifecycleEpoch((epoch) => epoch + 1);
      }
    });
  }, [refreshBackgroundTerminalTasks]);

  const dismissPackageScriptRunOverlays = useCallback(() => {
    setScriptsDialogOpen(false);
  }, []);

  const openPackageScriptTerminalSession = useCallback(
    (workspacePath: string, sessionId: string) => {
      setTerminalByProject((current) => {
        const existing = getProjectTerminalState(current, workspacePath);
        const stored = storedTerminalByProject[workspacePath];
        const nextState =
          existing && existing.tabs.length > 0
            ? { ...existing, open: true }
            : createProjectTerminalState(
                projects.find((item) => item.path === workspacePath)?.name ?? pathToName(workspacePath),
                true,
              );
        return {
          ...current,
          [workspacePath]: {
            ...nextState,
            height: existing?.height ?? stored?.height ?? nextState.height,
          },
        };
      });
      setInjectedTerminalSessionId(sessionId);
    },
    [projects, storedTerminalByProject],
  );

  const openBackgroundTerminalTask = useCallback(
    async (task: BackgroundTerminalTask) => {
      if (!window.eco?.openBackgroundTerminalTask) {
        openPackageScriptTerminalSession(task.workspacePath, task.sessionId);
        return;
      }
      try {
        const resolved = await window.eco.openBackgroundTerminalTask({ taskId: task.taskId });
        openPackageScriptTerminalSession(resolved.workspacePath, resolved.sessionId);
      } catch {
        openPackageScriptTerminalSession(task.workspacePath, task.sessionId);
      }
    },
    [openPackageScriptTerminalSession],
  );

  const stopBackgroundTerminalTask = useCallback(
    async (task: BackgroundTerminalTask) => {
      if (!window.eco?.stopBackgroundTerminalTask) {
        return;
      }
      try {
        await window.eco.stopBackgroundTerminalTask({ taskId: task.taskId });
      } finally {
        void refreshBackgroundTerminalTasks();
      }
    },
    [refreshBackgroundTerminalTasks],
  );

  const presentPackageScriptTerminal = useCallback(
    async (workspacePath: string, sessionId: string) => {
      const dismissStartedAt = performance.now();
      dismissPackageScriptRunOverlays();
      void refreshBackgroundTerminalTasks();
      await waitForOverlayDismiss(dismissStartedAt);
      openPackageScriptTerminalSession(workspacePath, sessionId);
    },
    [dismissPackageScriptRunOverlays, openPackageScriptTerminalSession, refreshBackgroundTerminalTasks],
  );

  useEffect(() => {
    if (!window.eco?.onPackageScriptTerminalLaunch) {
      return undefined;
    }
    return window.eco.onPackageScriptTerminalLaunch((payload) => {
      if (!currentProjectPath || payload.workspacePath !== currentProjectPath) {
        return;
      }
      void presentPackageScriptTerminal(payload.workspacePath, payload.sessionId);
    });
  }, [currentProjectPath, presentPackageScriptTerminal]);

  const startPackageScript = useCallback(
    async (scriptName: string, args?: string) => {
      if (!currentProjectPath || !window.eco) {
        return;
      }
      const trimmedArgs = args?.trim();
      const dismissStartedAt = performance.now();
      dismissPackageScriptRunOverlays();
      setScriptsBusy(true);
      try {
        const result = await window.eco.startPackageScript({
          workspacePath: currentProjectPath,
          script: scriptName,
          ...(trimmedArgs && { args: trimmedArgs }),
          ...(activeThread?.id && { threadId: activeThread.id }),
        });
        void refreshBackgroundTerminalTasks();
        await waitForOverlayDismiss(dismissStartedAt);
        openPackageScriptTerminalSession(currentProjectPath, result.sessionId);
      } catch (error) {
        console.error(error);
      } finally {
        setScriptsBusy(false);
      }
    },
    [
      activeThread?.id,
      currentProjectPath,
      dismissPackageScriptRunOverlays,
      openPackageScriptTerminalSession,
      refreshBackgroundTerminalTasks,
    ],
  );

  useEffect(() => {
    const onFocus = () => {
      void refreshGitStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshGitStatus]);

  useEffect(() => {
    if (!currentProjectPath || !window.eco?.onGitRemoteFetched) {
      return undefined;
    }
    return window.eco.onGitRemoteFetched((workspacePath) => {
      if (workspacePath === currentProjectPath) {
        void refreshGitStatus();
      }
    });
  }, [currentProjectPath, refreshGitStatus]);

  useEffect(() => {
    if (!window.eco) {
      return;
    }
    void window.eco.getGitSettings().then(setGitSettings);
  }, []);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "skills" || !window.eco) {
      return;
    }
    void refreshSkillsList();
  }, [settingsOpen, settingsSection]);

  useEffect(() => {
    if (!window.eco) {
      return;
    }
    void refreshSkillsList(currentProjectPath);
  }, [currentProjectPath]);

  useEffect(() => {
    if (activeThread) {
      setComposerRoutePopoverOpen(false);
    }
  }, [activeThread?.id]);

  const userSkills = useMemo(
    () => dedupeSkillsByName((skillsSnapshot?.userSkills ?? []).filter((skill) => skill.sdkReady)),
    [skillsSnapshot?.userSkills],
  );
  const projectSdkReadySkills = useMemo(
    () => listSdkReadyProjectSkills(skillsSnapshot?.projectSkills ?? []),
    [skillsSnapshot?.projectSkills],
  );
  const slashPickerSkills = useMemo(
    () => dedupeSkillsByName([...userSkills, ...projectSdkReadySkills]),
    [userSkills, projectSdkReadySkills],
  );
  const projectAgentsOnly = useMemo(
    () => (skillsSnapshot?.agentsOnlySkills ?? []).filter((skill) => skill.source === "project"),
    [skillsSnapshot?.agentsOnlySkills],
  );
  const showProjectSkillsPanel =
    Boolean(currentProjectPath) &&
    (isLoadingSkills || projectSdkReadySkills.length > 0 || projectAgentsOnly.length > 0);
  const composerSkillSlash = useMemo(() => parseSlashQuery(prompt, composerCursor), [prompt, composerCursor]);
  const referencedSkillNames = useMemo(() => new Set(parseExplicitSkillNames(prompt)), [prompt]);
  const composerSkillMatches = useMemo(() => {
    if (!composerSkillSlash) {
      return [];
    }
    return filterSkillsForSlash(composerSkillSlash.query, slashPickerSkills, referencedSkillNames);
  }, [composerSkillSlash, slashPickerSkills, referencedSkillNames]);
  const composerSkillPopoverOpen = Boolean(composerSkillSlash) && slashPickerSkills.length > 0;

  useEffect(() => {
    setComposerSkillActiveIndex(Math.max(0, composerSkillMatches.length - 1));
  }, [composerSkillSlash?.query, composerSkillSlash?.start, composerSkillMatches.length]);

  const buildComposerDefaultConfig = useCallback(
    (planModeOverride?: boolean): ThreadRuntimeConfig | undefined => {
      if (settings.orchestrationProfiles.length === 0) {
        return undefined;
      }
      try {
        const agentProfileId =
          composerRuntimeConfig?.agentProfileId ??
          composerRuntimeConfig?.routeProfileId ??
          getDefaultAgentProfileId(settings);
        const routeProfileId = composerRuntimeConfig?.routeProfileId;
        const workflowDefaults =
          planModeOverride === undefined
            ? workflowSettings
            : {
                ...workflowSettings,
                sessionMode: planModeOverride ? ("plan" as const) : ("agent" as const),
              };
        return buildThreadRuntimeConfigFromDefaults({
          settings,
          workflowDefaults,
          mcpServers: mcpSettings.servers,
          ...(agentProfileId && { agentProfileId }),
          ...(routeProfileId && { routeProfileId }),
        });
      } catch {
        return undefined;
      }
    },
    [
      settings,
      composerRuntimeConfig?.agentProfileId,
      composerRuntimeConfig?.routeProfileId,
      workflowSettings,
      mcpSettings.servers,
    ],
  );

  const resetComposerDefaultConfig = useCallback(() => {
    setComposerRuntimeConfig(buildComposerDefaultConfig(false) ?? null);
  }, [buildComposerDefaultConfig]);

  useEffect(() => {
    if (activeThread?.runtimeConfig) {
      setComposerRuntimeConfig(activeThread.runtimeConfig);
      return;
    }
    const defaults = buildComposerDefaultConfig();
    if (defaults) {
      setComposerRuntimeConfig(defaults);
    }
  }, [
    activeThread?.id,
    activeThread?.runtimeConfig,
    buildComposerDefaultConfig,
    settings.orchestrationProfiles,
    settings.routeProfiles,
  ]);

  const selectedRuntimeProfileId =
    composerRuntimeConfig?.agentProfileId ?? composerRuntimeConfig?.routeProfileId;
  const selectedRuntimeProfile = useMemo(
    () => (composerRuntimeConfig ? resolveThreadAgentProfile(settings, composerRuntimeConfig) : undefined),
    [settings, composerRuntimeConfig],
  );
  const composerMcpSettings = useMemo(() => {
    const availableServerKeys = listEnabledGlobalMcpServerKeys(mcpSettings.servers);
    if (availableServerKeys.length === 0) {
      return {};
    }
    if (composerRuntimeConfig?.mcpServersEnabled) {
      return deriveMcpServersEnabled(availableServerKeys, {
        existing: composerRuntimeConfig.mcpServersEnabled,
      });
    }
    return deriveMcpServersEnabled(availableServerKeys, {
      profileAssignedServers: selectedRuntimeProfile
        ? collectProfileAssignedMcpServers(selectedRuntimeProfile, settings.agentTemplates)
        : [],
      remembered: workflowSettings.mcpServersEnabled,
    });
  }, [
    composerRuntimeConfig?.mcpServersEnabled,
    mcpSettings.servers,
    selectedRuntimeProfile,
    settings.agentTemplates,
    workflowSettings.mcpServersEnabled,
  ]);
  const activeRoutes = useMemo(() => {
    return selectedRuntimeProfile ? runtimeRoleRoutesFromAgentProfile(selectedRuntimeProfile) : [];
  }, [selectedRuntimeProfile]);

  useEffect(() => {
    if (!window.eco || activeRoutes.length === 0) {
      setRoutePricingHints([]);
      return;
    }
    void window.eco.getRoutePricing(activeRoutes).then(setRoutePricingHints);
  }, [activeRoutes, settings.providers]);

  useEffect(() => {
    if (!window.eco?.getRouteCapabilities || activeRoutes.length === 0) {
      return;
    }
    void window.eco.getRouteCapabilities(activeRoutes).then((hints) => {
      setPlannerCapability(hints.find((hint) => hint.role === "planner"));
    });
  }, [activeRoutes, settings.providers]);
  const providerById = useMemo(
    () => new Map(settings.providers.map((provider) => [provider.id, provider])),
    [settings.providers],
  );
  const routesReady = selectedRuntimeProfile
    ? isAgentProfileReady(selectedRuntimeProfile, providerById) &&
      (selectedRuntimeProfile.preset !== "coding" || areCodingRoutesReady(activeRoutes, providerById))
    : areCodingRoutesReady(activeRoutes, providerById);
  const threadAcceptsInput = !activeThread || isContinuableThreadStatus(activeThread.status);
  const composerFollowUpMode = Boolean(activeThread && isLiveFollowUpThreadStatus(activeThread.status));
  const showBashApproval = Boolean(pendingBashApproval);
  const plannerSupportsImages =
    !plannerCapability?.capabilitiesResolved || plannerCapability.supportsImageInput;
  const canPasteComposerImages = plannerSupportsImages;
  const composerHasContent = Boolean(prompt.trim() || composerAttachments.length > 0);
  const runProjection = activeThread ? runProjectionByThread[activeThread.id] : undefined;
  const contextCompactionInFlight = isThreadContextCompactionInFlight(runProjection);
  const autoCompactSuspended = isThreadAutoCompactSuspended(runProjection);
  const promptCacheInvalidated = isThreadPromptCacheInvalidated(runProjection);
  const promptCacheBaselineByThreadRef = useRef<Record<string, ThreadRuntimeConfig>>({});
  const [promptCacheBaselineVersion, setPromptCacheBaselineVersion] = useState(0);

  useEffect(() => {
    const threadId = activeThread?.id;
    const runtimeConfig = activeThread?.runtimeConfig;
    if (!threadId || !runtimeConfig || !runProjection?.timeline.length) {
      return;
    }
    if (promptCacheBaselineByThreadRef.current[threadId]) {
      return;
    }
    promptCacheBaselineByThreadRef.current[threadId] = runtimeConfig;
    setPromptCacheBaselineVersion((current) => current + 1);
  }, [activeThread?.id, activeThread?.runtimeConfig, runProjection?.timeline.length]);

  const composerPromptCacheDrift = useMemo(() => {
    const threadId = activeThread?.id;
    if (!threadId || !composerRuntimeConfig || !runProjection?.timeline.length) {
      return null;
    }
    const baseline = promptCacheBaselineByThreadRef.current[threadId];
    if (!baseline) {
      return null;
    }
    const drift = resolvePromptCacheConfigDrift({
      baseline,
      current: composerRuntimeConfig,
      settings,
      mcpServers: mcpSettings.servers,
    });
    return drift.length > 0 ? drift : null;
  }, [
    activeThread?.id,
    composerRuntimeConfig,
    mcpSettings.servers,
    promptCacheBaselineVersion,
    runProjection?.timeline.length,
    settings,
  ]);
  const composerPromptCacheProfileLabel =
    composerPromptCacheDrift?.includes("profile") && composerRuntimeConfig
      ? resolvePromptCacheProfileLabel(settings, composerRuntimeConfig)
      : undefined;
  const composerPromptCacheHint = composerPromptCacheDrift
    ? formatPromptCacheConfigDriftHint(
        composerPromptCacheDrift,
        composerPromptCacheProfileLabel ? { profileLabel: composerPromptCacheProfileLabel } : undefined,
      )
    : null;

  const canSendFollowUp = Boolean(
    currentProjectPath &&
      activeThread &&
      composerFollowUpMode &&
      composerHasContent &&
      !followUpBusy &&
      !isStarting &&
      !planActionBusy &&
      !contextCompactionInFlight,
  );
  const canSendThreadMessage = Boolean(
    currentProjectPath &&
      composerHasContent &&
      routesReady &&
      !isStarting &&
      !planActionBusy &&
      !clarificationBusy &&
      !bashApprovalBusy &&
      !pendingClarification &&
      !pendingBashApproval &&
      !contextCompactionInFlight &&
      threadAcceptsInput,
  );
  const canSend = composerFollowUpMode ? canSendFollowUp : canSendThreadMessage;
  const showPlanApproval = Boolean(activeThread && pendingPlan);
  const showComposerDockApproval = showBashApproval || showPlanApproval;
  const composerDockSurfaceKey = showBashApproval
    ? `bash-${pendingBashApproval!.toolUseId}`
    : showPlanApproval
      ? `plan-${activeThread?.id ?? "unknown"}`
      : "composer";

  const showClarification = Boolean(pendingClarification);

  const planFailureMessage = activeThread ? extractPlanFailureMessage(activeThread.message) : undefined;

  useEffect(() => {
    const prevKey = prevComposerContextKeyRef.current;
    if (prevKey !== undefined && prevKey !== composerContextKey) {
      persistComposerDraftSnapshot(composerDraftsByKeyRef.current, prevKey, {
        prompt: composerPromptRef.current,
        attachments: composerAttachmentsRef.current,
        ...(composerRewindTargetRef.current ? { rewindTarget: composerRewindTargetRef.current } : {}),
      });
    }

    if (prevKey !== composerContextKey) {
      const draft = composerContextKey ? composerDraftsByKeyRef.current[composerContextKey] : undefined;
      const threadId = composerContextKey ? threadIdFromComposerContextKey(composerContextKey) : undefined;
      setEditingFollowUpId(undefined);
      setPrompt(draft?.prompt ?? "");
      setComposerAttachments(draft?.attachments ? [...draft.attachments] : []);
      setComposerRewindTarget(
        draft?.rewindTarget && (!threadId || draft.rewindTarget.threadId === threadId)
          ? draft.rewindTarget
          : undefined,
      );
      setComposerImageNotice(undefined);
      prevComposerContextKeyRef.current = composerContextKey;
    }
  }, [composerContextKey]);

  const canStopThread =
    activeThread?.status === "running" ||
    activeThread?.status === "queued" ||
    activeThread?.status === "awaiting_plan";

  const activeFollowUps = activeThread ? (followUpsByThread[activeThread.id] ?? []) : [];
  const queuedFollowUps = useMemo(() => queuedThreadFollowUps(activeFollowUps), [activeFollowUps]);
  const displayedQueuedFollowUps = useMemo(
    () => queuedFollowUps.filter((followUp) => followUp.id !== editingFollowUpId),
    [queuedFollowUps, editingFollowUpId],
  );
  const subagentTimings = activeThread ? subagentTimingsByThread[activeThread.id] : undefined;
  const subagentMetrics = activeThread ? subagentMetricsByThread[activeThread.id] : undefined;
  const coderTodos = activeThread ? (todosByThread[activeThread.id] ?? []) : [];
  const threadUsageByRole = activeThread ? usageByThread[activeThread.id] : undefined;
  const threadModelByRole = activeThread ? modelByThread[activeThread.id] : undefined;
  const activeRuntimeAgentDisplayNames = useMemo(
    () => buildRuntimeAgentDisplayNames(settings, activeThread?.runtimeConfig),
    [settings, activeThread?.runtimeConfig],
  );
  const activeRuntimeAgentThemes = useMemo(
    () => buildRuntimeAgentThemes(settings, activeThread?.runtimeConfig),
    [settings, activeThread?.runtimeConfig],
  );
  const activeProjectionViewModel = useMemo(
    () =>
      runProjection
        ? buildThreadRunProjectionViewModel(
            runProjection,
            activeThread ? { id: activeThread.id, prompt: activeThread.prompt } : undefined,
            { agentDisplayNames: activeRuntimeAgentDisplayNames },
          )
        : undefined,
    [activeRuntimeAgentDisplayNames, activeThread?.id, activeThread?.prompt, runProjection],
  );
  const activeSubagentCards = useMemo(
    () => activeProjectionViewModel?.subagentCards ?? [],
    [activeProjectionViewModel?.subagentCards],
  );
  const activityUserMessageNavItems = useMemo(() => {
    if (!activeThread || !activeProjectionViewModel) {
      return [];
    }
    const drafts: ActivityUserMessageNavItemDraft[] = [];
    let currentDraft: ActivityUserMessageNavItemDraft | undefined;
    if (activeProjectionViewModel.showThreadPrompt && activeThread.prompt.trim()) {
      currentDraft = buildActivityUserMessageNavItem(
        `thread:${activeThread.id}`,
        activeThread.prompt,
        drafts.length,
      );
      drafts.push(currentDraft);
    }
    for (const entry of activeProjectionViewModel.mainFeedEntries) {
      if (entry.kind === "timeline" && isProjectionUserPromptItem(entry.item)) {
        currentDraft = buildActivityUserMessageNavItem(entry.item.id, entry.item.text, drafts.length);
        drafts.push(currentDraft);
        continue;
      }
      if (currentDraft) {
        collectActivityUserMessageRoundEntry(currentDraft, entry);
      }
    }
    return drafts.map(finishActivityUserMessageNavItem);
  }, [activeProjectionViewModel, activeThread?.id, activeThread?.prompt]);

  useEffect(() => {
    setSelectedSubagentAgentId(undefined);
    setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
    setOpenSubagentTabIds([]);
    setTaskDrawerOpen(false);
    setTaskPanelFullscreen(false);
  }, [activeThread?.id]);

  useEffect(() => {
    setOpenSubagentTabIds((current) => {
      const next = current.filter((tabId) => activeSubagentCards.some((card) => card.key === tabId));
      if (next.length === current.length && next.every((tabId, index) => tabId === current[index])) {
        return current;
      }
      return next;
    });
    if (
      taskPanelActiveTab !== TASK_PANEL_REVIEW_TAB_ID &&
      taskPanelActiveTab !== TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID &&
      !activeSubagentCards.some((card) => card.key === taskPanelActiveTab)
    ) {
      setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
      setSelectedSubagentAgentId(undefined);
    }
  }, [activeSubagentCards, taskPanelActiveTab]);

  const closeWorkspacePanelForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    setWorkspacePanelByProject((current) => {
      const existing = current[currentProjectPath];
      if (!existing?.open) {
        return current;
      }
      return {
        ...current,
        [currentProjectPath]: { ...existing, open: false },
      };
    });
  }, [currentProjectPath]);

  const toggleTaskPanelForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    if (taskDrawerOpen) {
      setTaskDrawerOpen(false);
      setTaskPanelFullscreen(false);
      return;
    }
    closeWorkspacePanelForCurrentProject();
    setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    setTaskDrawerOpen(true);
  }, [closeWorkspacePanelForCurrentProject, currentProjectPath, taskDrawerOpen]);

  const openReviewTaskDrawer = useCallback(() => {
    closeWorkspacePanelForCurrentProject();
    setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
    setOpenSubagentTabIds([]);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    setTaskDrawerOpen(true);
  }, [closeWorkspacePanelForCurrentProject]);

  const openSubagentTaskDrawer = useCallback(
    (agentId: string) => {
      closeWorkspacePanelForCurrentProject();
      setOpenSubagentTabIds((current) => (current.includes(agentId) ? current : [...current, agentId]));
      setTaskPanelActiveTab(agentId);
      setSelectedSubagentAgentId(agentId);
      setTaskPanelFullscreen(false);
      setTaskDrawerOpen(true);
    },
    [closeWorkspacePanelForCurrentProject],
  );

  const closeSubagentTaskTab = useCallback(
    (agentId: string) => {
      setOpenSubagentTabIds((current) => {
        const next = current.filter((tabId) => tabId !== agentId);
        if (taskPanelActiveTab === agentId) {
          const fallback = next.at(-1);
          setTaskPanelActiveTab(fallback ?? TASK_PANEL_REVIEW_TAB_ID);
          setSelectedSubagentAgentId(fallback);
        }
        return next;
      });
    },
    [taskPanelActiveTab],
  );

  const handleTaskPanelResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!taskDrawerOpen || event.button !== 0) {
        return;
      }
      event.preventDefault();
      taskPanelResizeRef.current = {
        startX: event.clientX,
        startWidth: taskPanelWidth,
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const session = taskPanelResizeRef.current;
        if (!session) {
          return;
        }
        setTaskPanelWidth(clampTaskPanelWidth(session.startWidth + (session.startX - moveEvent.clientX)));
      };
      const handleMouseEnd = () => {
        taskPanelResizeRef.current = undefined;
        document.body.classList.remove("is-resizing-task-panel");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseEnd);
      };

      document.body.classList.add("is-resizing-task-panel");
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseEnd);
    },
    [taskDrawerOpen, taskPanelWidth],
  );

  const handleTaskPanelResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 24;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTaskPanelWidth((current) => clampTaskPanelWidth(current + step));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setTaskPanelWidth((current) => clampTaskPanelWidth(current - step));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setTaskPanelWidth(MIN_TASK_PANEL_WIDTH);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setTaskPanelWidth(MAX_TASK_PANEL_WIDTH);
    }
  }, []);

  const threadUsageSummary = useMemo(() => {
    if (!activeThread) {
      return undefined;
    }
    const rawBilling = billingByThread[activeThread.id];
    const billing = rawBilling ? enrichBillingDisplaySource(rawBilling, activeThread.status) : undefined;
    return buildThreadUsageSummary({
      ...(billing && { billing }),
      ...(contextByThread[activeThread.id] && { context: contextByThread[activeThread.id] }),
      ...(threadUsageByRole && { usageByRole: threadUsageByRole }),
    });
  }, [activeThread, threadUsageByRole, billingByThread, contextByThread]);
  const selectedAgentProfileSummary = useMemo(
    () =>
      findSelectableAgentProfileSummary(
        settings,
        selectedRuntimeProfileId,
        composerRuntimeConfig ?? undefined,
      ),
    [settings, selectedRuntimeProfileId, composerRuntimeConfig],
  );
  const canEditComposerConfig =
    !activeThread ||
    (threadAcceptsInput && activeThread.status !== "running" && activeThread.status !== "queued");
  const canEditBashReviewMode = Boolean(composerRuntimeConfig);
  const canSwitchRouteProfile = canEditComposerConfig;
  const agentModelLabels = useMemo(
    () =>
      buildComposerAgentModelLabels({
        routes: activeRoutes,
        threadModelByRole,
        profile:
          selectedRuntimeProfile && composerRuntimeConfig?.agentProfileId?.trim()
            ? selectedRuntimeProfile
            : undefined,
        templates: settings.agentTemplates,
      }),
    [
      activeRoutes,
      composerRuntimeConfig?.agentProfileId,
      selectedRuntimeProfile,
      settings.agentTemplates,
      threadModelByRole,
    ],
  );
  const activityModelByRole = useMemo(() => {
    const configured: Record<string, string> = {};
    for (const route of activeRoutes) {
      const modelId = route.modelId.trim();
      if (modelId) {
        configured[route.role] = modelId;
      }
    }
    const merged: Record<string, string> = { ...configured };
    for (const [role, live] of Object.entries(threadModelByRole ?? {})) {
      const displayModelId = pickDisplayModelId(live, configured[role]);
      if (displayModelId) {
        merged[role] = displayModelId;
      }
    }
    return merged;
  }, [activeRoutes, threadModelByRole]);
  const activityMessagesRef = useRef<HTMLDivElement>(null);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const mainPaneRef = useRef<HTMLDivElement>(null);
  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const workspaceCardsPanelRef = useRef<HTMLElement>(null);
  const [topbarSolid, setTopbarSolid] = useState(true);
  const userDetachedFromBottomRef = useRef(false);
  const activityFeedScrollTopRef = useRef(0);
  const programmaticActivityFeedScrollRef = useRef(false);
  const forceActivityFeedScrollUntilRef = useRef(0);
  const activityFeedUserScrollDirectionRef = useRef<ActivityFeedUserScrollDirection | null>(null);
  const activityFeedScrollJumpRef = useRef<ActivityFeedScrollJump | null>(null);
  const [activityFeedScrollJump, setActivityFeedScrollJump] = useState<ActivityFeedScrollJump | null>(null);
  const activeActivityUserMessageNavIdRef = useRef<string | undefined>(undefined);
  const [activeActivityUserMessageNavId, setActiveActivityUserMessageNavId] = useState<string>();
  const activityFeedLayoutScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityFeedLayoutScrollAtRef = useRef(0);
  const activityUserMessageJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<ComposerSkillsInputHandle>(null);
  const COMPOSER_TEXTAREA_MAX_HEIGHT = 200;
  const runProjectionLayoutSignature = useMemo(() => {
    if (!runProjection?.sourceEventCount) {
      return "";
    }
    const lastMainItem = runProjection.timeline.at(-1);
    const agentSignature = runProjection.agents
      .map((agent) => {
        const lastAgentItem = agent.timeline.at(-1);
        return `${agent.agentId}:${agent.status}:${agent.timeline.length}:${lastAgentItem?.id ?? ""}:${lastAgentItem?.text.length ?? 0}`;
      })
      .join(",");
    return [
      runProjection.sourceEventCount,
      runProjection.thread.status,
      lastMainItem?.id ?? "",
      agentSignature,
    ].join("|");
  }, [runProjection]);

  const composerSkillsByName = useMemo(
    () => buildSkillMap([...userSkills, ...projectSdkReadySkills]),
    [userSkills, projectSdkReadySkills],
  );

  const distanceFromActivityFeedBottom = useCallback((container: HTMLElement) => {
    return container.scrollHeight - container.scrollTop - container.clientHeight;
  }, []);

  const clampActivityFeedOverscroll = useCallback((container: HTMLElement): boolean => {
    const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
    if (container.scrollTop <= maxScrollTop) {
      return false;
    }
    programmaticActivityFeedScrollRef.current = true;
    container.scrollTop = maxScrollTop;
    activityFeedScrollTopRef.current = container.scrollTop;
    requestAnimationFrame(() => {
      programmaticActivityFeedScrollRef.current = false;
    });
    return true;
  }, []);

  const syncActivityFeedScrollJump = useCallback(
    (container: HTMLElement) => {
      const next = resolveActivityFeedScrollJump(
        container.scrollTop,
        distanceFromActivityFeedBottom(container),
        activityFeedUserScrollDirectionRef.current,
      );
      if (next !== activityFeedScrollJumpRef.current) {
        activityFeedScrollJumpRef.current = next;
        setActivityFeedScrollJump(next);
      }
    },
    [distanceFromActivityFeedBottom],
  );

  const updateActiveActivityUserMessageNavId = useCallback((next: string | undefined) => {
    if (activeActivityUserMessageNavIdRef.current === next) {
      return;
    }
    activeActivityUserMessageNavIdRef.current = next;
    setActiveActivityUserMessageNavId(next);
  }, []);

  const syncActivityUserMessageNavigator = useCallback(
    (container: HTMLElement) => {
      const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-user-message-anchor-id]"));
      if (anchors.length === 0) {
        updateActiveActivityUserMessageNavId(undefined);
        return;
      }
      const containerRect = container.getBoundingClientRect();
      const markerY = containerRect.top + containerRect.height * 0.46;
      let activeAnchor = anchors[0];
      for (const anchor of anchors) {
        const rect = anchor.getBoundingClientRect();
        if (rect.top <= markerY || rect.bottom <= containerRect.top + 16) {
          activeAnchor = anchor;
          continue;
        }
        break;
      }
      updateActiveActivityUserMessageNavId(activeAnchor?.dataset.userMessageAnchorId);
    },
    [updateActiveActivityUserMessageNavId],
  );

  const jumpToActivityUserMessage = useCallback(
    (anchorId: string) => {
      const container = activityMessagesRef.current;
      if (!container) {
        return;
      }
      const anchors = Array.from(container.querySelectorAll<HTMLElement>("[data-user-message-anchor-id]"));
      const target = anchors.find((anchor) => anchor.dataset.userMessageAnchorId === anchorId);
      if (!target) {
        return;
      }
      if (activityUserMessageJumpTimerRef.current) {
        clearTimeout(activityUserMessageJumpTimerRef.current);
      }
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const targetTop = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - 18);
      userDetachedFromBottomRef.current = true;
      activityFeedUserScrollDirectionRef.current = targetTop < container.scrollTop ? "up" : "down";
      programmaticActivityFeedScrollRef.current = true;
      updateActiveActivityUserMessageNavId(anchorId);
      container.scrollTo({ top: targetTop, behavior: "smooth" });
      activityUserMessageJumpTimerRef.current = setTimeout(() => {
        activityUserMessageJumpTimerRef.current = null;
        programmaticActivityFeedScrollRef.current = false;
        if (activityMessagesRef.current !== container) {
          return;
        }
        activityFeedScrollTopRef.current = container.scrollTop;
        syncActivityFeedScrollJump(container);
        syncActivityUserMessageNavigator(container);
      }, 360);
    },
    [syncActivityFeedScrollJump, syncActivityUserMessageNavigator, updateActiveActivityUserMessageNavId],
  );

  const scrollActivityFeedToEnd = useCallback(
    (force = false) => {
      const container = activityMessagesRef.current;
      if (!container) {
        return;
      }
      const effectiveForce = force || Date.now() < forceActivityFeedScrollUntilRef.current;
      if (!effectiveForce && userDetachedFromBottomRef.current) {
        return;
      }
      programmaticActivityFeedScrollRef.current = true;
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = maxScrollTop;
      activityFeedScrollTopRef.current = container.scrollTop;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          programmaticActivityFeedScrollRef.current = false;
          const el = activityMessagesRef.current;
          if (!el) {
            return;
          }
          activityFeedScrollTopRef.current = el.scrollTop;
          if (distanceFromActivityFeedBottom(el) <= ACTIVITY_FEED_STICK_THRESHOLD_PX) {
            userDetachedFromBottomRef.current = false;
            activityFeedUserScrollDirectionRef.current = null;
          }
          syncActivityFeedScrollJump(el);
        });
      });
    },
    [distanceFromActivityFeedBottom, syncActivityFeedScrollJump],
  );

  const scheduleActivityFeedLayoutScroll = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastActivityFeedLayoutScrollAtRef.current;
    if (elapsed >= ACTIVITY_FEED_LAYOUT_SCROLL_DEBOUNCE_MS) {
      lastActivityFeedLayoutScrollAtRef.current = now;
      scrollActivityFeedToEnd();
      requestAnimationFrame(() => scrollActivityFeedToEnd());
      return;
    }
    if (activityFeedLayoutScrollTimerRef.current) {
      return;
    }
    activityFeedLayoutScrollTimerRef.current = setTimeout(() => {
      activityFeedLayoutScrollTimerRef.current = null;
      lastActivityFeedLayoutScrollAtRef.current = Date.now();
      scrollActivityFeedToEnd();
      requestAnimationFrame(() => scrollActivityFeedToEnd());
    }, ACTIVITY_FEED_LAYOUT_SCROLL_DEBOUNCE_MS - elapsed);
  }, [scrollActivityFeedToEnd]);

  const flushActivityFeedLayoutScroll = useCallback(() => {
    if (activityFeedLayoutScrollTimerRef.current) {
      clearTimeout(activityFeedLayoutScrollTimerRef.current);
      activityFeedLayoutScrollTimerRef.current = null;
    }
    lastActivityFeedLayoutScrollAtRef.current = Date.now();
    scrollActivityFeedToEnd();
    requestAnimationFrame(() => scrollActivityFeedToEnd());
  }, [scrollActivityFeedToEnd]);

  useEffect(
    () => () => {
      if (activityFeedLayoutScrollTimerRef.current) {
        clearTimeout(activityFeedLayoutScrollTimerRef.current);
      }
      if (activityUserMessageJumpTimerRef.current) {
        clearTimeout(activityUserMessageJumpTimerRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!currentProjectPath || taskDrawerOpen) {
      setWorkspaceCardsAutoHidden(false);
      return undefined;
    }

    const mainPane = mainPaneRef.current;
    if (!mainPane) {
      return undefined;
    }

    const readCssPixelValue = (value: string): number => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const measureShouldHide = (currentlyHidden: boolean): boolean => {
      const scrollBody = scrollBodyRef.current;
      const workspacePanel = workspaceCardsPanelRef.current;
      const feed = scrollBody?.querySelector<HTMLElement>(".codex-feed-stack");
      if (!workspacePanel || !feed) {
        const paneWidth = mainPane.getBoundingClientRect().width;
        return currentlyHidden
          ? paneWidth < WORKSPACE_CARDS_FALLBACK_SHOW_WIDTH_PX
          : paneWidth < WORKSPACE_CARDS_FALLBACK_HIDE_WIDTH_PX;
      }

      const paneRect = mainPane.getBoundingClientRect();
      const feedRect = feed.getBoundingClientRect();
      const panelStyle = window.getComputedStyle(workspacePanel);
      const panelWidth = workspacePanel.offsetWidth || readCssPixelValue(panelStyle.width) || 300;
      const panelRight = readCssPixelValue(panelStyle.right);
      const panelLeft = paneRect.right - panelRight - panelWidth;
      const clearance = panelLeft - feedRect.right;
      const requiredClearance = currentlyHidden
        ? WORKSPACE_CARDS_RESPONSIVE_GAP_PX + WORKSPACE_CARDS_RESPONSIVE_HYSTERESIS_PX
        : WORKSPACE_CARDS_RESPONSIVE_GAP_PX;
      return clearance < requiredClearance;
    };

    let frame = 0;
    const update = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        setWorkspaceCardsAutoHidden((current) => measureShouldHide(current));
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(mainPane);
    const scrollBody = scrollBodyRef.current;
    if (scrollBody) {
      observer.observe(scrollBody);
      const feed = scrollBody.querySelector<HTMLElement>(".codex-feed-stack");
      if (feed) {
        observer.observe(feed);
      }
    }
    const workspacePanel = workspaceCardsPanelRef.current;
    if (workspacePanel) {
      observer.observe(workspacePanel);
    }
    window.addEventListener("resize", update);
    update();

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeThread?.id, currentProjectPath, taskDrawerOpen]);

  useEffect(() => {
    setWorkspaceCardsManualRevealProjectPath((current) => {
      if (!current) {
        return current;
      }
      if (current !== currentProjectPath || !workspaceCardsAutoHidden) {
        return undefined;
      }
      return current;
    });
  }, [currentProjectPath, workspaceCardsAutoHidden]);

  const requestActivityFeedForceScroll = useCallback(() => {
    forceActivityFeedScrollUntilRef.current = Date.now() + ACTIVITY_FEED_FORCE_SCROLL_MS;
    userDetachedFromBottomRef.current = false;
    activityFeedUserScrollDirectionRef.current = null;
    activityFeedScrollJumpRef.current = null;
    setActivityFeedScrollJump(null);
    scrollActivityFeedToEnd(true);
    requestAnimationFrame(() => {
      scrollActivityFeedToEnd(true);
      requestAnimationFrame(() => scrollActivityFeedToEnd(true));
    });
  }, [scrollActivityFeedToEnd]);

  const jumpActivityFeedToTop = useCallback(() => {
    const container = activityMessagesRef.current;
    if (!container) {
      return;
    }
    userDetachedFromBottomRef.current = true;
    activityFeedUserScrollDirectionRef.current = "up";
    programmaticActivityFeedScrollRef.current = true;
    container.scrollTo({ top: 0, behavior: "smooth" });
    activityFeedScrollTopRef.current = 0;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticActivityFeedScrollRef.current = false;
        if (activityMessagesRef.current) {
          syncActivityFeedScrollJump(activityMessagesRef.current);
        }
      });
    });
  }, [syncActivityFeedScrollJump]);

  const handleActivityFeedScrollJump = useCallback(() => {
    if (activityFeedScrollJump === "top") {
      jumpActivityFeedToTop();
      return;
    }
    requestActivityFeedForceScroll();
  }, [activityFeedScrollJump, jumpActivityFeedToTop, requestActivityFeedForceScroll]);

  const handleActivityPlannerLayoutChange = useCallback(
    (options?: { immediate?: boolean }) => {
      if (options?.immediate) {
        const container = activityMessagesRef.current;
        if (container) {
          clampActivityFeedOverscroll(container);
        }
        flushActivityFeedLayoutScroll();
        return;
      }
      scheduleActivityFeedLayoutScroll();
    },
    [clampActivityFeedOverscroll, flushActivityFeedLayoutScroll, scheduleActivityFeedLayoutScroll],
  );

  useEffect(() => {
    const container = activityMessagesRef.current;
    if (!container) {
      return;
    }
    activityFeedScrollTopRef.current = container.scrollTop;
    const onScroll = () => {
      if (programmaticActivityFeedScrollRef.current) {
        return;
      }
      const scrollTop = container.scrollTop;
      if (Date.now() < forceActivityFeedScrollUntilRef.current) {
        activityFeedScrollTopRef.current = scrollTop;
        return;
      }
      const distanceFromBottom = distanceFromActivityFeedBottom(container);
      if (scrollTop < activityFeedScrollTopRef.current - ACTIVITY_FEED_USER_SCROLL_DELTA_PX) {
        userDetachedFromBottomRef.current = true;
        activityFeedUserScrollDirectionRef.current = "up";
      } else if (scrollTop > activityFeedScrollTopRef.current + ACTIVITY_FEED_USER_SCROLL_DELTA_PX) {
        activityFeedUserScrollDirectionRef.current = "down";
        if (distanceFromBottom <= ACTIVITY_FEED_STICK_THRESHOLD_PX) {
          userDetachedFromBottomRef.current = false;
        }
      } else if (distanceFromBottom <= ACTIVITY_FEED_STICK_THRESHOLD_PX) {
        userDetachedFromBottomRef.current = false;
        activityFeedUserScrollDirectionRef.current = null;
      }
      activityFeedScrollTopRef.current = scrollTop;
      if (scrollTop <= ACTIVITY_FEED_SCROLL_JUMP_THRESHOLD_PX) {
        activityFeedUserScrollDirectionRef.current = null;
      }
      syncActivityFeedScrollJump(container);
      syncActivityUserMessageNavigator(container);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    syncActivityFeedScrollJump(container);
    syncActivityUserMessageNavigator(container);
    return () => container.removeEventListener("scroll", onScroll);
  }, [
    activeThread?.id,
    distanceFromActivityFeedBottom,
    syncActivityFeedScrollJump,
    syncActivityUserMessageNavigator,
  ]);

  useEffect(() => {
    const container = activityMessagesRef.current;
    if (!container || !activeThread?.id) {
      return;
    }
    const content = container.querySelector(".run-log");
    if (!(content instanceof HTMLElement)) {
      return;
    }
    let lastContentHeight = content.getBoundingClientRect().height;
    const observer = new ResizeObserver(() => {
      const nextContentHeight = content.getBoundingClientRect().height;
      const shrank = nextContentHeight < lastContentHeight - 1;
      lastContentHeight = nextContentHeight;
      const distanceFromBottom = distanceFromActivityFeedBottom(container);
      clampActivityFeedOverscroll(container);
      const stuckAboveBottom =
        !userDetachedFromBottomRef.current && distanceFromBottom > ACTIVITY_FEED_STICK_THRESHOLD_PX;
      if (userDetachedFromBottomRef.current) {
        syncActivityUserMessageNavigator(container);
        return;
      }
      if (stuckAboveBottom || shrank) {
        scrollActivityFeedToEnd();
        requestAnimationFrame(() => scrollActivityFeedToEnd());
        requestAnimationFrame(() => syncActivityUserMessageNavigator(container));
        return;
      }
      scheduleActivityFeedLayoutScroll();
      syncActivityUserMessageNavigator(container);
    });
    observer.observe(content);
    syncActivityUserMessageNavigator(container);
    return () => observer.disconnect();
  }, [
    activeThread?.id,
    clampActivityFeedOverscroll,
    distanceFromActivityFeedBottom,
    scheduleActivityFeedLayoutScroll,
    scrollActivityFeedToEnd,
    syncActivityUserMessageNavigator,
  ]);

  useLayoutEffect(() => {
    activityFeedUserScrollDirectionRef.current = null;
    activityFeedScrollJumpRef.current = null;
    activeActivityUserMessageNavIdRef.current = undefined;
    setActiveActivityUserMessageNavId(undefined);
    setActivityFeedScrollJump(null);
  }, [activeThread?.id]);

  useLayoutEffect(() => {
    const container = activityMessagesRef.current;
    if (container) {
      const distanceFromBottom = distanceFromActivityFeedBottom(container);
      if (distanceFromBottom <= ACTIVITY_FEED_STICK_THRESHOLD_PX) {
        activityFeedUserScrollDirectionRef.current = null;
      } else if (container.scrollTop <= ACTIVITY_FEED_SCROLL_JUMP_THRESHOLD_PX) {
        activityFeedUserScrollDirectionRef.current = null;
      }
      syncActivityFeedScrollJump(container);
      syncActivityUserMessageNavigator(container);
    }
  }, [
    distanceFromActivityFeedBottom,
    runProjectionLayoutSignature,
    syncActivityFeedScrollJump,
    syncActivityUserMessageNavigator,
  ]);

  useLayoutEffect(() => {
    requestActivityFeedForceScroll();
  }, [activeThread?.id, requestActivityFeedForceScroll]);

  useLayoutEffect(() => {
    if (!runProjectionLayoutSignature || !activeThread) {
      return;
    }
    const container = activityMessagesRef.current;
    if (container) {
      clampActivityFeedOverscroll(container);
    }
    const forceScroll = Date.now() < forceActivityFeedScrollUntilRef.current;
    if (forceScroll) {
      scrollActivityFeedToEnd(true);
      const frame = requestAnimationFrame(() => scrollActivityFeedToEnd(true));
      return () => cancelAnimationFrame(frame);
    }
    if (userDetachedFromBottomRef.current) {
      return;
    }
    if (activeThread.status === "running") {
      scheduleActivityFeedLayoutScroll();
      return;
    }
    flushActivityFeedLayoutScroll();
    const frame = requestAnimationFrame(() => scrollActivityFeedToEnd(true));
    return () => cancelAnimationFrame(frame);
  }, [
    activeThread?.id,
    activeThread?.status,
    clampActivityFeedOverscroll,
    flushActivityFeedLayoutScroll,
    runProjectionLayoutSignature,
    scheduleActivityFeedLayoutScroll,
    scrollActivityFeedToEnd,
  ]);

  useLayoutEffect(() => {
    if (!showPlanApproval || !activeThread) {
      return;
    }
    scrollActivityFeedToEnd(true);
    const frame = requestAnimationFrame(() => scrollActivityFeedToEnd(true));
    return () => cancelAnimationFrame(frame);
  }, [activeThread?.id, scrollActivityFeedToEnd, showPlanApproval]);

  async function openWorkspace() {
    setError(undefined);
    if (!window.eco) {
      setError("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
      return;
    }

    setIsOpening(true);
    try {
      const result = await window.eco.openWorkspace();
      if (!result.canceled && result.workspace) {
        activateWorkspace(result.workspace);
        await refreshGitStatus(result.workspace.path);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsOpening(false);
    }
  }

  async function openProjectFromPath(path: string) {
    if (!window.eco) {
      throw new Error("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
    }
    const workspace = await window.eco.openWorkspacePath(path);
    activateWorkspace(workspace);
  }

  async function handleOpenProjectFromDrop(path: string) {
    setError(undefined);
    setIsOpening(true);
    try {
      await openProjectFromPath(path);
      await refreshGitStatus(path);
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setIsOpening(false);
    }
  }

  async function refreshThreadState(threadId: string) {
    if (!window.eco) {
      return;
    }
    const [
      projection,
      subagentSessions,
      subagentMetrics,
      plan,
      clarification,
      bashApproval,
      followUps,
      todos,
      usageSnapshot,
    ] = await Promise.all([
      typeof window.eco.getThreadRunProjection === "function"
        ? window.eco.getThreadRunProjection(threadId)
        : Promise.resolve(undefined),
      typeof window.eco.listSubagentSessions === "function"
        ? window.eco.listSubagentSessions(threadId)
        : Promise.resolve(undefined),
      typeof window.eco.listSubagentMetrics === "function"
        ? window.eco.listSubagentMetrics(threadId)
        : Promise.resolve(undefined),
      window.eco.getPendingPlan(threadId),
      window.eco.getPendingClarification(threadId),
      typeof window.eco.getPendingBashApproval === "function"
        ? window.eco.getPendingBashApproval(threadId)
        : Promise.resolve(undefined),
      typeof window.eco.listThreadFollowUps === "function"
        ? window.eco.listThreadFollowUps(threadId)
        : Promise.resolve({ followUps: [] }),
      window.eco.listThreadTodos(threadId),
      window.eco.getThreadUsageSnapshot(threadId),
    ]);

    if (projection) {
      setRunProjectionByThread((current) => ({ ...current, [threadId]: projection }));
    } else {
      setRunProjectionByThread((current) => removeRecordKey(current, threadId));
    }
    if (subagentSessions) {
      setSubagentTimingsByThread((current) => ({ ...current, [threadId]: subagentSessions }));
    }
    if (subagentMetrics) {
      setSubagentMetricsByThread((current) => ({ ...current, [threadId]: subagentMetrics }));
    }
    if (plan) {
      upsertPendingPlanForThread(threadId, plan);
    } else {
      clearPendingPlanForThread(threadId);
    }
    if (clarification) {
      upsertPendingClarificationForThread(threadId, clarification);
    } else {
      clearPendingClarificationForThread(threadId);
    }
    if (bashApproval) {
      upsertPendingBashApprovalForThread(threadId, bashApproval);
    } else {
      clearPendingBashApprovalForThread(threadId);
    }
    setFollowUpsByThread((current) => ({ ...current, [threadId]: sortThreadFollowUps(followUps.followUps) }));
    setTodosByThread((current) => ({ ...current, [threadId]: todos }));
    if (usageSnapshot.billing) {
      setBillingByThread((current) => ({ ...current, [threadId]: usageSnapshot.billing! }));
    } else {
      setBillingByThread((current) => removeRecordKey(current, threadId));
    }
    if (usageSnapshot.context) {
      setContextByThread((current) => ({ ...current, [threadId]: usageSnapshot.context! }));
    } else {
      setContextByThread((current) => removeRecordKey(current, threadId));
    }
  }

  const restorePrompt = useCallback(
    (text: string, rewindTarget?: ThreadActivityRewindTarget) => {
      setPrompt(text);
      if (activeThread && rewindTarget) {
        setComposerRewindTarget({ ...rewindTarget, threadId: activeThread.id });
      } else {
        setComposerRewindTarget(undefined);
      }
      window.requestAnimationFrame(() => {
        composerRef.current?.focus();
        composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    },
    [activeThread?.id],
  );

  function startEditingFollowUp(followUp: ThreadPendingFollowUp) {
    setEditingFollowUpId(followUp.id);
    setPrompt(followUp.prompt);
    setComposerAttachments(fromPromptImageAttachments(followUp.attachments ?? []));
    setComposerImageNotice(undefined);
    setComposerRewindTarget(undefined);
    setError(undefined);
    composerRef.current?.focus();
  }

  function cancelEditingFollowUp() {
    setEditingFollowUpId(undefined);
    setPrompt("");
    setComposerAttachments([]);
    setComposerImageNotice(undefined);
  }

  async function sendComposerMessage() {
    if (!currentProjectPath || !window.eco || (!prompt.trim() && composerAttachments.length === 0)) {
      return;
    }
    if (isStarting || followUpBusy) {
      return;
    }
    if (contextCompactionInFlight) {
      setError("上下文正在压缩中，请稍候。");
      return;
    }
    setError(undefined);
    requestActivityFeedForceScroll();
    const attachments =
      composerAttachments.length > 0 ? toPromptImageAttachments(composerAttachments) : undefined;
    const messagePrompt = prompt.trim() || (attachments?.length ? "请查看并分析我附上的图片。" : "");

    if (composerFollowUpMode && activeThread) {
      if (editingFollowUpId) {
        if (typeof window.eco.updateThreadFollowUp !== "function") {
          setError("当前桌面预加载 API 不包含编辑后续消息入口，请重启应用后再试。");
          return;
        }
        setFollowUpBusy(true);
        try {
          const result = await window.eco.updateThreadFollowUp({
            threadId: activeThread.id,
            followUpId: editingFollowUpId,
            prompt: messagePrompt,
            ...(attachments && { attachments }),
          });
          setFollowUpsByThread((current) => ({
            ...current,
            [activeThread.id]: sortThreadFollowUps(result.followUps),
          }));
          cancelEditingFollowUp();
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setFollowUpBusy(false);
        }
        return;
      }

      if (typeof window.eco.enqueueThreadFollowUp !== "function") {
        setError("当前桌面预加载 API 不包含运行中后续消息入口，请重启应用后再试。");
        return;
      }
      setFollowUpBusy(true);
      try {
        const result = await window.eco.enqueueThreadFollowUp({
          threadId: activeThread.id,
          prompt: messagePrompt,
          ...(attachments && { attachments }),
        });
        setFollowUpsByThread((current) => ({
          ...current,
          [activeThread.id]: sortThreadFollowUps(result.followUps),
        }));
        clearComposerDraft(composerDraftsByKeyRef.current, composerContextKey);
        setPrompt("");
        setComposerRewindTarget(undefined);
        setComposerAttachments([]);
        setComposerImageNotice(undefined);
        requestActivityFeedForceScroll();
        // 用户已发送消息，接受当前的 prompt cache 配置漂移
        if (composerRuntimeConfig) {
          promptCacheBaselineByThreadRef.current[activeThread.id] = composerRuntimeConfig;
          setPromptCacheBaselineVersion((v) => v + 1);
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setFollowUpBusy(false);
      }
      return;
    }

    setIsStarting(true);
    if (!composerRuntimeConfig) {
      setError("请先配置子代理编排方案。");
      setIsStarting(false);
      return;
    }
    try {
      if (activeThread && isContinuableThreadStatus(activeThread.status)) {
        const rewindTarget = activeComposerRewindTarget
          ? {
              activityLineId: activeComposerRewindTarget.activityLineId,
              userMessageId: activeComposerRewindTarget.userMessageId,
            }
          : undefined;
        const result = await window.eco.continueThread({
          threadId: activeThread.id,
          prompt: messagePrompt,
          runtimeConfig: composerRuntimeConfig,
          ...(rewindTarget && { rewindTarget }),
          ...(attachments && { attachments }),
        });
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
        );
        clearPendingPlanForThread(result.thread.id);
        await refreshThreadState(result.thread.id);
        // 用户已发送消息，接受当前的 prompt cache 配置漂移
        if (composerRuntimeConfig) {
          promptCacheBaselineByThreadRef.current[activeThread.id] = composerRuntimeConfig;
          setPromptCacheBaselineVersion((v) => v + 1);
        }
      } else {
        const result = await window.eco.startThread({
          workspacePath: currentProjectPath,
          prompt: messagePrompt,
          runtimeConfig: composerRuntimeConfig,
          ...(attachments && { attachments }),
        });
        setThreads((current) => [
          result.thread,
          ...current.filter((thread) => thread.id !== result.thread.id),
        ]);
        setSelectedThreadId(result.thread.id);
        clearPendingPlanForThread(result.thread.id);
        setTodosByThread((current) => ({
          ...current,
          [result.thread.id]: [],
        }));
        // 用户已发送消息，接受当前的 prompt cache 配置漂移
        if (composerRuntimeConfig) {
          promptCacheBaselineByThreadRef.current[result.thread.id] = composerRuntimeConfig;
          setPromptCacheBaselineVersion((v) => v + 1);
        }
      }
      clearComposerDraft(composerDraftsByKeyRef.current, composerContextKey);
      setPrompt("");
      setComposerRewindTarget(undefined);
      setComposerAttachments([]);
      setComposerImageNotice(undefined);
      requestActivityFeedForceScroll();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsStarting(false);
    }
  }

  async function cancelQueuedFollowUp(followUp: ThreadPendingFollowUp) {
    if (!window.eco || typeof window.eco.cancelThreadFollowUp !== "function") {
      setError("当前桌面预加载 API 不包含取消后续消息入口，请重启应用后再试。");
      return;
    }
    setError(undefined);
    setFollowUpCancelBusyId(followUp.id);
    try {
      const result = await window.eco.cancelThreadFollowUp({
        threadId: followUp.threadId,
        followUpId: followUp.id,
      });
      setFollowUpsByThread((current) => ({
        ...current,
        [followUp.threadId]: sortThreadFollowUps(result.followUps),
      }));
      if (editingFollowUpId === followUp.id) {
        cancelEditingFollowUp();
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setFollowUpCancelBusyId(undefined);
    }
  }

  async function escalateQueuedFollowUp(followUp: ThreadPendingFollowUp) {
    if (!window.eco || typeof window.eco.escalateThreadFollowUp !== "function") {
      setError("当前桌面预加载 API 不包含立即处理后续消息入口，请重启应用后再试。");
      return;
    }
    setError(undefined);
    setFollowUpEscalateBusyId(followUp.id);
    try {
      const result = await window.eco.escalateThreadFollowUp({
        threadId: followUp.threadId,
        followUpId: followUp.id,
      });
      setFollowUpsByThread((current) => ({
        ...current,
        [followUp.threadId]: sortThreadFollowUps(result.followUps),
      }));
      if (editingFollowUpId === followUp.id) {
        cancelEditingFollowUp();
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setFollowUpEscalateBusyId(undefined);
    }
  }

  async function approvePendingPlan() {
    if (!activeThread || !window.eco) return;
    setError(undefined);
    setPlanActionBusy(true);
    try {
      const result = await window.eco.approvePlan({
        threadId: activeThread.id,
      });
      if (result.thread) {
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread!.id ? result.thread! : thread)),
        );
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPlanActionBusy(false);
    }
  }

  async function submitClarificationAnswers(answers: { toolUseId: string; selections: string[][] }) {
    if (!window.eco) return;
    setClarificationBusy(true);
    setError(undefined);
    try {
      await window.eco.submitClarification(answers);
      if (activeThread) {
        clearPendingClarificationForThread(activeThread.id);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setClarificationBusy(false);
    }
  }

  async function dismissPendingClarification() {
    if (!pendingClarification || !window.eco) return;
    setClarificationBusy(true);
    setError(undefined);
    try {
      await window.eco.dismissClarification(pendingClarification.toolUseId);
      clearPendingClarificationForThread(pendingClarification.threadId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setClarificationBusy(false);
    }
  }

  async function resolvePendingBashApproval(resolution: BashApprovalResolutionInput) {
    if (!pendingBashApproval || !window.eco) return;
    setBashApprovalBusy(true);
    setError(undefined);
    try {
      await window.eco.resolveBashApproval({
        toolUseId: pendingBashApproval.toolUseId,
        decision: resolution.decision,
        ...(resolution.feedback ? { feedback: resolution.feedback } : {}),
      });
      clearPendingBashApprovalForThread(pendingBashApproval.threadId);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBashApprovalBusy(false);
    }
  }

  async function dismissPendingPlan() {
    if (!activeThread || !window.eco) return;
    setError(undefined);
    setPlanActionBusy(true);
    try {
      const result = await window.eco.dismissPlan(activeThread.id);
      if (result.thread) {
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread!.id ? result.thread! : thread)),
        );
      }
      clearPendingPlanForThread(activeThread.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPlanActionBusy(false);
    }
  }

  async function performCancel() {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    setCancelBusy(true);
    try {
      await window.eco.cancelThread({ threadId: activeThread.id });
      setStopConfirm(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCancelBusy(false);
    }
  }

  async function requestStopThread() {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    try {
      const status = await window.eco.getWorktreeStatus(activeThread.id);
      if (status.exists && status.changedFiles.length > 0) {
        setStopConfirm({ changedFiles: status.changedFiles });
        return;
      }
      await performCancel();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function refreshSkillsList(workspacePath?: string) {
    if (!window.eco) return;
    setIsLoadingSkills(true);
    try {
      const snapshot = await window.eco.listSkills(workspacePath);
      setSkillsSnapshot(snapshot);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsLoadingSkills(false);
    }
  }

  async function linkProjectAgentsSkills() {
    if (!window.eco || !currentProjectPath) {
      return;
    }
    setSkillsLinking(true);
    setError(undefined);
    try {
      const result = await window.eco.linkAgentsSkills({ workspacePath: currentProjectPath });
      setSkillsLinkResult(result);
      await refreshSkillsList(currentProjectPath);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSkillsLinking(false);
    }
  }

  async function linkUserAgentsSkills() {
    const userAgents = skillsSnapshot?.agentsOnlySkills.filter((skill) => skill.source === "user") ?? [];
    const baseDir = userAgents[0]?.baseDir;
    if (!window.eco || !baseDir) {
      return;
    }
    setSkillsLinking(true);
    setError(undefined);
    try {
      const result = await window.eco.linkAgentsSkills({
        workspacePath: currentProjectPath ?? baseDir,
        baseDir,
      });
      setSkillsLinkResult(result);
      await refreshSkillsList(currentProjectPath);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSkillsLinking(false);
    }
  }

  function openModelsSettings(tab: ModelsSettingsTab = "subagents") {
    setModelsSettingsTab(tab);
    setSettingsSection("models");
    setSettingsOpen(true);
  }

  function openProviderSettings() {
    setSettingsSection("providers");
    setSettingsOpen(true);
  }

  function openGitSettings() {
    setSettingsSection("git");
    setSettingsOpen(true);
  }

  async function saveGitSettingsSnapshot(snapshot: GitSettingsSnapshot) {
    if (!window.eco) {
      return;
    }
    const saved = await window.eco.saveGitSettings(snapshot);
    setGitSettings(saved);
  }

  async function saveCommitMessageModelPreference(candidateModelId: string) {
    if (!window.eco || !selectedRuntimeProfileId) {
      return;
    }
    const next = {
      ...gitSettings,
      commitMessageCandidateModelIdByProfileId: {
        ...gitSettings.commitMessageCandidateModelIdByProfileId,
        [selectedRuntimeProfileId]: candidateModelId,
      },
    };
    const saved = await window.eco.saveGitSettings(next);
    setGitSettings(saved);
  }

  async function handleGitCheckoutBranch(branch: string) {
    if (!currentProjectPath || !window.eco) {
      return;
    }
    setGitStatusBusy(true);
    try {
      const status = await window.eco.checkoutGitBranch({
        workspacePath: currentProjectPath,
        branch,
      });
      setGitStatus(status);
      const workspace = await window.eco.inspectWorkspace(currentProjectPath);
      setProjectWorkspace(workspace);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setGitStatusBusy(false);
    }
  }

  async function handleGitCreateBranch(branch: string) {
    if (!currentProjectPath || !window.eco) {
      return;
    }
    setGitStatusBusy(true);
    try {
      const status = await window.eco.createGitBranch({
        workspacePath: currentProjectPath,
        branch,
      });
      setGitStatus(status);
      const workspace = await window.eco.inspectWorkspace(currentProjectPath);
      setProjectWorkspace(workspace);
    } finally {
      setGitStatusBusy(false);
    }
  }

  async function handleGitCommitSuccess() {
    if (!currentProjectPath || !window.eco) {
      return;
    }
    await refreshGitStatus();
    const workspace = await window.eco.inspectWorkspace(currentProjectPath);
    setProjectWorkspace(workspace);
  }

  const handleChangesDiffLoaded = useCallback(
    async (diff: WorkspaceDiffResult) => {
      setReviewDiff(diff);
      setReviewDiffError(undefined);
      setReviewSelectedPath((current) =>
        current && diff.files.some((file) => file.path === current) ? current : diff.files[0]?.path,
      );
      setGitStatus((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          insertions: diff.totalAdditions,
          deletions: diff.totalDeletions,
          dirtyFileCount: diff.fileCount,
          canCommit: diff.fileCount > 0,
        };
      });
      if (!currentProjectPath || !window.eco) {
        return;
      }
      const workspace = await window.eco.inspectWorkspace(currentProjectPath);
      setProjectWorkspace(workspace);
    },
    [currentProjectPath],
  );

  const handleChangesDiffLoadingChange = useCallback((loading: boolean) => {
    setReviewDiffLoading(loading);
  }, []);

  const handleChangesDiffError = useCallback((message?: string) => {
    setReviewDiffError(message);
    if (message) {
      setReviewDiff(undefined);
      setReviewSelectedPath(undefined);
    }
  }, []);

  async function handleGitPullSuccess() {
    await handleGitCommitSuccess();
  }

  async function handleGitPullConflictsWithAgent(conflictFiles: string[]) {
    if (!currentProjectPath || !window.eco || conflictFiles.length === 0) {
      return;
    }
    if (!composerRuntimeConfig) {
      setError("请先配置子代理编排方案。");
      return;
    }
    const fileList = conflictFiles.map((file) => `- ${file}`).join("\n");
    const prompt = `Git pull 产生了合并冲突，请解决以下文件的冲突并完成合并：\n${fileList}\n\n请查看冲突标记（<<<<<<< / ======= / >>>>>>>），保留正确代码，然后 git add 相关文件并完成合并提交。`;
    setError(undefined);

    if (activeThread) {
      if (activeThread.status === "running" || activeThread.status === "queued") {
        if (typeof window.eco.enqueueThreadFollowUp !== "function") {
          setError("当前桌面预加载 API 不包含运行中后续消息入口，请重启应用后再试。");
          return;
        }
        setFollowUpBusy(true);
        try {
          const result = await window.eco.enqueueThreadFollowUp({
            threadId: activeThread.id,
            prompt,
          });
          setFollowUpsByThread((current) => ({
            ...current,
            [activeThread.id]: sortThreadFollowUps(result.followUps),
          }));
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setFollowUpBusy(false);
        }
        return;
      }
      if (isContinuableThreadStatus(activeThread.status)) {
        setIsStarting(true);
        try {
          const result = await window.eco.continueThread({
            threadId: activeThread.id,
            prompt,
            runtimeConfig: composerRuntimeConfig,
          });
          setThreads((current) =>
            current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
          );
          await refreshThreadState(result.thread.id);
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setIsStarting(false);
        }
        return;
      }
    }

    setIsStarting(true);
    try {
      const result = await window.eco.startThread({
        workspacePath: currentProjectPath,
        prompt,
        runtimeConfig: composerRuntimeConfig,
      });
      setThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.thread.id)]);
      setSelectedThreadId(result.thread.id);
      clearPendingPlanForThread(result.thread.id);
      await refreshThreadState(result.thread.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsStarting(false);
    }
  }

  async function persistComposerRuntimeConfig(
    next: ThreadRuntimeConfig,
    options?: { persistWhileRunning?: boolean },
  ): Promise<void> {
    setComposerRuntimeConfig(next);
    if (!activeThread || !window.eco) {
      return;
    }
    const isRunning = activeThread.status === "running" || activeThread.status === "queued";
    const canPersist = canEditComposerConfig || (options?.persistWhileRunning === true && isRunning);
    if (!canPersist) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const result = await window.eco.updateThreadRuntimeConfig({
        threadId: activeThread.id,
        runtimeConfig: next,
      });
      setThreads((current) =>
        current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function selectComposerRouteProfile(profileId: string) {
    if (!composerRuntimeConfig) {
      return;
    }
    const profile = findOrchestrationProfileBySelectionId(settings, profileId);
    const agentProfileId = profile?.id ?? profileId;
    const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(mcpSettings.servers);
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      routeProfileId: agentProfileId,
      agentProfileId,
      ...(profile
        ? {
            subagentEnabled: deriveSubagentEnabledFromProfile(profile, composerRuntimeConfig.subagentEnabled),
          }
        : {}),
      ...(availableMcpServerKeys.length > 0
        ? {
            mcpServersEnabled: deriveMcpServersEnabled(availableMcpServerKeys, {
              profileAssignedServers: profile
                ? collectProfileAssignedMcpServers(profile, settings.agentTemplates)
                : [],
              existing: composerRuntimeConfig.mcpServersEnabled,
              remembered: workflowSettings.mcpServersEnabled,
            }),
          }
        : {}),
    };
    await persistComposerRuntimeConfig(next);
    setComposerRoutePopoverOpen(false);
  }

  async function saveComposerSelectionAsProfile() {
    if (!window.eco?.saveOrchestrationProfile || !window.eco?.getModelSettings) {
      setError("智能体配置保存接口不可用。");
      return;
    }
    if (!composerRuntimeConfig || !selectedRuntimeProfile) {
      return;
    }
    const defaultName = `${selectedRuntimeProfile.name} Copy`;
    const name = window.prompt("保存为智能体配置", defaultName);
    if (!name?.trim()) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const profile = buildComposerSavedProfile({
        profile: selectedRuntimeProfile,
        runtimeConfig: composerRuntimeConfig,
        name,
        existingIds: settings.orchestrationProfiles.map((entry) => entry.id),
      });
      const saved = await window.eco.saveOrchestrationProfile(profile);
      const nextSettings = await window.eco.getModelSettings();
      setSettings(nextSettings);
      const nextRuntimeConfig: ThreadRuntimeConfig = {
        ...composerRuntimeConfig,
        agentProfileId: saved.id,
        routeProfileId: saved.id,
      };
      await persistComposerRuntimeConfig(nextRuntimeConfig);
      setComposerRoutePopoverOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function toggleComposerSubagent(role: SubagentRole, enabled: boolean) {
    if (!composerRuntimeConfig) {
      return;
    }
    if (role === "explore") {
      return;
    }
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      subagentEnabled: { ...composerRuntimeConfig.subagentEnabled, [role]: enabled },
    };
    await persistComposerRuntimeConfig(next);
  }

  async function toggleComposerMcpServer(serverKey: string, enabled: boolean) {
    if (!composerRuntimeConfig) {
      return;
    }
    const nextMcpServersEnabled = { ...composerMcpSettings, [serverKey]: enabled };
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      mcpServersEnabled: nextMcpServersEnabled,
    };
    await persistComposerRuntimeConfig(next, { persistWhileRunning: true });
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    try {
      const saved = await window.eco.saveWorkflowSettings({
        ...workflowSettings,
        mcpServersEnabled: nextMcpServersEnabled,
      });
      setWorkflowSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function selectComposerSessionMode(sessionMode: SessionMode) {
    if (!composerRuntimeConfig || !canEditComposerConfig) {
      return;
    }
    const next: ThreadRuntimeConfig = withSessionMode(composerRuntimeConfig, sessionMode);
    await persistComposerRuntimeConfig(next);
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    try {
      const saved = await window.eco.saveWorkflowSettings({
        ...workflowSettings,
        sessionMode: next.sessionMode,
      });
      setWorkflowSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function toggleComposerBashReviewMode(bashReviewMode: ThreadRuntimeConfig["bashReviewMode"]) {
    if (!composerRuntimeConfig || !canEditBashReviewMode) {
      return;
    }
    const next: ThreadRuntimeConfig = { ...composerRuntimeConfig, bashReviewMode };
    await persistComposerRuntimeConfig(next, { persistWhileRunning: true });
  }

  async function saveProxyBridgeSettings(next: ProxyBridgeSettingsSnapshot) {
    if (!window.eco) return;
    setIsSavingProxyBridgeSettings(true);
    setError(undefined);
    try {
      const saved = await window.eco.saveProxyBridgeSettings(next);
      setProxyBridgeSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingProxyBridgeSettings(false);
    }
  }

  async function saveMcpServer(input: McpServerConfigInput) {
    if (!window.eco) return;
    setIsSavingSettings(true);
    try {
      await window.eco.saveMcpServer(input);
      const snapshot = await window.eco.getMcpSettings();
      setMcpSettings(snapshot);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function deleteMcpServer(serverId: string) {
    if (!window.eco) return;
    setIsSavingSettings(true);
    try {
      await window.eco.deleteMcpServer(serverId);
      const snapshot = await window.eco.getMcpSettings();
      setMcpSettings(snapshot);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function checkMcpServer(input: McpServerConfigInput): Promise<McpServerCheckResult> {
    if (!window.eco) {
      throw new Error("Eco desktop API is not available.");
    }
    return window.eco.checkMcpServer(input);
  }

  async function saveCenterServerSettings(input: CenterServerSettingsInput) {
    if (!window.eco) {
      return emptyCenterServerSettings;
    }
    setIsSavingSettings(true);
    try {
      const snapshot = await window.eco.saveCenterServerSettings(input);
      setCenterServerSettings(snapshot);
      return snapshot;
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function applyCenterServerAuthResult(result: {
    settings: CenterServerSettingsSnapshot["settings"];
    status: CenterServerSettingsSnapshot["status"];
  }) {
    setCenterServerSettings({
      settings: result.settings,
      status: result.status,
    });
    return {
      settings: result.settings,
      status: result.status,
    };
  }

  async function signUpCenterServer(request: CenterServerSignUpRequest) {
    if (!window.eco) {
      return emptyCenterServerSettings;
    }
    setIsSavingSettings(true);
    try {
      const result = await window.eco.signUpCenterServer(request);
      return applyCenterServerAuthResult(result);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function signInCenterServer(request: CenterServerSignInRequest) {
    if (!window.eco) {
      return emptyCenterServerSettings;
    }
    setIsSavingSettings(true);
    try {
      const result = await window.eco.signInCenterServer(request);
      return applyCenterServerAuthResult(result);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function testCenterServerConnection(serverUrl: string) {
    if (!window.eco) {
      return { ok: false, error: "Electron preload API is unavailable." };
    }
    return window.eco.testCenterServerConnection({ serverUrl });
  }

  async function createCenterServerPairing() {
    if (!window.eco) {
      throw new Error("Electron preload API is unavailable.");
    }
    return window.eco.createCenterServerPairing();
  }

  async function listCenterServerBindings() {
    if (!window.eco) {
      return [];
    }
    return window.eco.listCenterServerBindings();
  }

  async function listCenterServerPresence() {
    if (!window.eco) {
      return [];
    }
    return window.eco.listCenterServerPresence();
  }

  async function revokeCenterServerBinding(bindingId: string) {
    if (!window.eco) {
      throw new Error("Electron preload API is unavailable.");
    }
    return window.eco.revokeCenterServerBinding(bindingId);
  }

  async function connectCenterServer() {
    if (!window.eco) {
      return emptyCenterServerSettings;
    }
    const snapshot = await window.eco.connectCenterServer();
    setCenterServerSettings(snapshot);
    return snapshot;
  }

  async function disconnectCenterServer() {
    if (!window.eco) {
      return emptyCenterServerSettings;
    }
    const snapshot = await window.eco.disconnectCenterServer();
    setCenterServerSettings(snapshot);
    return snapshot;
  }

  async function removeCenterServerConnection(options?: { forceLocal?: boolean }) {
    if (!window.eco) {
      return emptyCenterServerSettings;
    }
    const snapshot = await window.eco.removeCenterServerConnection(options);
    setCenterServerSettings(snapshot);
    return snapshot;
  }

  function activateWorkspace(nextWorkspace: WorkspaceInfo) {
    setWorkspace(nextWorkspace);
    setSelectedProjectPath(nextWorkspace.path);
    registerImportedProject(
      nextWorkspace.path,
      homeProjectPath && isHomeProjectPath(nextWorkspace.path, homeProjectPath)
        ? HOME_PROJECT_DISPLAY_NAME
        : nextWorkspace.name,
    );
    setCollapsedProjectPaths((current) => {
      if (!current.has(nextWorkspace.path)) {
        return current;
      }
      const next = new Set(current);
      next.delete(nextWorkspace.path);
      window.localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setSelectedThreadId(undefined);
    resetComposerDefaultConfig();
    setTodosByThread({});
    setFollowUpsByThread({});
  }

  function registerImportedProject(path: string, name: string, resolvedHomeProjectPath?: string) {
    const homePath = resolvedHomeProjectPath ?? homeProjectPath;
    const isHome = homePath ? isHomeProjectPath(path, homePath) : false;
    const displayName = isHome ? HOME_PROJECT_DISPLAY_NAME : name;

    setHiddenProjectPaths((current) => {
      if (!current.has(path)) {
        return current;
      }
      const next = new Set(current);
      next.delete(path);
      window.localStorage.setItem(hiddenProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    if (!isHome) {
      setRecentProjects((current) => {
        const withoutHome = homePath
          ? current.filter((item) => !isHomeProjectPath(item.path, homePath))
          : current;
        const existing = withoutHome.find((item) => item.path === path);
        const next = existing
          ? withoutHome.map((item) => (item.path === path ? { ...item, name: displayName } : item))
          : [{ path, name: displayName, importedAt: new Date().toISOString() }, ...withoutHome].slice(0, 12);
        window.localStorage.setItem(recentProjectsStorageKey, JSON.stringify(next));
        return next;
      });
    }
    setProjectOrder((current) => {
      const next = prependProjectOrder(current, path);
      window.localStorage.setItem(projectOrderStorageKey, JSON.stringify(next));
      projectOrderInitializedRef.current = true;
      return next;
    });
  }

  function pinProject(projectPath: string) {
    setPinnedProjectPaths((current) => {
      if (current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.add(projectPath);
      window.localStorage.setItem(pinnedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setProjectOrder((current) => {
      const next = prependProjectOrder(current, projectPath);
      window.localStorage.setItem(projectOrderStorageKey, JSON.stringify(next));
      projectOrderInitializedRef.current = true;
      return next;
    });
  }

  function unpinProject(projectPath: string) {
    setPinnedProjectPaths((current) => {
      if (!current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectPath);
      window.localStorage.setItem(pinnedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function pinThread(threadId: string) {
    setPinnedThreadIds((current) => {
      if (current.has(threadId)) {
        return current;
      }
      const next = new Set(current);
      next.add(threadId);
      window.localStorage.setItem(pinnedThreadsStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function unpinThread(threadId: string) {
    setPinnedThreadIds((current) => {
      if (!current.has(threadId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(threadId);
      window.localStorage.setItem(pinnedThreadsStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function removeProject(projectPath: string) {
    if (homeProjectPath && isHomeProjectPath(projectPath, homeProjectPath)) {
      return;
    }
    setHiddenProjectPaths((current) => {
      const next = new Set(current);
      next.add(projectPath);
      window.localStorage.setItem(hiddenProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setRecentProjects((current) => {
      const next = current.filter((project) => project.path !== projectPath);
      window.localStorage.setItem(recentProjectsStorageKey, JSON.stringify(next));
      return next;
    });
    setProjectOrder((current) => {
      const next = current.filter((path) => path !== projectPath);
      window.localStorage.setItem(projectOrderStorageKey, JSON.stringify(next));
      return next;
    });
    setPinnedProjectPaths((current) => {
      if (!current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectPath);
      window.localStorage.setItem(pinnedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setCollapsedProjectPaths((current) => {
      if (!current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectPath);
      window.localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setExpandedProjectThreadPaths((current) => {
      if (!current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectPath);
      return next;
    });
    setSelectedProjectPath((current) => (current === projectPath ? undefined : current));
    setSelectedThreadId((current) => {
      const thread = current ? threads.find((item) => item.id === current) : undefined;
      return thread?.workspacePath === projectPath ? undefined : current;
    });
    resetComposerDefaultConfig();
  }

  function reorderProjects(draggedPath: string, targetPath: string, position: ProjectReorderPosition) {
    if (
      homeProjectPath &&
      (isHomeProjectPath(draggedPath, homeProjectPath) || isHomeProjectPath(targetPath, homeProjectPath))
    ) {
      return;
    }
    setProjectOrder((current) => {
      const next = reorderProjectPaths(current, draggedPath, targetPath, position);
      window.localStorage.setItem(projectOrderStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function switchProject(nextPath: string) {
    setSelectedProjectPath(nextPath);
    setSelectedThreadId(undefined);
    setComposerRewindTarget(undefined);
    resetComposerDefaultConfig();
  }

  function selectThread(thread: ThreadSummary) {
    setSelectedThreadId(thread.id);
    setSelectedProjectPath(thread.workspacePath);
    setComposerRewindTarget(undefined);
    setCollapsedProjectPaths((current) => {
      if (!current.has(thread.workspacePath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(thread.workspacePath);
      window.localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    const projectThreads = threads.filter((item) => item.workspacePath === thread.workspacePath);
    const threadIndex = projectThreads.findIndex((item) => item.id === thread.id);
    if (threadIndex >= sidebarThreadsCollapsed) {
      expandProjectThreads(thread.workspacePath);
    }
  }

  function clearThreadClientState(threadId: string) {
    clearComposerDraft(composerDraftsByKeyRef.current, `thread:${threadId}`);
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    setSelectedThreadId((current) => (current === threadId ? undefined : current));
    if (selectedThreadId === threadId) {
      resetComposerDefaultConfig();
      setComposerRewindTarget(undefined);
    }
    setRunProjectionByThread((current) => removeRecordKey(current, threadId));
    setSubagentTimingsByThread((current) => removeRecordKey(current, threadId));
    setSubagentMetricsByThread((current) => removeRecordKey(current, threadId));
    setUsageByThread((current) => removeRecordKey(current, threadId));
    setBillingByThread((current) => removeRecordKey(current, threadId));
    setContextByThread((current) => removeRecordKey(current, threadId));
    setModelByThread((current) => removeRecordKey(current, threadId));
    setTodosByThread((current) => removeRecordKey(current, threadId));
    setFollowUpsByThread((current) => removeRecordKey(current, threadId));
    clearPendingPlanForThread(threadId);
    clearPendingClarificationForThread(threadId);
    clearPendingBashApprovalForThread(threadId);
  }

  async function deleteThread(thread: ThreadSummary) {
    if (!window.eco) {
      return;
    }
    if (thread.status === "running" || thread.status === "queued") {
      setError("请先停止当前运行后再删除对话。");
      return;
    }
    if (deletingThreadId) {
      return;
    }
    setDeletingThreadId(thread.id);
    try {
      await window.eco.deleteThread(thread.id);
      clearThreadClientState(thread.id);
      setPinnedThreadIds((current) => {
        if (!current.has(thread.id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(thread.id);
        window.localStorage.setItem(pinnedThreadsStorageKey, JSON.stringify([...next]));
        return next;
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDeletingThreadId(undefined);
    }
  }

  function expandProjectThreads(projectPath: string) {
    setExpandedProjectThreadPaths((current) => {
      if (current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.add(projectPath);
      return next;
    });
  }

  function toggleProjectCollapsed(projectPath: string) {
    setCollapsedProjectPaths((current) => {
      const next = new Set(current);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      window.localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
  }

  function startNewChat() {
    setComposerRoutePopoverOpen(false);
    clearComposerDraft(
      composerDraftsByKeyRef.current,
      composerContextKeyFromParts(undefined, currentProjectPath),
    );
    setSelectedThreadId(undefined);
    resetComposerDefaultConfig();
    setEditingFollowUpId(undefined);
    setPrompt("");
    setComposerRewindTarget(undefined);
    setComposerAttachments([]);
    setComposerImageNotice(undefined);
    setError(undefined);
  }

  async function addComposerImageFiles(files: FileList | File[]) {
    if (!canPasteComposerImages) {
      setComposerImageNotice("当前主代理模型不支持图片输入。");
      return;
    }
    if (plannerCapability && !plannerCapability.capabilitiesResolved) {
      setComposerImageNotice("未匹配 models.dev，请自行确认主代理模型是否支持图片。");
    } else {
      setComposerImageNotice(undefined);
    }

    const additions: ComposerImageAttachment[] = [];
    for (const file of files) {
      if (composerAttachments.length + additions.length >= COMPOSER_MAX_IMAGES) {
        break;
      }
      const attachment = await readImageFileAsAttachment(file);
      if (attachment) {
        additions.push(attachment);
      }
    }
    if (additions.length === 0) {
      return;
    }
    setComposerAttachments((current) => [...current, ...additions].slice(0, COMPOSER_MAX_IMAGES));
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData?.items;
    if (!items?.length) {
      return;
    }
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void addComposerImageFiles(imageFiles);
  }

  function removeComposerAttachment(id: string) {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function insertComposerNewline() {
    const composer = composerRef.current;
    if (!composer) {
      return;
    }
    composer.insertNewline();
    composer.focus();
  }

  function syncComposerCursor() {
    const composer = composerRef.current;
    if (composer) {
      setComposerCursor(composer.getSelectionEnd());
    }
  }

  function selectComposerSkill(skill: SkillInfo) {
    const composer = composerRef.current;
    if (!composerSkillSlash || !composer || promptIncludesSkillName(prompt, skill.name)) {
      return;
    }
    const selectionEnd = composer.getSelectionEnd();
    const { next, cursor } = applySlashSkillSelection(
      prompt,
      { start: composerSkillSlash.start, end: selectionEnd },
      skill.name,
    );
    setPrompt(next);
    setComposerSkillActiveIndex(0);
    queueMicrotask(() => {
      composer.setCursor(cursor);
      composer.focus();
      composer.fitHeight();
      setComposerCursor(cursor);
    });
  }

  function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (composerSkillPopoverOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setComposerSkillActiveIndex((current) =>
          composerSkillMatches.length === 0 ? 0 : (current + 1) % composerSkillMatches.length,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setComposerSkillActiveIndex((current) =>
          composerSkillMatches.length === 0
            ? 0
            : (current - 1 + composerSkillMatches.length) % composerSkillMatches.length,
        );
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        const match = composerSkillMatches[composerSkillActiveIndex];
        if (match) {
          selectComposerSkill(match.skill);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
    }

    if (event.key !== "Enter") {
      return;
    }
    if (event.shiftKey || event.metaKey || event.altKey) {
      if (event.metaKey || event.altKey) {
        event.preventDefault();
        insertComposerNewline();
      }
      return;
    }
    event.preventDefault();
    if (canSend) void sendComposerMessage();
  }

  const showWorkspacePanel = Boolean(currentProjectPath);
  const workspaceCardsPanelDesiredOpen = Boolean(
    showWorkspacePanel && currentWorkspacePanelState?.open && !taskDrawerOpen,
  );
  const workspaceCardsPanelManuallyRevealed = Boolean(
    currentProjectPath && workspaceCardsManualRevealProjectPath === currentProjectPath,
  );
  const workspaceCardsPanelOpen = Boolean(
    workspaceCardsPanelDesiredOpen && (!workspaceCardsAutoHidden || workspaceCardsPanelManuallyRevealed),
  );
  const taskPanelOpen = Boolean(showWorkspacePanel && taskDrawerOpen);
  const taskPanelFullscreenOpen = Boolean(taskPanelOpen && taskPanelFullscreen);
  const rightPanelOpen = taskPanelOpen;
  const rightPanelStyle = {
    "--workspace-panel-width": taskPanelOpen ? `${taskPanelWidth}px` : "300px",
    "--task-panel-width": `${taskPanelWidth}px`,
  } as CSSProperties;
  const showLanding = !activeThread;
  const workspacePanelToolbar = showWorkspacePanel ? (
    <div className="codex-main-toolbar codex-main-toolbar--workspace" aria-label="工作区控制">
      <button
        type="button"
        className={
          workspaceCardsPanelOpen ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"
        }
        onClick={toggleWorkspacePanelForCurrentProject}
        title={workspaceCardsPanelOpen ? "收起工作区卡片" : "打开工作区卡片"}
        aria-label={workspaceCardsPanelOpen ? "收起工作区卡片" : "打开工作区卡片"}
        aria-expanded={workspaceCardsPanelOpen}
        aria-controls="workspace-panel"
      >
        <SlidersHorizontal size={15} aria-hidden />
      </button>
    </div>
  ) : null;
  const fixedSidebarToolbar = showWorkspacePanel ? (
    <div className="codex-fixed-sidebar-toolbar" aria-label="侧边栏控制">
      <button
        type="button"
        className={
          currentTerminalState?.open ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"
        }
        onClick={toggleTerminalForCurrentProject}
        title={currentTerminalState?.open ? "关闭终端 (Ctrl+`)" : "打开终端 (Ctrl+`)"}
        aria-label={currentTerminalState?.open ? "关闭终端" : "打开终端"}
        aria-expanded={currentTerminalState?.open === true}
        aria-controls="terminal-panel"
      >
        <PanelBottom size={15} aria-hidden />
      </button>
      <button
        type="button"
        className={taskPanelOpen ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"}
        onClick={toggleTaskPanelForCurrentProject}
        title={taskPanelOpen ? "收起任务侧栏" : "打开任务侧栏"}
        aria-label={taskPanelOpen ? "收起任务侧栏" : "打开任务侧栏"}
        aria-expanded={taskPanelOpen}
        aria-controls="task-panel"
      >
        <PanelRight size={15} aria-hidden />
      </button>
    </div>
  ) : null;
  const syncTopbarMode = useCallback(() => {
    const scrollBody = scrollBodyRef.current;
    const topbar = topbarRef.current;
    if (!scrollBody || !topbar) {
      return;
    }
    const overlap = measureTopbarFeedOverlap(scrollBody, topbar);
    setTopbarSolid(overlap);
  }, []);
  useEffect(() => {
    if (showLanding || !currentProjectPath) {
      return undefined;
    }
    const scrollBody = scrollBodyRef.current;
    const topbar = topbarRef.current;
    if (!scrollBody || !topbar) {
      return undefined;
    }
    const run = () => {
      requestAnimationFrame(() => {
        syncTopbarMode();
      });
    };
    run();
    const observer = new ResizeObserver(run);
    observer.observe(scrollBody);
    observer.observe(topbar);
    const feed = scrollBody.querySelector(".codex-feed-stack");
    if (feed) {
      observer.observe(feed);
    }
    const title = topbar.querySelector(".activity-header h2");
    if (title) {
      observer.observe(title);
    }
    return () => observer.disconnect();
  }, [
    showLanding,
    currentProjectPath,
    activeThread?.id,
    currentWorkspacePanelState?.open,
    taskDrawerOpen,
    syncTopbarMode,
  ]);
  useEffect(() => {
    if (showLanding || !currentProjectPath) {
      return undefined;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const topbar = topbarRef.current;
      if (!topbar) {
        return;
      }
      const topbarRect = topbar.getBoundingClientRect();
      if (event.clientY > topbarRect.bottom + 1) {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        Boolean(
          active.closest(
            ".terminal-panel, .ghostty-terminal-host, .xterm, textarea, input, [contenteditable='true']",
          ),
        )
      ) {
        active.blur();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [showLanding, currentProjectPath]);
  const shellClassName = ["shell", settingsOpen ? "shell-settings-open" : ""].filter(Boolean).join(" ");
  const composerPlaceholder = showClarification
    ? "补充消息会排队；回答问题请用上方卡片"
    : showBashApproval
      ? "补充消息会排队；工具授权请用下方卡片"
      : showPlanApproval
        ? "补充消息会排队；计划审批请用下方卡片"
        : contextCompactionInFlight
          ? "上下文压缩中，请稍候…"
          : activeThread?.status === "awaiting_plan"
            ? "请先确认或忽略下方计划"
            : activeThread && isContinuableThreadStatus(activeThread.status)
              ? "继续对话…"
              : composerFollowUpMode
                ? editingFollowUpId
                  ? "编辑引导消息…"
                  : "要求后续变更"
                : activeThread
                  ? "当前对话不可发送"
                  : "尽管问";
  const composerDisabled = Boolean(activeThread && !threadAcceptsInput && !composerFollowUpMode);
  const composerActionMode = canStopThread
    ? composerHasContent
      ? editingFollowUpId
        ? "save-follow-up"
        : "queue"
      : "stop"
    : "send";
  const composerActionBusy = composerActionMode === "stop" ? cancelBusy : isStarting || followUpBusy;
  const composerActionDisabled = composerActionMode === "stop" ? cancelBusy : !canSend;
  const composerActionLabel =
    composerActionMode === "stop"
      ? "停止"
      : composerActionMode === "queue"
        ? "排队后续消息"
        : composerActionMode === "save-follow-up"
          ? "保存引导消息"
          : "发送";
  const composerActionClassName = ["send-button", composerActionMode].filter(Boolean).join(" ");
  const composerCompact = !showLanding;

  const composerRouteControl = (
    <div className="composer-route-control">
      <ComposerRoutePopoverTrigger
        buttonRef={composerRouteButtonRef}
        open={composerRoutePopoverOpen}
        disabled={!canSwitchRouteProfile || isSavingSettings}
        profileName={selectedAgentProfileSummary?.name}
        compact={composerCompact}
        onToggle={() => {
          if (!canSwitchRouteProfile) {
            return;
          }
          setComposerRoutePopoverOpen((current) => !current);
        }}
      />
      <ComposerRoutePopover
        open={composerRoutePopoverOpen && canSwitchRouteProfile}
        settings={settings}
        busy={isSavingSettings}
        anchorRef={composerRouteButtonRef}
        runtimeConfig={composerRuntimeConfig ?? undefined}
        onClose={() => setComposerRoutePopoverOpen(false)}
        onSelectProfile={selectComposerRouteProfile}
        onSaveCurrentProfile={
          selectedRuntimeProfile && composerRuntimeConfig ? saveComposerSelectionAsProfile : undefined
        }
        selectedProfileId={selectedRuntimeProfileId}
        onOpenFullSettings={() => openModelsSettings("routes")}
      />
    </div>
  );

  const composerAgentModelsControl = (
    <ComposerAgentModels
      labels={agentModelLabels}
      subagentSettings={composerRuntimeConfig?.subagentEnabled ?? defaultSubagentAvailability()}
      canEditSubagents={canEditComposerConfig}
      subagentSaving={isSavingSettings}
      compact={composerCompact}
      onToggleSubagent={(role, enabled) => void toggleComposerSubagent(role, enabled)}
    />
  );

  const composerMcpControl = (
    <ComposerMcpServers
      servers={mcpSettings.servers}
      enabledSettings={composerMcpSettings}
      canEdit={canEditComposerConfig}
      saving={isSavingSettings}
      compact={composerCompact}
      onToggleServer={(serverKey, enabled) => void toggleComposerMcpServer(serverKey, enabled)}
    />
  );

  const composer = (
    <div className="codex-composer-wrap">
      {displayedQueuedFollowUps.length > 0 ? (
        <FollowUpQueuePanel
          followUps={displayedQueuedFollowUps}
          cancelBusyId={followUpCancelBusyId}
          escalateBusyId={followUpEscalateBusyId}
          onCancel={(followUp) => void cancelQueuedFollowUp(followUp)}
          onEscalate={(followUp) => void escalateQueuedFollowUp(followUp)}
          onEdit={startEditingFollowUp}
        />
      ) : null}
      {composerImageNotice && <p className="composer-image-notice">{composerImageNotice}</p>}
      {composerPromptCacheHint ? (
        <p className="composer-prompt-cache-hint" role="status">
          {composerPromptCacheHint}
        </p>
      ) : null}
      {editingFollowUpId && composerFollowUpMode ? (
        <div className="composer-rewind-banner">
          <Pencil size={14} aria-hidden />
          <span>正在重新编辑引导消息</span>
          <button
            type="button"
            className="composer-rewind-clear"
            onClick={cancelEditingFollowUp}
            aria-label="取消编辑引导消息"
            title="取消"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {activeComposerRewindTarget && !composerFollowUpMode ? (
        <div className="composer-rewind-banner">
          <RotateCcw size={14} aria-hidden />
          <span>从所选节点分叉</span>
          <button
            type="button"
            className="composer-rewind-clear"
            onClick={() => setComposerRewindTarget(undefined)}
            aria-label="取消回到节点"
            title="取消"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {composerAttachments.length > 0 && (
        <ul className="composer-attachments" aria-label="已粘贴的图片">
          {composerAttachments.map((attachment) => (
            <li key={attachment.id} className="composer-attachment">
              <img src={attachment.previewUrl} alt="" />
              <button
                type="button"
                className="composer-attachment-remove"
                aria-label="移除图片"
                onClick={() => removeComposerAttachment(attachment.id)}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <ComposerDockMorph
        showApproval={showComposerDockApproval}
        surfaceKey={composerDockSurfaceKey}
        approval={
          showBashApproval && pendingBashApproval ? (
            <BashApprovalPanel
              request={pendingBashApproval}
              busy={bashApprovalBusy}
              variant="dock"
              onResolve={(resolution) => void resolvePendingBashApproval(resolution)}
              onSkip={() => void resolvePendingBashApproval({ decision: "denied" })}
            />
          ) : showPlanApproval && pendingPlan ? (
            <PlanApprovalPanel
              plan={pendingPlan}
              busy={planActionBusy}
              variant="dock"
              {...(planFailureMessage && { failureMessage: planFailureMessage })}
              onApprove={() => void approvePendingPlan()}
              onDismiss={() => void dismissPendingPlan()}
            />
          ) : null
        }
        composer={
          <div
            className={["codex-composer", composerCompact ? "is-compact" : ""].filter(Boolean).join(" ")}
            ref={composerAnchorRef}
          >
            <ComposerSkillsSlashMenu
              open={composerSkillPopoverOpen}
              query={composerSkillSlash?.query ?? ""}
              skills={slashPickerSkills}
              matches={composerSkillMatches}
              activeIndex={composerSkillActiveIndex}
              anchorRef={composerAnchorRef}
              onActiveIndexChange={setComposerSkillActiveIndex}
              onSelect={selectComposerSkill}
              onClose={() => syncComposerCursor()}
            />
            <div className="composer-primary">
              <ComposerSkillsInput
                ref={composerRef}
                value={prompt}
                onChange={(next) => {
                  setPrompt(next);
                  if (composerRoutePopoverOpen) {
                    setComposerRoutePopoverOpen(false);
                  }
                }}
                skillsByName={composerSkillsByName}
                onCursorChange={setComposerCursor}
                onKeyDown={handleComposerKeyDown}
                maxHeight={COMPOSER_TEXTAREA_MAX_HEIGHT}
                {...(canPasteComposerImages && { onPaste: handleComposerPaste })}
                placeholder={composerPlaceholder}
                disabled={composerDisabled}
              />
              <div className="composer-footer">
                <div className="composer-footer-main">
                  {composerCompact ? (
                    <div className="composer-footer-row composer-footer-compact-row">
                      {composerRouteControl}
                      <div className="composer-footer-row composer-footer-config-row">
                        {composerRuntimeConfig ? (
                          <ComposerPlanModeToggle
                            sessionMode={composerRuntimeConfig.sessionMode}
                            canEdit={canEditComposerConfig}
                            saving={isSavingSettings}
                            onSelect={(mode) => void selectComposerSessionMode(mode)}
                          />
                        ) : null}
                        {composerRuntimeConfig ? (
                          <ComposerBashReviewToggle
                            bashReviewMode={composerRuntimeConfig.bashReviewMode}
                            canEdit={canEditBashReviewMode}
                            saving={isSavingSettings}
                            onToggle={(mode) => void toggleComposerBashReviewMode(mode)}
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="composer-footer-row composer-footer-config-row">
                      {composerRuntimeConfig ? (
                        <ComposerPlanModeToggle
                          sessionMode={composerRuntimeConfig.sessionMode}
                          canEdit={canEditComposerConfig}
                          saving={isSavingSettings}
                          onSelect={(mode) => void selectComposerSessionMode(mode)}
                        />
                      ) : null}
                      {composerRuntimeConfig ? (
                        <ComposerBashReviewToggle
                          bashReviewMode={composerRuntimeConfig.bashReviewMode}
                          canEdit={canEditBashReviewMode}
                          saving={isSavingSettings}
                          onToggle={(mode) => void toggleComposerBashReviewMode(mode)}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
                {activeThread ? (
                  <ComposerThreadUsagePills
                    threadId={activeThread.id}
                    threadStatus={activeThread.status}
                    {...(threadUsageSummary && { usageSummary: threadUsageSummary })}
                    contextCompactionInFlight={contextCompactionInFlight}
                    autoCompactSuspended={autoCompactSuspended}
                    promptCacheInvalidated={promptCacheInvalidated}
                    agentDisplayNames={activeRuntimeAgentDisplayNames}
                    agentThemes={activeRuntimeAgentThemes}
                  />
                ) : null}
                <button
                  type="button"
                  className={composerActionClassName}
                  onClick={() => {
                    if (composerActionMode === "stop") {
                      void requestStopThread();
                      return;
                    }
                    void sendComposerMessage();
                  }}
                  disabled={composerActionDisabled}
                  title={composerActionLabel}
                  aria-label={composerActionLabel}
                >
                  {composerActionBusy ? (
                    <Activity size={COMPOSER_SEND_ICON_PX} />
                  ) : composerActionMode === "stop" ? (
                    <Square size={COMPOSER_SEND_ICON_PX - 2} />
                  ) : composerActionMode === "queue" ? (
                    <CornerDownRight size={COMPOSER_SEND_ICON_PX} />
                  ) : (
                    <ArrowUp size={COMPOSER_SEND_ICON_PX} />
                  )}
                </button>
              </div>
              {error && (
                <p className="composer-error">
                  <AlertCircle size={14} /> {error}
                </p>
              )}
              {!routesReady && !composerFollowUpMode && (
                <p className="composer-hint">
                  请先在
                  <button type="button" className="link-button" onClick={openProviderSettings}>
                    模型服务商
                  </button>
                  中配置模型（API Key 可选）
                </p>
              )}
            </div>
            {!composerCompact ? (
              <div className="composer-context-bar">
                {composerRouteControl}
                {composerAgentModelsControl}
                {composerMcpControl}
              </div>
            ) : null}
          </div>
        }
      />
      {showLanding && showProjectSkillsPanel ? (
        <ComposerSkillsBar
          sdkReadySkills={projectSdkReadySkills}
          agentsOnlySkills={projectAgentsOnly}
          referencedSkillNames={referencedSkillNames}
          linking={skillsLinking}
          {...(skillsLinkResult && { lastLinkResult: skillsLinkResult })}
          onLinkAgents={linkProjectAgentsSkills}
        />
      ) : null}
    </div>
  );

  return (
    <main className={shellClassName}>
      {fixedSidebarToolbar}
      {appMessageState ? (
        <AppMessage
          kind={appMessageState.kind}
          message={appMessageState.message}
          onDismiss={dismissAppMessage}
        />
      ) : null}
      <aside className="codex-sidebar">
        <button type="button" className="sidebar-action" onClick={startNewChat}>
          <MessageSquarePlus size={18} />
          新对话
        </button>
        <button type="button" className="sidebar-action muted" onClick={openWorkspace} disabled={isOpening}>
          {isOpening ? <Loader2 size={18} className="spinning" aria-hidden /> : <FolderOpen size={18} />}
          {isOpening ? "打开中…" : "打开项目…"}
        </button>

        <div className="sidebar-section sidebar-section-grow">
          <ProjectSidebarTree
            projectTree={projectTree}
            currentProjectPath={currentProjectPath}
            activeThreadId={activeThread?.id}
            pinnedThreadIds={pinnedThreadIds}
            onSwitchProject={switchProject}
            onSelectThread={selectThread}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            onExpandProjectThreads={expandProjectThreads}
            onReorderProjects={reorderProjects}
            onOpenProjectPath={handleOpenProjectFromDrop}
            onPinProject={pinProject}
            onUnpinProject={unpinProject}
            onRemoveProject={removeProject}
            onPinThread={pinThread}
            onUnpinThread={unpinThread}
            deletingThreadId={deletingThreadId}
            onDeleteThread={(thread) => void deleteThread(thread)}
          />
        </div>

        <button type="button" className="sidebar-settings" onClick={openProviderSettings}>
          <Settings2 size={18} />
          设置
        </button>
      </aside>

      <section
        className={[
          "codex-main",
          showLanding ? "codex-main-landing" : "",
          currentProjectPath ? "codex-main-has-toolbar" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div ref={mainPaneRef} className="codex-main-pane">
          <div
            className={[
              "codex-main-scroll",
              showWorkspacePanel ? "has-workspace-panel" : "",
              rightPanelOpen ? "is-workspace-panel-open" : "",
              taskPanelOpen ? "is-task-panel-open" : "",
              taskPanelFullscreenOpen ? "is-task-panel-fullscreen" : "",
              currentProjectPath && showLanding && rightPanelOpen ? "is-topbar-solid" : "",
              !showLanding && currentProjectPath && !topbarSolid ? "is-topbar-clear" : "",
              !showLanding && currentProjectPath && topbarSolid ? "is-topbar-solid" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={rightPanelStyle}
          >
            {currentProjectPath ? (
              <header
                ref={topbarRef}
                className={["codex-main-topbar", showLanding || topbarSolid ? "is-solid" : "is-clear"]
                  .filter(Boolean)
                  .join(" ")}
              >
                {!showLanding && activeThread ? (
                  <div className="activity-header">
                    <h2 title={activeThread.title}>{activeThread.title}</h2>
                  </div>
                ) : (
                  <div className="codex-main-topbar-leading" aria-hidden />
                )}
                <div className="codex-main-topbar-drag-fill" aria-hidden />
                {workspacePanelToolbar}
              </header>
            ) : null}
            <div className="codex-main-left-column">
              <div ref={scrollBodyRef} className="codex-main-scroll-body">
                {showLanding ? (
                  <div className="codex-landing">
                    <h1 className="codex-hero">
                      {currentProjectPath
                        ? homeProjectPath && isHomeProjectPath(currentProjectPath, homeProjectPath)
                          ? "你在忙什么？"
                          : `我们应该在 ${currentProjectName} 中构建什么？`
                        : "打开一个项目开始编码"}
                    </h1>
                    {composer}
                  </div>
                ) : (
                  <div className="codex-feed-stack">
                    <div className="activity-feed">
                      <div className="activity-messages-shell">
                        <div className="activity-feed-top-mask" aria-hidden />
                        <ActivityUserMessageNavigator
                          items={activityUserMessageNavItems}
                          {...(activeActivityUserMessageNavId && {
                            activeId: activeActivityUserMessageNavId,
                          })}
                          onJump={jumpToActivityUserMessage}
                        />
                        <div ref={activityMessagesRef} className="activity-messages">
                          <ActivityLogView
                            {...(activeThread && { thread: activeThread })}
                            {...(runProjection && { projection: runProjection })}
                            {...(activeThread &&
                              billingByThread[activeThread.id] && {
                                billing: billingByThread[activeThread.id],
                              })}
                            onRestorePrompt={restorePrompt}
                            onPlannerLayoutChange={handleActivityPlannerLayoutChange}
                            {...(Object.keys(activityModelByRole).length > 0 && {
                              modelByRole: activityModelByRole,
                            })}
                            agentDisplayNames={activeRuntimeAgentDisplayNames}
                            agentThemes={activeRuntimeAgentThemes}
                            {...(taskDrawerOpen && selectedSubagentAgentId && { selectedSubagentAgentId })}
                            onOpenSubagent={openSubagentTaskDrawer}
                            {...(threadUsageByRole && { usageByRole: threadUsageByRole })}
                            {...(subagentTimings && { subagentTimings })}
                            {...(subagentMetrics && { subagentMetrics })}
                            {...(activeThread &&
                              contextByThread[activeThread.id] && {
                                context: contextByThread[activeThread.id],
                              })}
                          />
                          {showClarification && pendingClarification ? (
                            <ClarificationPanel
                              request={pendingClarification}
                              busy={clarificationBusy}
                              onSubmit={submitClarificationAnswers}
                              onDismiss={() => void dismissPendingClarification()}
                            />
                          ) : null}
                          <div ref={activityEndRef} className="activity-scroll-anchor" aria-hidden />
                        </div>
                        {activityFeedScrollJump ? (
                          <button
                            type="button"
                            className="activity-feed-scroll-jump is-visible"
                            onClick={handleActivityFeedScrollJump}
                            aria-label={activityFeedScrollJump === "top" ? "回到顶部" : "回到底部"}
                            title={activityFeedScrollJump === "top" ? "回到顶部" : "回到底部"}
                          >
                            {activityFeedScrollJump === "top" ? (
                              <ChevronUp size={18} />
                            ) : (
                              <ChevronDown size={18} />
                            )}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {composer}
                  </div>
                )}
              </div>
              {Object.entries(terminalByProject).map(([workspacePath, terminalState]) => {
                if (terminalState.tabs.length === 0) {
                  return null;
                }
                const isCurrentProject = workspacePath === currentProjectPath;
                const workspaceLabel =
                  projects.find((item) => item.path === workspacePath)?.name ?? pathToName(workspacePath);
                return (
                  <div key={workspacePath} className="codex-terminal-project-slot" hidden={!isCurrentProject}>
                    <TerminalPanel
                      workspacePath={workspacePath}
                      workspaceLabel={workspaceLabel}
                      state={terminalState}
                      isCurrentProject={isCurrentProject}
                      onStateChange={(next) => updateProjectTerminal(workspacePath, next)}
                      {...(isCurrentProject && {
                        injectedSessionId: injectedTerminalSessionId,
                        onInjectedSessionConsumed: () => setInjectedTerminalSessionId(null),
                      })}
                    />
                  </div>
                );
              })}
            </div>

            {showWorkspacePanel && taskPanelOpen ? (
              <aside
                id="workspace-panel"
                className={[
                  "workspace-panel",
                  "is-task-panel-mode",
                  taskPanelFullscreenOpen ? "is-fullscreen" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-label={taskPanelFullscreenOpen ? "全屏任务面板" : "任务面板"}
                aria-hidden={!taskPanelOpen}
              >
                <hr
                  className="task-panel-resize-handle"
                  aria-label="调整任务面板宽度"
                  aria-orientation="vertical"
                  tabIndex={0}
                  title="拖动调整宽度"
                  onMouseDown={handleTaskPanelResizeMouseDown}
                  onKeyDown={handleTaskPanelResizeKeyDown}
                />
                <SubagentTaskDrawer
                  open={taskPanelOpen}
                  fullscreen={taskPanelFullscreenOpen}
                  cards={activeSubagentCards}
                  activeTab={taskPanelActiveTab}
                  openSubagentTabIds={openSubagentTabIds}
                  {...(runProjection && { projection: runProjection })}
                  {...(activeThread && { threadStatus: activeThread.status })}
                  agentDisplayNames={activeRuntimeAgentDisplayNames}
                  agentThemes={activeRuntimeAgentThemes}
                  backgroundTasks={backgroundTerminalTasks}
                  {...(reviewDiff && { reviewDiff })}
                  reviewLoading={reviewDiffLoading}
                  {...(reviewDiffError && { reviewError: reviewDiffError })}
                  {...(reviewSelectedPath && { reviewSelectedPath })}
                  onSelectAgent={(agentId) => {
                    setTaskPanelActiveTab(agentId);
                    setSelectedSubagentAgentId(agentId);
                  }}
                  onCloseAgent={closeSubagentTaskTab}
                  onSelectBackgroundTasks={() => {
                    setTaskPanelActiveTab(TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID);
                    setSelectedSubagentAgentId(undefined);
                  }}
                  onSelectReview={() => {
                    setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
                    setSelectedSubagentAgentId(undefined);
                  }}
                  onToggleFullscreen={() => setTaskPanelFullscreen((current) => !current)}
                  onSelectReviewPath={setReviewSelectedPath}
                  onOpenTerminalTask={(task) => void openBackgroundTerminalTask(task)}
                  onStopTerminalTask={(task) => void stopBackgroundTerminalTask(task)}
                />
              </aside>
            ) : null}
          </div>
          {showWorkspacePanel && !taskPanelOpen ? (
            <aside
              ref={workspaceCardsPanelRef}
              id="workspace-panel"
              className={[
                "workspace-panel",
                "workspace-panel--floating-cards",
                workspaceCardsPanelOpen ? "is-open" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label="工作区面板"
              aria-hidden={!workspaceCardsPanelOpen}
            >
              <WorkspaceFloatingCards
                todos={activeThread ? coderTodos : []}
                hasActiveThread={Boolean(activeThread)}
                agentModelLabels={agentModelLabels}
                subagentRunCards={activeSubagentCards}
                {...(selectedSubagentAgentId && { selectedSubagentAgentId })}
                agentDisplayNames={activeRuntimeAgentDisplayNames}
                agentThemes={activeRuntimeAgentThemes}
                onOpenSubagent={openSubagentTaskDrawer}
                {...(composerRuntimeConfig && { composerRuntimeConfig })}
                subagentEnabled={defaultSubagentAvailability()}
                canEditComposerConfig={canEditComposerConfig}
                isSavingSettings={isSavingSettings}
                mcpServers={mcpSettings.servers}
                composerMcpSettings={composerMcpSettings}
                onToggleComposerSubagent={(role, enabled) => void toggleComposerSubagent(role, enabled)}
                onToggleComposerMcpServer={(serverKey, enabled) =>
                  void toggleComposerMcpServer(serverKey, enabled)
                }
                {...(projectWorkspace && { workspace: projectWorkspace })}
                {...(currentProjectPath && { workspacePath: currentProjectPath })}
                workspaceLabel={currentProjectName}
                {...(gitStatus && { gitStatus })}
                gitBusy={gitStatusBusy || gitStatusLoading}
                commitDisabled={
                  activeThread ? activeThread.status === "running" || activeThread.status === "queued" : false
                }
                onCheckoutGitBranch={handleGitCheckoutBranch}
                onCreateGitBranch={handleGitCreateBranch}
                onOpenGitSettings={openGitSettings}
                {...(selectedRuntimeProfileId && { profileId: selectedRuntimeProfileId })}
                gitSettings={gitSettings}
                onSaveCommitModelPreference={saveCommitMessageModelPreference}
                onCommitSuccess={() => void handleGitCommitSuccess()}
                onOpenChangesReview={openReviewTaskDrawer}
                onChangesDiffLoaded={(diff) => void handleChangesDiffLoaded(diff)}
                onChangesDiffLoadingChange={handleChangesDiffLoadingChange}
                onChangesDiffError={handleChangesDiffError}
                onPullSuccess={() => void handleGitPullSuccess()}
                onResolveConflictsWithAgent={(conflictFiles) =>
                  void handleGitPullConflictsWithAgent(conflictFiles)
                }
                {...(showPackageScriptsEntry && {
                  scriptsDisabled: activeThread
                    ? activeThread.status === "running" || activeThread.status === "queued"
                    : false,
                  onOpenScriptsDialog: () => {
                    void refreshPackageScripts();
                    setScriptsDialogOpen(true);
                  },
                })}
              />
            </aside>
          ) : null}
        </div>
      </section>

      {stopConfirm ? (
        <StopThreadConfirmDialog
          changedFiles={stopConfirm.changedFiles}
          busy={cancelBusy}
          onConfirm={() => void performCancel()}
          onDismiss={() => {
            if (!cancelBusy) {
              setStopConfirm(undefined);
            }
          }}
        />
      ) : null}

      {scriptsDialogOpen && currentProjectPath ? (
        <PackageScriptsDialog
          open={scriptsDialogOpen}
          workspacePath={currentProjectPath}
          {...(packageScripts?.packageName && { packageName: packageScripts.packageName })}
          packageManager={packageScripts?.packageManager ?? projectWorkspace?.packageManager ?? "npm"}
          scripts={packageScripts?.scripts ?? []}
          busy={scriptsBusy}
          onClose={() => setScriptsDialogOpen(false)}
          onRun={startPackageScript}
          onRefresh={refreshPackageScripts}
        />
      ) : null}

      {settingsOpen && (
        <div className="settings-page" role="dialog" aria-modal="true" aria-label="设置">
          <aside className="settings-nav">
            <button
              type="button"
              className="settings-nav-back"
              onClick={() => {
                setSettingsOpen(false);
                setSettingsSearch("");
              }}
            >
              <ChevronLeft size={18} />
              返回应用
            </button>

            <div className="settings-nav-search">
              <Search size={15} className="settings-nav-search-icon" aria-hidden />
              <input
                type="search"
                className="settings-nav-search-input"
                placeholder="搜索设置…"
                value={settingsSearch}
                onChange={(event) => setSettingsSearch(event.target.value)}
                aria-label="搜索设置"
              />
            </div>

            <nav className="settings-nav-groups" aria-label="设置分类">
              {settingsNavGroups
                .map((group) => ({
                  ...group,
                  sections: group.sections.filter((section) => {
                    const query = settingsSearch.trim().toLowerCase();
                    if (!query) {
                      return true;
                    }
                    return (
                      section.label.toLowerCase().includes(query) || group.label.toLowerCase().includes(query)
                    );
                  }),
                }))
                .filter((group) => group.sections.length > 0)
                .map((group) => (
                  <div key={group.label} className="settings-nav-group">
                    <span className="settings-nav-group-label">{group.label}</span>
                    {group.sections.map((section) => {
                      const Icon = section.icon;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          className={
                            settingsSection === section.id ? "settings-nav-item active" : "settings-nav-item"
                          }
                          onClick={() => setSettingsSection(section.id)}
                        >
                          <Icon size={16} />
                          {section.label}
                        </button>
                      );
                    })}
                  </div>
                ))}
            </nav>
          </aside>

          <div className="settings-main">
            <div className="settings-content">
              {settingsSection === "general" && (
                <GeneralSettingsPanel theme={appTheme} onThemeChange={setAppTheme} />
              )}

              {settingsSection === "skills" && (
                <SkillsSettingsPanel
                  {...(skillsSnapshot && { snapshot: skillsSnapshot })}
                  loading={isLoadingSkills}
                  onRefresh={() => void refreshSkillsList()}
                />
              )}

              {settingsSection === "mcp" && (
                <McpSettingsPanel
                  servers={mcpSettings.servers}
                  busy={isSavingSettings}
                  onSave={saveMcpServer}
                  onDelete={deleteMcpServer}
                  onCheck={checkMcpServer}
                />
              )}

              {settingsSection === "centerServer" && (
                <CenterServerSettingsPanel
                  snapshot={centerServerSettings}
                  busy={isSavingSettings}
                  onSave={saveCenterServerSettings}
                  onTestConnection={testCenterServerConnection}
                  onSignUp={signUpCenterServer}
                  onSignIn={signInCenterServer}
                  onCreatePairing={createCenterServerPairing}
                  onListBindings={listCenterServerBindings}
                  onListPresence={listCenterServerPresence}
                  onRevokeBinding={revokeCenterServerBinding}
                  onConnect={connectCenterServer}
                  onDisconnect={disconnectCenterServer}
                  onRemoveConnection={removeCenterServerConnection}
                />
              )}

              {settingsSection === "providers" &&
                (proxyBridgeSettings ? (
                  <ModelsSettingsPanel
                    settings={settings}
                    proxyBridgeSettings={proxyBridgeSettings}
                    proxyBridgeSettingsSaving={isSavingProxyBridgeSettings}
                    mode="providerSettings"
                    busy={isSavingSettings}
                    onSettingsChange={setSettings}
                    onSavingChange={setIsSavingSettings}
                    onProxyBridgeSettingsChange={(next) => void saveProxyBridgeSettings(next)}
                  />
                ) : (
                  <p className="settings-empty-hint">正在加载模型服务商配置…</p>
                ))}

              {settingsSection === "models" &&
                (proxyBridgeSettings ? (
                  <ModelsSettingsPanel
                    settings={settings}
                    proxyBridgeSettings={proxyBridgeSettings}
                    mcpServers={mcpSettings.servers}
                    skillsSnapshot={skillsSnapshot}
                    proxyBridgeSettingsSaving={isSavingProxyBridgeSettings}
                    initialTab={modelsSettingsTab}
                    mode="agentBuilder"
                    busy={isSavingSettings}
                    onSettingsChange={setSettings}
                    onSavingChange={setIsSavingSettings}
                    onProxyBridgeSettingsChange={(next) => void saveProxyBridgeSettings(next)}
                  />
                ) : (
                  <p className="settings-empty-hint">正在加载模型与工作流配置…</p>
                ))}

              {settingsSection === "git" && (
                <GitSettingsPanel settings={gitSettings} onSave={saveGitSettingsSnapshot} />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function isThreadLiveEvent(event: unknown): event is ThreadLiveEvent {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const candidate = event as ThreadLiveEvent;
  return typeof candidate.threadId === "string" && typeof candidate.message === "string";
}

function FollowUpQueuePanel({
  followUps,
  cancelBusyId,
  escalateBusyId,
  onCancel,
  onEscalate,
  onEdit,
}: {
  followUps: ThreadPendingFollowUp[];
  cancelBusyId: string | undefined;
  escalateBusyId: string | undefined;
  onCancel: (followUp: ThreadPendingFollowUp) => void;
  onEscalate: (followUp: ThreadPendingFollowUp) => void;
  onEdit: (followUp: ThreadPendingFollowUp) => void;
}) {
  return (
    <div className="follow-up-queue" aria-label="已排队的引导消息">
      <div className="follow-up-queue-rows">
        {followUps.map((followUp) => {
          const actionBusy = cancelBusyId === followUp.id || escalateBusyId === followUp.id;
          const isEscalating = escalateBusyId === followUp.id;
          const canEscalate = followUp.priority !== "escalated";

          return (
            <div key={followUp.id} className="follow-up-row">
              <div
                className="follow-up-card-main follow-up-card-main-editable"
                role="button"
                tabIndex={actionBusy ? -1 : 0}
                aria-label="重新编辑引导消息"
                title="重新编辑"
                onClick={() => {
                  if (!actionBusy) {
                    onEdit(followUp);
                  }
                }}
                onKeyDown={(event) => {
                  if (actionBusy || (event.key !== "Enter" && event.key !== " ")) {
                    return;
                  }
                  event.preventDefault();
                  onEdit(followUp);
                }}
              >
                <CornerDownRight size={16} aria-hidden className="follow-up-card-leading-icon" />
                <span className="follow-up-card-text">{formatThreadFollowUpPreview(followUp)}</span>
              </div>
              <div className="follow-up-card-actions">
                {canEscalate ? (
                  <span
                    className="follow-up-card-type follow-up-card-type-action"
                    role="button"
                    tabIndex={actionBusy ? -1 : 0}
                    aria-disabled={actionBusy}
                    aria-label="立即处理引导消息"
                    title="立即处理"
                    onClick={() => {
                      if (!actionBusy) {
                        onEscalate(followUp);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (actionBusy || (event.key !== "Enter" && event.key !== " ")) {
                        return;
                      }
                      event.preventDefault();
                      onEscalate(followUp);
                    }}
                  >
                    <CornerDownRight size={12} aria-hidden />
                    {isEscalating ? "正在处理…" : "引导"}
                  </span>
                ) : (
                  <span className="follow-up-card-type">
                    <CornerDownRight size={12} aria-hidden />
                    引导
                  </span>
                )}
                <button
                  type="button"
                  className="follow-up-card-action"
                  onClick={() => onCancel(followUp)}
                  disabled={actionBusy}
                  title="删除"
                  aria-label="删除引导消息"
                >
                  {cancelBusyId === followUp.id ? <Activity size={14} /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function isActiveThreadStatus(status: ThreadStatus): boolean {
  return status === "running" || status === "queued";
}

function statusFromLiveEvent(type: string, fallback: ThreadStatus): ThreadStatus {
  if (type === "thread.completed") return "completed";
  if (type === "thread.failed") return "failed";
  if (type === "thread.blocked") return "blocked";
  if (type === "thread.awaiting_plan" || type === "thread.execution_failed") return "awaiting_plan";
  if (type === "thread.idle" || type === "thread.stopped" || type === "thread.execution_done") return "idle";
  if (
    type === "thread.running" ||
    type === "thread.started" ||
    type === "thread.queued" ||
    type === "thread.retry"
  ) {
    return "running";
  }
  return fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function removeRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) {
    return record;
  }
  const next = { ...record };
  delete next[key];
  return next;
}

function pathToName(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
