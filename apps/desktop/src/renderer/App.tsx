import type { CoreKind } from "@eco/runtime/core-runtime";
import {
  defaultSubagentAvailability,
} from "@eco/runtime/subagent-availability";
import {
  Activity,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CircleAlert,
  Cloud,
  Cpu,
  CornerDownRight,
  FolderOpen,
  GitBranch,
  Gauge,
  Globe,
  GripVertical,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  MessageCirclePlus,
  MessageSquare,
  Mic,
  Maximize2,
  Minimize2,
  Monitor,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Plug,
  RefreshCw,
  Search,
  Settings,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  type LucideIcon,
  Workflow,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import { I18nextProvider, useTranslation } from "react-i18next";
import type { AppLocalePreference } from "../shared/locale";
import {
  applyLocalePreference,
  i18n,
  initialLocalePreference,
} from "./i18n";
import { installVitePreloadRecovery } from "./vite-preload-recovery";
import { DefaultAgentSettingsPanel } from "./DefaultAgentSettingsPanel";
import { ContextWindowSettingsPanel } from "./ContextWindowSettingsPanel";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";
import { AppMessage, useAppMessage } from "./AppMessage";
import { DesktopUpdateBanner } from "./DesktopUpdateBanner";
import { shouldRevealDesktopUpdateBanner } from "./desktop-update-banner-state";
import { GitSettingsPanel } from "./GitSettingsPanel";
import { PersonalizationSettingsPanel } from "./PersonalizationSettingsPanel";
import { AsrSettingsPanel } from "./AsrSettingsPanel";
import { StorageSettingsPanel } from "./StorageSettingsPanel";
import { BrowserSettingsPanel } from "./BrowserSettingsPanel";
import { ImageGenerationSettingsPanel } from "./ImageGenerationSettingsPanel";
import { NotificationPreferencesPanel } from "./NotificationPreferencesPanel";
import { BROWSER_LINK_OPEN_EVENT } from "./browser-link";
import type { BrowserSettingsSnapshot, BrowserViewState } from "../shared/browser";
import type { WebChatItem, WebChatListView } from "../shared/web-chat-list";
import { mergeWebChatList, defaultWebChatListSnapshot } from "../shared/web-chat-list";
import { WebChatListPopover } from "./WebChatListPopover";
import {
  defaultNotificationSettings,
  type NotificationSettingsSnapshot,
} from "../shared/notification-settings";
import { AsrMicButton, AsrVoiceComposer, useAsrRecorder } from "./AsrRecorder";
import { mergeAsrTextAtSelection } from "./asr-composer";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import {
  formatPromptCacheConfigDriftHint,
  resolvePromptCacheConfigDrift,
  resolvePromptCacheOrchestrationLabel,
} from "../shared/prompt-cache-config";
import {
  buildThreadRuntimeConfigFromDefaults,
  type AppMenuCommand,
  type BackgroundTerminalTask,
  type BashApprovalRequest,
  type CandidateModelView,
  type ClarificationRequest,
  type CoderTodoItem,
  type CoreAvailabilitySnapshot,
  type OrchestrationSelection,
  type ResolvedOrchestrationSnapshot,
  type SubagentSelection,
  deriveSubagentEnabledFromSnapshot,
  deriveMcpServersEnabled,
  hasCompleteOrchestrationSelection,
  listEnabledGlobalMcpServerKeys,
  type LinkAgentsSkillsResult,
  type McpServerCheckResult,
  type McpServerConfigInput,
  type McpSettingsSnapshot,
  type MainAgentModelOverride,
  type AuxiliaryModelSelection,
  type VisionModelSelection,
  type MainAgentPromptSelection,
  type ModelSettingsSnapshot,
  type GitSettingsSnapshot,
  type PersonalizationSettingsSnapshot,
  type AsrProfileSaveInput,
  type AsrProfileSnapshot,
  type AsrProfilesSnapshot,
  type GitWorkingTreeStatus,
  type PackageScriptsListResult,
  type ProxyBridgeSettingsSnapshot,
  type ProjectMcpSettingsSnapshot,
  type ProjectIntegrationsSettingsSnapshot,
  type ImageGenerationSettingsSnapshot,
  type ImageGenerationArtifact,
  type IntegrationAvailabilitySnapshot,
  type ProjectOrchestrationSettingsSnapshot,
  type RouteCapabilityHint,
  type RoutePricingHint,
  resolveMainAgentModelOverrideForProvider,
  resolveThreadOrchestrationSnapshot,
  runtimeRoleRoutesFromOrchestrationSnapshot,
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
  imageGenerationTaskTabId,
  parseImageGenerationTaskTabId,
} from "../shared/image-generation";
import { isEcoSdkModelAlias, pickDisplayModelId } from "../shared/model-id";
import { canRegenerateThreadTitle } from "../shared/thread-title-pending";
import {
  materializeThreadOrchestrationSnapshot,
  threadRuntimeConfigsEquivalent,
} from "../shared/thread-runtime-config";
import {
  HOME_PROJECT_DISPLAY_NAME,
  HOME_PROJECT_IMPORTED_AT,
  isHomeProjectPath,
  normalizeProjectPath,
} from "../shared/home-project";
import {
  deriveSkillsEnabled,
  type ProjectSkillsSettingsSnapshot,
} from "../shared/composer-skills-settings";
import {
  dedupeSkillsByName,
  isSkillAvailableForCore,
  listSdkReadyProjectSkills,
  parseExplicitSkillNames,
  promptIncludesSkillName,
  type SkillCatalogEntry,
  type SkillInfo,
  type SkillLayout,
} from "../shared/skills";
import { isContinuableThreadStatus } from "../shared/thread-continuation";
import {
  extractPlanFailureMessage,
  resolveThreadMessageFromLiveEvent,
  shouldUpdateThreadSummaryFromLiveEvent,
} from "../shared/thread-failure-message";
import { buildThreadUsageSummary } from "../shared/thread-usage-summary";
import { ActivityLogView } from "./ActivityLogView";
import {
  ACTIVITY_FEED_EARLIER_PAGE_LIMIT,
  ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX,
  createFeedEarlierHistoryState,
  type FeedEarlierHistoryState,
  mergeFeedTimelineById,
  resolveFeedEarlierBeforeSequence,
  shouldLoadFeedEarlier,
} from "./feed-earlier-history";
import { isOrchestrationSnapshotReady } from "./orchestration-readiness";
import { BashApprovalPanel, type BashApprovalResolutionInput } from "./BashApprovalPanel";
import { ComposerDockMorph } from "./ComposerDockMorph";
import { ClarificationPanel } from "./ClarificationPanel";
import { ComposerAgentModels } from "./ComposerAgentModels";
import { ComposerMcpServers } from "./ComposerMcpServers";
import { ComposerIntegrations } from "./ComposerIntegrations";
import { ComposerSkillsControl } from "./ComposerSkillsControl";
import {
  buildComposerModelOptions,
  ComposerModelSelector,
  type ComposerModelOption,
} from "./ComposerModelSelector";
import { ComposerModelEmptyTrigger } from "./ComposerModelEmptyTrigger";
import { resolveComposerModelAvailability } from "./composer-model-availability";
import { ComposerBashReviewToggle } from "./ComposerBashReviewToggle";
import { ComposerPlusMenu, ComposerSessionModeTag } from "./ComposerPlusMenu";
import { withSessionMode, type SessionMode } from "../shared/plan-mode-ui";
import { ComposerRoutePopover } from "./ComposerRoutePopover";
import { ComposerSkillsBar } from "./ComposerSkillsBar";
import { ComposerThreadUsagePills } from "./ComposerThreadUsagePills";
import { ComposerSkillsInput, type ComposerSkillsInputHandle } from "./ComposerSkillsInput";
import { ComposerSkillsSlashMenu } from "./ComposerSkillsSlashMenu";
import { ThreadIdleCacheWarning } from "./ThreadIdleCacheWarning";
import { resolveLatestThreadActivityAt } from "./thread-idle-cache-warning";
import { buildComposerAgentModelLabels } from "./composer-agent-model-labels";
import {
  COMPOSER_MAX_IMAGES,
  type ComposerImageAttachment,
  fromPromptImageAttachments,
  readImageFileAsAttachment,
  toPromptImageAttachments,
} from "./composer-attachments";
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
import { COMPOSER_SEND_ICON_PX, ICON_SIZE, ICON_STROKE } from "./icon-metrics";
import { CenterServerSettingsPanel } from "./CenterServerSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";
import { buildSidebarAttentionItems } from "./sidebar-attention-items";
import { SidebarCoreSelector } from "./SidebarCoreSelector";
import { SidebarSearchDialog } from "./SidebarSearchDialog";
import { StopThreadConfirmDialog } from "./StopThreadConfirmDialog";
import {
  SubagentTaskDrawer,
  TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID,
  TASK_PANEL_FILES_TAB_ID,
  TASK_PANEL_FILE_VIEWER_TAB_ID,
  TASK_PANEL_HOME_TAB_ID,
  TASK_PANEL_PLAN_TAB_ID,
  TASK_PANEL_REVIEW_TAB_ID,
  type TaskPanelActiveTab,
} from "./SubagentTaskDrawer";
import {
  browserTaskTabId,
  isBrowserTaskTabId,
  parseBrowserTaskTabId,
} from "../shared/browser";
import { loadTaskPanelReviewDiff } from "./task-panel-review-loader";
import {
  captureTaskPanelSessionUiState,
  emptyTaskPanelSessionUiState,
  normalizeTaskPanelSessionUiState,
  type TaskPanelSessionUiState,
} from "./task-panel-session-ui-state";
import { addOpenTaskPanelTab, removeOpenTaskPanelTab } from "./task-panel-tab-state";
import { WorkspaceFloatingCards } from "./WorkspaceFloatingCards";
import {
  WORKSPACE_FILE_REFERENCE_EVENT,
  isWorkspacePathContained,
  type WorkspaceFileReference,
} from "./workspace-file-reference";
import {
  type ActivityWorkspaceLayoutMode,
  MAIN_SHELL_MEDIA_QUERIES,
  panelChromeCssVariables,
  resolveActivityWorkspaceLayoutMode,
  resolveTaskPanelLayoutPhase,
  shouldAutoOpenWorkspacePanel,
  shouldShowActivityMessageNav,
  shouldShowPanelChromeGroupB,
  shouldShowWorkspaceActionGroupA,
  workspacePanelLayoutForMode,
} from "./activity-workspace-layout";
import {
  TerminalPanel,
  type TerminalSessionPresentation,
} from "./TerminalPanel";
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
  formatThreadFollowUpPreview,
  isLiveFollowUpThreadStatus,
  mergeThreadFollowUp,
  queuedThreadFollowUps,
  sortThreadFollowUps,
} from "./thread-follow-up-ui";
import { mergeThreadRunProjectionUpdate } from "./run-projection-merge";
import { shouldClearPendingBashApproval, shouldClearPendingPlanApproval } from "./approval-ui-state";
import {
  cacheWorkspaceGitStatus,
  shouldRefreshWorkspaceGitStatus,
  type WorkspaceGitStatusCache,
} from "./workspace-git-status-cache";
import {
  clearLocalStreamUpdates,
  publishLocalStreamUpdate,
  useLocalStreamProjection,
} from "./local-stream-projection";
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
import type { DesktopUpdateState } from "../shared/desktop-update";
import {
  persistTypographyPreferences,
  readStoredTypographyPreferences,
  type TypographyPreferences,
} from "./typography-preferences";
import {
  persistPromptCacheTipPreferences,
  readStoredPromptCacheTipPreferences,
  type PromptCacheTipPreferences,
} from "./prompt-cache-tip-preferences";
import { isThreadActivelyViewed, subscribeToWindowFocus } from "./window-focus";
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

function reportDesktopNotification(
  request: Promise<{ shown: boolean; reason?: string }>,
  notificationLabel: string,
): void {
  void request.then(
    (result) => {
      if (!result.shown) {
        console.error(`[eco] ${notificationLabel} notification was not shown: ${result.reason}`);
      }
    },
    (notificationError) => {
      console.error(`[eco] ${notificationLabel} notification request failed`, notificationError);
    },
  );
}

const emptySettings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  mainAgentConfigs: [],
  mainAgentPrompts: [],
  subagentOrchestrations: [],
};

const recentProjectsStorageKey = "eco.recent-projects";
const projectOrderStorageKey = "eco.project-order";
const pinnedProjectsStorageKey = "eco.sidebar.pinned-projects";
const pinnedThreadsStorageKey = "eco.sidebar.pinned-threads";
const unreadThreadsStorageKey = "eco.sidebar.unread-threads";
const collapsedProjectsStorageKey = "eco.sidebar.collapsed-projects";
const hiddenProjectsStorageKey = "eco.sidebar.hidden-projects";
const compactSidebarMediaQuery = MAIN_SHELL_MEDIA_QUERIES.sidebarOverlay;
const taskPanelNarrowMediaQuery = MAIN_SHELL_MEDIA_QUERIES.taskOverlay;
const sidebarThreadsCollapsed = 5;

interface RecentProject {
  path: string;
  name: string;
  /** Set once when the project is first opened in the app; used for stable sidebar order. */
  importedAt: string;
}

type SettingsSectionId =
  | "preferences"
  | "general"
  | "personalization"
  | "storage"
  | "browser"
  | "imageGeneration"
  | "providers"
  | "mcp"
  | "centerServer"
  | "defaultAgent"
  | "contextWindow"
  | "agentLibrary"
  | "orchestrationComponents"
  | "skills"
  | "git"
  | "asr";

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  keywords?: string[];
}

interface SettingsNavGroup {
  label: string;
  sections: SettingsSection[];
}

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

const emptyImageGenerationSettings: ImageGenerationSettingsSnapshot = {
  enabled: false,
  activeProfileId: "",
  profiles: [],
  apiKeyEncryptionAvailable: false,
};

const emptyIntegrationAvailability: IntegrationAvailabilitySnapshot = {
  integrations: [
    { id: "browser", enabled: false, available: false },
    { id: "imageGeneration", enabled: false, available: false },
  ],
};


const emptyGitSettings: GitSettingsSnapshot = {
  commitMessageRoleByMainAgentConfigId: {},
  commitMessageCandidateModelIdByMainAgentConfigId: {},
};

const emptyPersonalizationSettings: PersonalizationSettingsSnapshot = {};
const emptyAsrProfiles: AsrProfilesSnapshot = {
  profiles: [],
  activeProfileId: "",
  apiKeyEncryptionAvailable: false,
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

    const labelBase = workspaceLabel.trim() || i18n.t("app.terminalFallback");
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
    topbar.querySelector(".codex-main-topbar-actions"),
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
const ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD = ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD_PX;
const WORKSPACE_CARDS_RESPONSIVE_GAP_PX = 18;
const COMPOSER_DRAFT_SAVE_DEBOUNCE_MS = 250;
const WORKSPACE_CARDS_PANEL_WIDTH_PX = 300;

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
    userMessage:
      normalizeActivityUserMessageText(text) || i18n.t("app.userMessage", { count: index + 1 }),
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
  return i18n.t("app.jumpToMessage", {
    message: clipActivityUserMessageText(item.userMessage, 34),
  });
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
  hidden = false,
  onJump,
}: {
  items: ActivityUserMessageNavItem[];
  activeId?: string;
  hidden?: boolean;
  onJump: (id: string) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string>();
  if (hidden || items.length === 0) {
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
      aria-label={i18n.t("app.userMessageList")}
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
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => !window.matchMedia(compactSidebarMediaQuery).matches,
  );
  const menuCommandHandlerRef = useRef<(command: AppMenuCommand) => void>(() => {});
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState>();
  const desktopUpdateStateRef = useRef<DesktopUpdateState | undefined>(undefined);
  const [desktopUpdateBannerDismissed, setDesktopUpdateBannerDismissed] = useState(false);
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarRevealTarget, setSidebarRevealTarget] = useState<{
    kind: "project" | "thread";
    id: string;
    requestId: number;
  }>();
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readStoredAppTheme());
  const [localePreference, setLocalePreference] =
    useState<AppLocalePreference>(initialLocalePreference);
  const [typographyPreferences, setTypographyPreferences] = useState<TypographyPreferences>(() =>
    readStoredTypographyPreferences(),
  );
  const [promptCacheTipPreferences, setPromptCacheTipPreferences] =
    useState<PromptCacheTipPreferences>(() => readStoredPromptCacheTipPreferences());

  useEffect(() => {
    const mediaQuery = window.matchMedia(compactSidebarMediaQuery);
    const collapseSidebar = () => {
      if (mediaQuery.matches) {
        setSidebarOpen(false);
      }
    };
    collapseSidebar();
    mediaQuery.addEventListener("change", collapseSidebar);
    return () => mediaQuery.removeEventListener("change", collapseSidebar);
  }, []);

  useEffect(() => {
    persistAppTheme(appTheme);
  }, [appTheme]);

  useEffect(() => {
    persistTypographyPreferences(typographyPreferences);
  }, [typographyPreferences]);

  useEffect(() => {
    persistPromptCacheTipPreferences(promptCacheTipPreferences);
  }, [promptCacheTipPreferences]);

  useEffect(() => {
    void applyLocalePreference(localePreference);
  }, [localePreference]);

  useEffect(() => {
    if (!window.eco) {
      return undefined;
    }
    return window.eco.onAppMenuCommand((command) => menuCommandHandlerRef.current(command));
  }, []);

  useEffect(() => {
    if (!window.eco?.getDesktopUpdateState || !window.eco.onDesktopUpdateStateChanged) {
      return undefined;
    }
    let active = true;
    const applyUpdateState = (state: DesktopUpdateState) => {
      if (!active) {
        return;
      }
      const previousState = desktopUpdateStateRef.current;
      desktopUpdateStateRef.current = state;
      setDesktopUpdateState(state);
      if (shouldRevealDesktopUpdateBanner(previousState, state)) {
        setDesktopUpdateBannerDismissed(false);
      }
    };
    void window.eco.getDesktopUpdateState().then(applyUpdateState);
    return window.eco.onDesktopUpdateStateChanged(applyUpdateState);
  }, []);

  useEffect(() => {
    if (localePreference !== "system") {
      return undefined;
    }
    const handleLanguageChange = () => {
      void applyLocalePreference("system");
    };
    window.addEventListener("languagechange", handleLanguageChange);
    return () => window.removeEventListener("languagechange", handleLanguageChange);
  }, [localePreference]);

  const settingsNavGroups = useMemo<SettingsNavGroup[]>(
    () => [
      {
        label: t("settings.group.personal"),
        sections: [
          {
            id: "preferences",
            label: t("settings.preferences"),
            icon: Settings,
            keywords: [
              t("settings.preferences.general"),
              t("settings.language"),
              t("settings.cacheBreakTips"),
              t("settings.notifications"),
              t("settings.notifications.turnCompletion"),
              t("settings.notifications.permission"),
              t("settings.notifications.question"),
              "notification",
              "通知",
              "语言",
              "language",
              "轮次",
              "cache break",
              "prompt cache",
              "cache",
            ],
          },
          {
            id: "general",
            label: t("settings.general"),
            icon: Monitor,
            keywords: [
              t("settings.theme"),
              t("settings.fonts"),
              "code",
            ],
          },
          {
            id: "personalization",
            label: t("settings.personalization"),
            icon: SlidersHorizontal,
            keywords: [
              t("settings.personalization.rules"),
              "rules",
              "prompt",
              "claude",
              "codex",
            ],
          },
          {
            id: "storage",
            label: t("settings.storage"),
            icon: HardDrive,
            keywords: [
              t("settings.storage.usage"),
              t("settings.storage.cleanup"),
              "disk",
              "logs",
              "checkpoint",
              "sqlite",
              "存储",
              "清理",
            ],
          },
        ],
      },
      {
        label: t("settings.group.integrations"),
        sections: [
          { id: "providers", label: t("settings.providers"), icon: Settings2 },
          { id: "mcp", label: t("settings.mcp.title"), icon: Plug },
          {
            id: "browser",
            label: t("settings.browser"),
            icon: Globe,
            keywords: [
              t("settings.browser.agentIntegration"),
              "browser",
              "cdp",
              "agent-browser",
              "浏览器",
            ],
          },
          {
            id: "imageGeneration",
            label: t("settings.imageGeneration.title"),
            icon: ImageIcon,
            keywords: [
              t("settings.imageGeneration.masterTitle"),
              "image generation",
              "OpenAI",
              "Gemini",
              "生图",
              "图片创建",
            ],
          },
          { id: "centerServer", label: t("settings.connection"), icon: Cloud },
          { id: "asr", label: t("asr.title"), icon: Mic },
        ],
      },
      {
        label: t("settings.group.coding"),
        sections: [
          {
            id: "orchestrationComponents",
            label: t("settings.orchestrationComponents"),
            icon: Workflow,
          },
          { id: "defaultAgent", label: t("settings.defaultAgent"), icon: Cpu },
          {
            id: "contextWindow",
            label: t("settings.contextWindow"),
            icon: Gauge,
            keywords: ["context", "tokens", "compact", "上下文", "压缩"],
          },
          { id: "agentLibrary", label: t("settings.agentLibrary"), icon: BookOpen },
          { id: "skills", label: t("settings.skills.store"), icon: Sparkles },
          { id: "git", label: "Git", icon: GitBranch },
        ],
      },
    ],
    [t],
  );

  useEffect(() => {
    if (appTheme !== "system") {
      return undefined;
    }
    return subscribeToSystemTheme(() => {
      persistAppTheme("system");
    });
  }, [appTheme]);

  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [projectWorkspace, setProjectWorkspace] = useState<WorkspaceInfo>();
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>();
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<Set<string>>(() => new Set());
  const [expandedProjectThreadPaths, setExpandedProjectThreadPaths] = useState<Set<string>>(() => new Set());
  const [hiddenProjectPaths, setHiddenProjectPaths] = useState<Set<string>>(() => new Set());
  const [pinnedProjectPaths, setPinnedProjectPaths] = useState<Set<string>>(() => new Set());
  const [pinnedThreadIds, setPinnedThreadIds] = useState<Set<string>>(() => new Set());
  const [unreadThreadIds, setUnreadThreadIds] = useState<Set<string>>(() => new Set());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [homeProjectPath, setHomeProjectPath] = useState<string>();
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const projectOrderInitializedRef = useRef(false);
  const prevThreadStatusByIdRef = useRef(new Map<string, ThreadStatus>());
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [titleGeneratingThreadIds, setTitleGeneratingThreadIds] = useState<Set<string>>(() => new Set());
  const [settings, setSettings] = useState<ModelSettingsSnapshot>(emptySettings);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsSnapshot>(emptyMcpSettings);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettingsSnapshot>({
    sessionMode: "agent",
    defaultCoreKind: "claude",
    contextWindowLimitTokens: 262_144,
    maxOutputLimitTokens: 32_000,
  });
  const [centerServerSettings, setCenterServerSettings] =
    useState<CenterServerSettingsSnapshot>(emptyCenterServerSettings);
  const [asrProfiles, setAsrProfiles] = useState<AsrProfilesSnapshot>(emptyAsrProfiles);
  const [asrSettingsLoadError, setAsrSettingsLoadError] = useState<string>();
  const [asrBusy, setAsrBusy] = useState(false);
  const asrBusyRef = useRef(false);

  useEffect(() => {
    if (!window.eco?.onCenterServerStatusChange) {
      return undefined;
    }
    return window.eco.onCenterServerStatusChange((snapshot) => {
      setCenterServerSettings(snapshot);
    });
  }, []);
  const [skillsSnapshot, setSkillsSnapshot] = useState<SkillsListResult>();
  const [projectMcpSettings, setProjectMcpSettings] =
    useState<ProjectMcpSettingsSnapshot>();
  const [projectIntegrationsSettings, setProjectIntegrationsSettings] =
    useState<ProjectIntegrationsSettingsSnapshot>();
  const [projectOrchestrationSettings, setProjectOrchestrationSettings] =
    useState<ProjectOrchestrationSettingsSnapshot>();
  const [projectSkillsSettings, setProjectSkillsSettings] =
    useState<ProjectSkillsSettingsSnapshot>();
  const [proxyBridgeSettings, setProxyBridgeSettings] = useState<ProxyBridgeSettingsSnapshot | null>(null);
  const [isSavingProxyBridgeSettings, setIsSavingProxyBridgeSettings] = useState(false);
  const [composerRoutePopoverOpen, setComposerRoutePopoverOpen] = useState(false);
  const [composerRouteAnchor, setComposerRouteAnchor] = useState<"plus" | "model-empty">("plus");
  const [modelsSettingsTab, setModelsSettingsTab] = useState<ModelsSettingsTab>("subagents");
  const composerPlusButtonRef = useRef<HTMLButtonElement>(null);
  const composerModelEmptyTriggerRef = useRef<HTMLButtonElement>(null);
  const composerImageInputRef = useRef<HTMLInputElement>(null);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const composerInputOverlaysRef = useRef<HTMLDivElement>(null);
  const [composerInputOverlaysHeight, setComposerInputOverlaysHeight] = useState(0);
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
  const pendingPlansByThreadRef = useRef<Record<string, ThreadPendingPlan>>({});
  const [approvedPlansByThread, setApprovedPlansByThread] = useState<Record<string, ThreadPendingPlan>>({});
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
    showSuccess: showAppMessageSuccess,
    dismiss: dismissAppMessage,
    state: appMessageState,
  } = useAppMessage();
  const showAppMessageErrorRef = useRef(showAppMessageError);
  showAppMessageErrorRef.current = showAppMessageError;
  const showAppMessageSuccessRef = useRef(showAppMessageSuccess);
  showAppMessageSuccessRef.current = showAppMessageSuccess;
  const [subagentTimingsByThread, setSubagentTimingsByThread] = useState<
    Record<string, ThreadSubagentSessionTiming[]>
  >({});
  const [subagentMetricsByThread, setSubagentMetricsByThread] = useState<
    Record<string, ThreadSubagentMetricsSummary[]>
  >({});
  const [runProjectionByThread, setRunProjectionByThread] = useState<
    Record<string, ThreadRunProjectionSnapshot>
  >({});
  const [feedEarlierByThread, setFeedEarlierByThread] = useState<
    Record<string, FeedEarlierHistoryState>
  >({});
  const [loadingFeedEarlier, setLoadingFeedEarlier] = useState(false);
  const loadingFeedEarlierRef = useRef(false);
  const feedEarlierByThreadRef = useRef(feedEarlierByThread);
  feedEarlierByThreadRef.current = feedEarlierByThread;
  const loadFeedEarlierRef = useRef<() => void>(() => {});
  const feedEarlierScrollAnchorRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(
    null,
  );
  const [usageByThread, setUsageByThread] = useState<Record<string, Record<string, ThreadUsageSnapshot>>>({});
  const [billingByThread, setBillingByThread] = useState<Record<string, ThreadBillingSnapshot>>({});
  const [contextByThread, setContextByThread] = useState<Record<string, ThreadContextSnapshot>>({});
  const [modelByThread, setModelByThread] = useState<Record<string, Record<string, string>>>({});
  const [todosByThread, setTodosByThread] = useState<Record<string, CoderTodoItem[]>>({});
  const [cancelBusy, setCancelBusy] = useState(false);
  const [stopConfirm, setStopConfirm] = useState<{ changedFiles: string[] }>();
  const [composerRuntimeConfig, setComposerRuntimeConfig] = useState<ThreadRuntimeConfig | null>(null);
  const [newThreadCoreKind, setNewThreadCoreKind] = useState<CoreKind>("claude");
  const [coreAvailability, setCoreAvailability] = useState<CoreAvailabilitySnapshot>();
  const [composerCandidateModels, setComposerCandidateModels] = useState<CandidateModelView[]>([]);
  const [composerModelsLoading, setComposerModelsLoading] = useState(false);
  const [composerModelsError, setComposerModelsError] = useState<string>();
  const [composerModelsRefreshNonce, setComposerModelsRefreshNonce] = useState(0);
  const [gitStatusByWorkspace, setGitStatusByWorkspace] = useState<WorkspaceGitStatusCache>({});
  const gitStatusByWorkspaceRef = useRef<WorkspaceGitStatusCache>({});
  const [gitStatusBusy, setGitStatusBusy] = useState(false);
  const [gitStatusLoadingByWorkspace, setGitStatusLoadingByWorkspace] = useState<
    Record<string, boolean>
  >({});
  const gitStatusRequestRef = useRef(new Map<string, number>());
  const [gitSettings, setGitSettings] = useState<GitSettingsSnapshot>(emptyGitSettings);
  const [personalizationSettings, setPersonalizationSettings] =
    useState<PersonalizationSettingsSnapshot>(emptyPersonalizationSettings);
  const [browserSettings, setBrowserSettings] = useState<BrowserSettingsSnapshot>({
    agentIntegrationEnabled: false,
    openApprovalMode: "always_allow",
  });
  const [imageGenerationSettings, setImageGenerationSettings] =
    useState<ImageGenerationSettingsSnapshot>(emptyImageGenerationSettings);
  const [integrationAvailability, setIntegrationAvailability] =
    useState<IntegrationAvailabilitySnapshot>(emptyIntegrationAvailability);
  const [webChatList, setWebChatList] = useState<WebChatListView>(() =>
    mergeWebChatList(defaultWebChatListSnapshot()),
  );
  const [webChatListOpen, setWebChatListOpen] = useState(false);
  const webChatListAnchorRef = useRef<HTMLButtonElement>(null);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettingsSnapshot>(
    defaultNotificationSettings(),
  );
  const [browserViewState, setBrowserViewState] = useState<BrowserViewState>();
  const [scriptsDialogOpen, setScriptsDialogOpen] = useState(false);
  const [packageScripts, setPackageScripts] = useState<PackageScriptsListResult>();
  const [storedTerminalByProject] = useState<TerminalWorkspaceState>(() => readTerminalWorkspaceState());
  const [terminalByProject, setTerminalByProject] = useState<TerminalWorkspaceState>({});
  const [workspacePanelManualOverride, setWorkspacePanelManualOverride] = useState<{
    layoutMode: ActivityWorkspaceLayoutMode;
    projectPath: string | undefined;
    threadId: string | undefined;
    open: boolean;
  }>();
  const [backgroundTerminalTasks, setBackgroundTerminalTasks] = useState<BackgroundTerminalTask[]>([]);
  const [imageArtifactsByThread, setImageArtifactsByThread] =
    useState<Record<string, ImageGenerationArtifact[]>>({});
  const [selectedSubagentAgentId, setSelectedSubagentAgentId] = useState<string>();
  const [taskPanelActiveTab, setTaskPanelActiveTab] = useState<TaskPanelActiveTab>(TASK_PANEL_HOME_TAB_ID);
  const [openTaskPanelTabIds, setOpenTaskPanelTabIds] = useState<TaskPanelActiveTab[]>([]);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskPanelLayoutPresent, setTaskPanelLayoutPresent] = useState(false);
  const [taskPanelExiting, setTaskPanelExiting] = useState(false);
  const [taskPanelFullscreen, setTaskPanelFullscreen] = useState(false);
  const [taskPanelWidth, setTaskPanelWidth] = useState(readTaskPanelWidth);
  const [activityWorkspaceLayoutMode, setActivityWorkspaceLayoutMode] =
    useState<ActivityWorkspaceLayoutMode>("feed-only");
  /** Feed column (scroll body) width — drives message-nav, not feed program mode. */
  const [feedColumnWidth, setFeedColumnWidth] = useState(0);
  const [activityMessageNavSpaceVisible, setActivityMessageNavSpaceVisible] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const taskPanelAnimationControls = useAnimationControls();
  const taskPanelResizeRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
  const pendingTaskPanelTabCloseRef = useRef<TaskPanelActiveTab | undefined>(undefined);
  const taskPanelCloseRequestRef = useRef(0);
  const taskPanelClosingRef = useRef(false);
  const taskDrawerOpenRef = useRef(false);
  taskDrawerOpenRef.current = taskDrawerOpen;
  const taskPanelActiveTabRef = useRef(taskPanelActiveTab);
  taskPanelActiveTabRef.current = taskPanelActiveTab;
  const taskPanelUiByThreadRef = useRef<Record<string, TaskPanelSessionUiState>>({});
  const taskPanelUiThreadIdRef = useRef<string | undefined>(undefined);
  const liveTaskPanelUiRef = useRef<TaskPanelSessionUiState>(emptyTaskPanelSessionUiState());
  const refreshReviewDiffRef = useRef<() => Promise<void>>(async () => undefined);
  const [reviewDiff, setReviewDiff] = useState<WorkspaceDiffResult>();
  const [reviewDiffLoading, setReviewDiffLoading] = useState(false);
  const [reviewDiffError, setReviewDiffError] = useState<string>();
  const [reviewSelectedPath, setReviewSelectedPath] = useState<string>();
  const reviewDiffRequestRef = useRef(0);
  const [fileTarget, setFileTarget] = useState<
    (WorkspaceFileReference & { requestId: number; restricted?: boolean }) | undefined
  >();
  liveTaskPanelUiRef.current = captureTaskPanelSessionUiState({
    open: taskDrawerOpen && !taskPanelExiting && !taskPanelClosingRef.current,
    activeTab: taskPanelActiveTab,
    openTabIds: openTaskPanelTabIds,
    fullscreen: taskPanelFullscreen,
    ...(selectedSubagentAgentId ? { selectedSubagentAgentId } : {}),
    ...(fileTarget ? { fileTarget } : {}),
  });
  const fileReferenceRequestIdRef = useRef(0);
  const [scriptsBusy, setScriptsBusy] = useState(false);
  const [injectedTerminalSessionId, setInjectedTerminalSessionId] = useState<string | null>(null);
  const packageScriptByTerminalSessionRef = useRef(
    new Map<string, { command: string; projectName: string }>(),
  );
  const packageScriptTaskByTerminalSessionRef = useRef(new Map<string, string>());
  const settledPackageScriptTerminalSessionRef = useRef(new Map<string, boolean>());
  const [terminalSessionPresentations, setTerminalSessionPresentations] = useState<
    Record<string, TerminalSessionPresentation>
  >({});
  const [terminalLifecycleEpoch, setTerminalLifecycleEpoch] = useState(0);
  const [routePricingHints, setRoutePricingHints] = useState<RoutePricingHint[]>([]);

  useEffect(() => {
    if (!window.eco?.getCoreAvailability) {
      return;
    }
    void window.eco.getCoreAvailability().then(setCoreAvailability).catch((error) => {
      console.error("Failed to probe Core availability", error);
    });
  }, []);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(
    () =>
      subscribeToWindowFocus((focused) => {
        if (!focused) {
          return;
        }
        const activeThreadId = selectedThreadIdRef.current;
        if (!activeThreadId) {
          return;
        }
        setUnreadThreadIds((current) => {
          if (!current.has(activeThreadId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(activeThreadId);
          window.localStorage.setItem(unreadThreadsStorageKey, JSON.stringify([...next]));
          return next;
        });
      }),
    [],
  );

  useEffect(() => {
    if (!window.eco) {
      setError("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
      return undefined;
    }
    const eco = window.eco;

    const initializationPromise = Promise.all([
      eco.getCurrentWorkspace(),
      eco.getHomeProjectPath(),
      eco.listThreads(),
      eco.getModelSettings(),
      eco.getMcpSettings(),
      eco.getWorkflowSettings(),
      eco.getCenterServerSettings(),
      eco.getProxyBridgeSettings(),
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
        setNewThreadCoreKind(workflow.defaultCoreKind ?? "claude");
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
        void window.eco.getThreadRunProjection({ threadId, mode: "feed" }).then((projection) => {
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

    const openPendingNotificationThread = async (requestedThreadId?: string) => {
      const pendingThreadId = await eco.consumePendingThreadOpen();
      const threadId = requestedThreadId?.trim() || pendingThreadId;
      if (!threadId) {
        return;
      }
      const thread = await eco.getThread(threadId);
      if (!thread) {
        return;
      }
      setThreads((current) => {
        const existingIndex = current.findIndex((item) => item.id === thread.id);
        if (existingIndex < 0) {
          return [thread, ...current];
        }
        const next = [...current];
        next[existingIndex] = thread;
        return next;
      });
      setUnreadThreadIds((current) => {
        if (!current.has(thread.id)) {
          return current;
        }
        const next = new Set(current);
        next.delete(thread.id);
        window.localStorage.setItem(unreadThreadsStorageKey, JSON.stringify([...next]));
        return next;
      });
      selectedThreadIdRef.current = thread.id;
      setSelectedThreadId(thread.id);
      setSelectedProjectPath(thread.workspacePath);
      setSettingsOpen(false);
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
      setExpandedProjectThreadPaths((current) => {
        if (current.has(thread.workspacePath)) {
          return current;
        }
        const next = new Set(current);
        next.add(thread.workspacePath);
        return next;
      });
      setSidebarRevealTarget((current) => ({
        kind: "thread",
        id: thread.id,
        requestId: (current?.requestId ?? 0) + 1,
      }));
    };
    const unsubscribeThreadOpen = window.eco.onThreadOpenRequested((requestedThreadId) => {
      void initializationPromise.then(() => openPendingNotificationThread(requestedThreadId));
    });
    void initializationPromise.then(() => openPendingNotificationThread());

    const unsubscribe = window.eco.onThreadEvent((event) => {
      if (!isThreadLiveEvent(event) || event.threadId === "settings") {
        return;
      }

      ensureThreadListed(event.threadId);

      if (event.type === "thread.local_stream_updated" && event.localStream) {
        publishLocalStreamUpdate(event.localStream);
        return;
      }

      if (event.type === "thread.deleted") {
        clearLocalStreamUpdates(event.threadId);
        clearThreadClientState(event.threadId);
        setTitleGeneratingThreadIds((current) => {
          if (!current.has(event.threadId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(event.threadId);
          return next;
        });
        return;
      }

      if (
        event.type === "thread.failed" ||
        event.type === "thread.execution_failed" ||
        event.type === "thread.cancelled" ||
        event.type === "thread.idle" ||
        event.type === "thread.blocked"
      ) {
        clearLocalStreamUpdates(event.threadId);
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

      if (event.titleGenerating !== undefined) {
        setTitleGeneratingThreadIds((current) => {
          const next = new Set(current);
          if (event.titleGenerating) {
            next.add(event.threadId);
          } else {
            next.delete(event.threadId);
          }
          return next;
        });
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
        showAppMessageErrorRef.current(t("thread.titleGenerationFailed"));
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

      if (event.type === "thread.plan_cleared") {
        const promoted = promotePendingPlanForThread(event.threadId);
        clearPendingPlanForThread(event.threadId);
        if (!promoted) {
          void fetchApprovedPlanForThread(event.threadId);
        }
      } else if (event.type === "thread.completed") {
        clearLocalStreamUpdates(event.threadId);
        clearPendingPlanForThread(event.threadId);
        const activelyViewed = isThreadActivelyViewed(
          selectedThreadIdRef.current,
          event.threadId,
          document.hasFocus(),
        );
        if (!activelyViewed) {
          setUnreadThreadIds((current) => {
            if (current.has(event.threadId)) {
              return current;
            }
            const next = new Set(current);
            next.add(event.threadId);
            window.localStorage.setItem(unreadThreadsStorageKey, JSON.stringify([...next]));
            return next;
          });
        }
        // Main process re-checks app preferences + OS permission before calling Electron Notification.
        reportDesktopNotification(
          window.eco!.showThreadCompletionNotification({
            threadId: event.threadId,
            activelyViewed,
          }),
          "task completion",
        );
      }

      if (event.plan && event.threadId) {
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

      if (event.runtimeConfig) {
        const runtimeConfig = event.runtimeConfig;
        setThreads((current) =>
          current.map((thread) => (thread.id === event.threadId ? { ...thread, runtimeConfig } : thread)),
        );
      }

      if (event.type.startsWith("clarification.")) {
        if (event.type === "clarification.requested" && event.clarification) {
          upsertPendingClarificationForThread(event.threadId, event.clarification);
          const activelyViewed = isThreadActivelyViewed(
            selectedThreadIdRef.current,
            event.threadId,
            document.hasFocus(),
          );
          reportDesktopNotification(
            window.eco!.showThreadClarificationNotification({
              threadId: event.threadId,
              activelyViewed,
            }),
            "clarification",
          );
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

      const approvalNotificationKind =
        event.type === "plan_approval.requested"
          ? "plan"
          : event.type === "bash_approval.requested"
            ? "bash"
            : undefined;
      if (approvalNotificationKind) {
        const activelyViewed = isThreadActivelyViewed(
          selectedThreadIdRef.current,
          event.threadId,
          document.hasFocus(),
        );
        reportDesktopNotification(
          window.eco!.showThreadApprovalNotification({
            threadId: event.threadId,
            kind: approvalNotificationKind,
            activelyViewed,
          }),
          `${approvalNotificationKind} approval`,
        );
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
      if (shouldClearPendingBashApproval(event.type)) {
        clearPendingBashApprovalForThread(event.threadId);
      }
      if (shouldClearPendingPlanApproval(event.type)) {
        clearPendingPlanForThread(event.threadId);
      }
      if (event.type === "plan_approval.approved") {
        if (event.planApproval) {
          rememberPlanApprovalForThread(event.threadId, event.planApproval);
        }
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
      unsubscribeThreadOpen();
    };
  }, []);

  const selectedThreadStatus = threads.find((thread) => thread.id === selectedThreadId)?.status;

  useEffect(() => {
    if (!selectedThreadId || !window.eco) {
      return;
    }

    let cancelled = false;

    if (typeof window.eco.getThreadRunProjection === "function") {
      void window.eco
        .getThreadRunProjection({ threadId: selectedThreadId, mode: "feed" })
        .then((projection) => {
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
      void Promise.all([
        window.eco.getPendingPlan(selectedThreadId),
        typeof window.eco.getApprovedPlan === "function"
          ? window.eco.getApprovedPlan(selectedThreadId)
          : Promise.resolve(undefined),
      ]).then(([plan, approvedPlan]) => {
        if (cancelled) {
          return;
        }
        if (plan) {
          upsertPendingPlanForThread(selectedThreadId, plan);
        } else {
          clearPendingPlanForThread(selectedThreadId);
          if (approvedPlan) {
            rememberApprovedPlanForThread(selectedThreadId, approvedPlan);
          } else {
            clearApprovedPlanForThread(selectedThreadId);
          }
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
    const saved = window.localStorage.getItem(unreadThreadsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        setUnreadThreadIds(new Set(parsed));
      }
    } catch {
      window.localStorage.removeItem(unreadThreadsStorageKey);
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
      merged.set(normalizeProjectPath(homeProjectPath), {
        path: homeProjectPath,
        name: HOME_PROJECT_DISPLAY_NAME,
        importedAt: HOME_PROJECT_IMPORTED_AT,
      });
    }
    for (const project of recentProjects) {
      if (homeProjectPath && isHomeProjectPath(project.path, homeProjectPath)) {
        continue;
      }
      merged.set(normalizeProjectPath(project.path), project);
    }
    if (workspace) {
      const workspacePathKey = normalizeProjectPath(workspace.path);
      const existing = merged.get(workspacePathKey);
      const workspaceName =
        homeProjectPath && isHomeProjectPath(workspace.path, homeProjectPath)
          ? HOME_PROJECT_DISPLAY_NAME
          : workspace.name;
      if (existing) {
        merged.set(workspacePathKey, { ...existing, name: workspaceName });
      }
    }
    for (const thread of threads) {
      const workspacePathKey = normalizeProjectPath(thread.workspacePath);
      if (!merged.has(workspacePathKey)) {
        const workspaceThreads = threads.filter((item) => item.workspacePath === thread.workspacePath);
        const importedAt = workspaceThreads.reduce(
          (earliest, item) => (item.createdAt < earliest ? item.createdAt : earliest),
          workspaceThreads[0]!.createdAt,
        );
        merged.set(workspacePathKey, {
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
      const projectPathKey = normalizeProjectPath(thread.workspacePath);
      const bucket = grouped.get(projectPathKey) ?? [];
      bucket.push(thread);
      grouped.set(projectPathKey, bucket);
    }
    for (const [path, projectThreads] of grouped) {
      grouped.set(path, sortThreadsForSidebar(projectThreads, pinnedThreadIds));
    }
    return grouped;
  }, [pinnedThreadIds, threads]);

  const projectTree = useMemo(
    () =>
      projects.map((project) => {
        const projectThreads = threadsByProject.get(normalizeProjectPath(project.path)) ?? [];
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
  const sidebarSearchThreads = useMemo(
    () => projectTree.flatMap((item) => item.projectThreads),
    [projectTree],
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
      return t("nav.projectFallback");
    }
    const project = projects.find((item) => item.path === currentProjectPath);
    return project?.name ?? pathToName(currentProjectPath);
  }, [currentProjectPath, projects, t]);
  const gitStatus = currentProjectPath
    ? gitStatusByWorkspace[currentProjectPath]?.status
    : undefined;
  const gitStatusLoading = currentProjectPath
    ? gitStatusLoadingByWorkspace[currentProjectPath] === true
    : false;
  const currentTerminalState = useMemo(() => {
    if (!currentProjectPath) {
      return undefined;
    }
    return getProjectTerminalState(terminalByProject, currentProjectPath);
  }, [currentProjectPath, terminalByProject]);
  const activeThread = useMemo(
    () => (selectedThreadId ? threads.find((thread) => thread.id === selectedThreadId) : undefined),
    [selectedThreadId, threads],
  );
  useEffect(() => {
    if (!selectedThreadId || !window.eco?.listImageGenerationArtifacts) return;
    let cancelled = false;
    void window.eco.listImageGenerationArtifacts(selectedThreadId).then((artifacts) => {
      if (!cancelled) {
        setImageArtifactsByThread((current) => ({ ...current, [selectedThreadId]: artifacts }));
      }
    }).catch((caught) => {
      if (!cancelled) setError(errorMessage(caught));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    if (!window.eco?.onImageGenerationArtifactChanged) return;
    return window.eco.onImageGenerationArtifactChanged((artifact) => {
      setImageArtifactsByThread((current) => {
        const existing = current[artifact.threadId] ?? [];
        const next = [artifact, ...existing.filter((item) => item.id !== artifact.id)].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        return { ...current, [artifact.threadId]: next };
      });
    });
  }, []);
  const workspacePanelResponsiveDefaultOpen = Boolean(
    activeThread && shouldAutoOpenWorkspacePanel(activityWorkspaceLayoutMode),
  );
  const workspacePanelManualOpen =
    workspacePanelManualOverride?.layoutMode === activityWorkspaceLayoutMode &&
    workspacePanelManualOverride.projectPath === currentProjectPath &&
    workspacePanelManualOverride.threadId === activeThread?.id
      ? workspacePanelManualOverride.open
      : undefined;
  const workspacePanelResolvedOpen = workspacePanelManualOpen ?? workspacePanelResponsiveDefaultOpen;
  useLayoutEffect(() => {
    setWorkspacePanelManualOverride(undefined);
  }, [activityWorkspaceLayoutMode, currentProjectPath, activeThread?.id]);
  useEffect(() => {
    reviewDiffRequestRef.current += 1;
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
    setWorkspacePanelManualOverride({
      layoutMode: activityWorkspaceLayoutMode,
      projectPath: currentProjectPath,
      threadId: activeThread?.id,
      open: !workspacePanelResolvedOpen,
    });
  }, [activeThread?.id, activityWorkspaceLayoutMode, currentProjectPath, workspacePanelResolvedOpen]);
  const pendingPlan = activeThread ? pendingPlansByThread[activeThread.id] : undefined;
  const approvedPlan = activeThread ? approvedPlansByThread[activeThread.id] : undefined;
  const taskPanelPlan = pendingPlan ?? approvedPlan;
  const pendingClarification = activeThread ? pendingClarificationsByThread[activeThread.id] : undefined;
  const pendingBashApproval = activeThread ? pendingBashApprovalsByThread[activeThread.id] : undefined;
  const attentionItems = buildSidebarAttentionItems({
    threads,
    unreadThreadIds,
    pendingPlansByThread,
    pendingBashApprovalsByThread,
  });

  useEffect(() => {
    pendingPlansByThreadRef.current = pendingPlansByThread;
  }, [pendingPlansByThread]);

  function upsertPendingPlanForThread(threadId: string, plan: ThreadPendingPlan) {
    setPendingPlansByThread((current) => ({ ...current, [threadId]: plan }));
    clearApprovedPlanForThread(threadId);
  }

  function rememberApprovedPlanForThread(threadId: string, plan: ThreadPendingPlan) {
    setApprovedPlansByThread((current) => ({ ...current, [threadId]: plan }));
  }

  function clearApprovedPlanForThread(threadId: string) {
    setApprovedPlansByThread((current) => removeRecordKey(current, threadId));
  }

  async function fetchApprovedPlanForThread(threadId: string) {
    if (typeof window.eco?.getApprovedPlan !== "function") {
      return;
    }
    const plan = await window.eco.getApprovedPlan(threadId);
    if (plan) {
      rememberApprovedPlanForThread(threadId, plan);
    }
  }

  function rememberPlanApprovalForThread(
    threadId: string,
    plan: Pick<ThreadPendingPlan, "analysis" | "plan" | "userPrompt" | "planFilePath">,
  ) {
    rememberApprovedPlanForThread(threadId, {
      threadId,
      userPrompt: plan.userPrompt,
      analysis: plan.analysis,
      plan: plan.plan,
      workspacePath: "",
      worktreePath: "",
      ...(plan.planFilePath ? { planFilePath: plan.planFilePath } : {}),
    });
  }

  function promotePendingPlanForThread(threadId: string): boolean {
    const plan = pendingPlansByThreadRef.current[threadId];
    if (plan) {
      rememberApprovedPlanForThread(threadId, plan);
      return true;
    }
    return false;
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
  const composerContextKeyRef = useRef(composerContextKey);
  const composerPromptRef = useRef(prompt);
  const composerAttachmentsRef = useRef(composerAttachments);
  const composerRewindTargetRef = useRef(composerRewindTarget);
  const composerDraftLoadRequestRef = useRef(0);
  const composerDraftSaveTimerRef = useRef<{ key: string; timer: number } | undefined>(undefined);
  composerContextKeyRef.current = composerContextKey;
  composerPromptRef.current = prompt;
  composerAttachmentsRef.current = composerAttachments;
  composerRewindTargetRef.current = composerRewindTarget;
  useEffect(() => {
    saveTerminalWorkspaceState(terminalByProject);
  }, [terminalByProject]);
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

  const storeGitStatus = useCallback(
    (workspacePath: string, status: GitWorkingTreeStatus) => {
      setGitStatusByWorkspace((current) => {
        const next = cacheWorkspaceGitStatus(current, workspacePath, status, Date.now());
        gitStatusByWorkspaceRef.current = next;
        return next;
      });
    },
    [],
  );

  const refreshGitStatus = useCallback(
    async (workspacePath?: string, options: { force?: boolean } = {}) => {
      const path = workspacePath ?? currentProjectPath;
      if (!path || !window.eco) {
        return;
      }
      if (
        !shouldRefreshWorkspaceGitStatus(
          gitStatusByWorkspaceRef.current,
          path,
          Date.now(),
          options.force,
        )
      ) {
        return;
      }
      const requestId = (gitStatusRequestRef.current.get(path) ?? 0) + 1;
      gitStatusRequestRef.current.set(path, requestId);
      setGitStatusLoadingByWorkspace((current) => ({ ...current, [path]: true }));
      try {
        const status = await window.eco.getGitStatus(path);
        if (requestId === gitStatusRequestRef.current.get(path)) {
          storeGitStatus(path, status);
        }
      } catch {
      } finally {
        if (requestId === gitStatusRequestRef.current.get(path)) {
          setGitStatusLoadingByWorkspace((current) => ({ ...current, [path]: false }));
        }
      }
    },
    [currentProjectPath, storeGitStatus],
  );

  useEffect(() => {
    void refreshGitStatus();
  }, [currentProjectPath, activeThread?.id, refreshGitStatus]);

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
      void refreshGitStatus(currentProjectPath, { force: true });
    }
  }, [threads, currentProjectPath, refreshGitStatus, refreshPackageScripts]);

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

  const trackPackageScriptTerminalSession = useCallback(
    (
      sessionId: string,
      meta: { command: string; projectName: string },
      taskId?: string,
    ) => {
      if (!settledPackageScriptTerminalSessionRef.current.has(sessionId)) {
        packageScriptByTerminalSessionRef.current.set(sessionId, meta);
      }
      if (taskId) {
        packageScriptTaskByTerminalSessionRef.current.set(sessionId, taskId);
      }
    },
    [],
  );

  const settlePackageScriptTerminalSession = useCallback(
    (sessionId: string, exitCode?: number): boolean | undefined => {
      const settledResult = settledPackageScriptTerminalSessionRef.current.get(sessionId);
      if (settledResult !== undefined) {
        return settledResult;
      }
      const meta = packageScriptByTerminalSessionRef.current.get(sessionId);
      if (!meta) {
        return undefined;
      }
      packageScriptByTerminalSessionRef.current.delete(sessionId);
      const succeeded = exitCode === 0;
      settledPackageScriptTerminalSessionRef.current.set(sessionId, succeeded);
      if (settledPackageScriptTerminalSessionRef.current.size > 100) {
        const oldestSessionId = settledPackageScriptTerminalSessionRef.current.keys().next().value;
        if (oldestSessionId) {
          settledPackageScriptTerminalSessionRef.current.delete(oldestSessionId);
        }
      }
      if (succeeded) {
        showAppMessageSuccessRef.current(
          t("app.scriptSucceeded", { project: meta.projectName, command: meta.command }),
        );
      } else {
        const exitCodeDetail =
          exitCode === undefined ? "" : t("app.exitCode", { code: exitCode });
        showAppMessageErrorRef.current(
          t("app.scriptFailed", {
            project: meta.projectName,
            command: meta.command,
            detail: exitCodeDetail,
          }),
        );
      }
      return succeeded;
    },
    [],
  );

  const syncPackageScriptTerminalPresentation = useCallback(
    async (sessionId: string, taskId?: string) => {
      const resolvedTaskId = taskId ?? packageScriptTaskByTerminalSessionRef.current.get(sessionId);
      if (!resolvedTaskId || !window.eco?.openBackgroundTerminalTask) {
        return;
      }
      try {
        const task = await window.eco.openBackgroundTerminalTask({ taskId: resolvedTaskId });
        const isSettled =
          task.status === "exited" ||
          task.status === "failed" ||
          task.status === "stopped";
        setTerminalSessionPresentations((current) => ({
          ...current,
          [sessionId]: {
            ...(task.output !== undefined && { initialOutput: task.output }),
            ...(isSettled && { exitCode: task.exitCode ?? (task.status === "exited" ? 0 : 1) }),
          },
        }));
        if (isSettled) {
          settlePackageScriptTerminalSession(
            sessionId,
            task.exitCode ?? (task.status === "exited" ? 0 : 1),
          );
        }
      } catch {
        // The live terminal event path still handles sessions whose task snapshot is unavailable.
      }
    },
    [settlePackageScriptTerminalSession],
  );

  useEffect(() => {
    if (!window.eco?.onTerminalEvent) {
      return undefined;
    }
    return window.eco.onTerminalEvent((event) => {
      if (event.type === "exit") {
        settlePackageScriptTerminalSession(event.sessionId, event.exitCode);
        void syncPackageScriptTerminalPresentation(event.sessionId);
      } else if (event.type === "error") {
        settlePackageScriptTerminalSession(event.sessionId);
        void syncPackageScriptTerminalPresentation(event.sessionId);
      }
      if (event.type === "started" || event.type === "exit" || event.type === "error") {
        void refreshBackgroundTerminalTasks();
      }
      if (event.type === "exit" || event.type === "error") {
        setTerminalLifecycleEpoch((epoch) => epoch + 1);
      }
    });
  }, [
    refreshBackgroundTerminalTasks,
    settlePackageScriptTerminalSession,
    syncPackageScriptTerminalPresentation,
  ]);

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

  const handleTerminalSessionExit = useCallback(
    (sessionId: string, exitCode: number) => {
      const isPackageScript =
        packageScriptByTerminalSessionRef.current.has(sessionId) ||
        settledPackageScriptTerminalSessionRef.current.has(sessionId) ||
        packageScriptTaskByTerminalSessionRef.current.has(sessionId);
      settlePackageScriptTerminalSession(sessionId, exitCode);
      void syncPackageScriptTerminalPresentation(sessionId);
      return !isPackageScript;
    },
    [settlePackageScriptTerminalSession, syncPackageScriptTerminalPresentation],
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
    async (
      workspacePath: string,
      sessionId: string,
      scriptMeta: { command: string; projectName: string },
      taskId?: string,
    ) => {
      trackPackageScriptTerminalSession(sessionId, scriptMeta, taskId);
      const dismissStartedAt = performance.now();
      dismissPackageScriptRunOverlays();
      void refreshBackgroundTerminalTasks();
      await waitForOverlayDismiss(dismissStartedAt);
      openPackageScriptTerminalSession(workspacePath, sessionId);
      void syncPackageScriptTerminalPresentation(sessionId, taskId);
    },
    [
      dismissPackageScriptRunOverlays,
      openPackageScriptTerminalSession,
      refreshBackgroundTerminalTasks,
      syncPackageScriptTerminalPresentation,
      trackPackageScriptTerminalSession,
    ],
  );

  useEffect(() => {
    if (!window.eco?.onPackageScriptTerminalLaunch) {
      return undefined;
    }
    return window.eco.onPackageScriptTerminalLaunch((payload) => {
      const projectName =
        projects.find((item) => item.path === payload.workspacePath)?.name ??
        pathToName(payload.workspacePath);
      const scriptMeta = {
        command: payload.command.length > 0 ? payload.command.join(" ") : payload.script,
        projectName,
      };
      trackPackageScriptTerminalSession(payload.sessionId, scriptMeta, payload.taskId);
      if (!currentProjectPath || payload.workspacePath !== currentProjectPath) {
        return;
      }
      void presentPackageScriptTerminal(
        payload.workspacePath,
        payload.sessionId,
        scriptMeta,
        payload.taskId,
      );
    });
  }, [currentProjectPath, presentPackageScriptTerminal, projects, trackPackageScriptTerminalSession]);

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
        const scriptMeta = {
          command: result.command.length > 0 ? result.command.join(" ") : result.script,
          projectName: currentProjectName,
        };
        trackPackageScriptTerminalSession(result.sessionId, scriptMeta, result.taskId);
        void refreshBackgroundTerminalTasks();
        await waitForOverlayDismiss(dismissStartedAt);
        openPackageScriptTerminalSession(currentProjectPath, result.sessionId);
        void syncPackageScriptTerminalPresentation(result.sessionId, result.taskId);
      } catch (error) {
        console.error(error);
      } finally {
        setScriptsBusy(false);
      }
    },
    [
      activeThread?.id,
      currentProjectName,
      currentProjectPath,
      dismissPackageScriptRunOverlays,
      openPackageScriptTerminalSession,
      refreshBackgroundTerminalTasks,
      syncPackageScriptTerminalPresentation,
      trackPackageScriptTerminalSession,
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
        void refreshGitStatus(workspacePath, { force: true });
      }
    });
  }, [currentProjectPath, refreshGitStatus]);

  useEffect(() => {
    if (!window.eco) {
      return;
    }
    void window.eco.getGitSettings().then(setGitSettings);
    void window.eco.getPersonalizationSettings().then(setPersonalizationSettings);
    void window.eco.getBrowserSettings?.().then(setBrowserSettings);
    void window.eco.getImageGenerationSettings?.().then(setImageGenerationSettings);
    void window.eco.getIntegrationAvailability?.().then(setIntegrationAvailability);
    void window.eco.getWebChatList?.().then(setWebChatList);
    void window.eco.getNotificationSettings?.().then(setNotificationSettings);
    void window.eco.getBrowserState?.().then(setBrowserViewState);
    asrBusyRef.current = true;
    setAsrBusy(true);
    void window.eco
      .listAsrProfiles()
      .then((snapshot) => {
        setAsrProfiles(snapshot);
        setAsrSettingsLoadError(undefined);
      })
      .catch((caught: unknown) => {
        setAsrSettingsLoadError(caught instanceof Error ? caught.message : "");
      })
      .finally(() => {
        asrBusyRef.current = false;
        setAsrBusy(false);
      });
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
    if (!window.eco || !currentProjectPath) {
      setProjectMcpSettings(undefined);
      setProjectIntegrationsSettings(undefined);
      setProjectOrchestrationSettings(undefined);
      setProjectSkillsSettings(undefined);
      return;
    }
    let cancelled = false;
    setProjectMcpSettings(undefined);
    setProjectIntegrationsSettings(undefined);
    setProjectOrchestrationSettings(undefined);
    void window.eco
      .getProjectMcpSettings(currentProjectPath)
      .then((snapshot) => {
        if (!cancelled) setProjectMcpSettings(snapshot);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    void window.eco
      .getProjectIntegrationsSettings(currentProjectPath)
      .then((snapshot) => {
        if (!cancelled) setProjectIntegrationsSettings(snapshot);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    void window.eco
      .getProjectOrchestrationSettings(currentProjectPath)
      .then((snapshot) => {
        if (!cancelled) setProjectOrchestrationSettings(snapshot);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    void window.eco
      .getProjectSkillsSettings(currentProjectPath)
      .then((snapshot) => {
        if (!cancelled) setProjectSkillsSettings(snapshot);
      })
      .catch((caught) => {
        if (!cancelled) setError(errorMessage(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectPath]);

  useEffect(() => {
    if (activeThread) {
      setComposerRoutePopoverOpen(false);
    }
  }, [activeThread?.id, currentProjectPath]);

  const composerCoreKind = activeThread?.coreKind ?? newThreadCoreKind;
  const effectiveDefaultOrchestrationSelection = workflowSettings.defaultOrchestrationSelection;
  const projectOrchestrationSelection =
    projectOrchestrationSettings?.workspacePath === currentProjectPath
      ? projectOrchestrationSettings?.orchestrationSelection
      : undefined;
  const composerAvailableSkills = useMemo(() => {
    const projectSkills = skillsSnapshot?.projectSkills ?? [];
    const userSkills = skillsSnapshot?.userSkills ?? [];
    const candidates = composerCoreKind === "codex"
      ? [...projectSkills, ...userSkills].filter((skill) => isSkillAvailableForCore(skill, composerCoreKind))
      : [
          ...listSdkReadyProjectSkills(projectSkills),
          ...dedupeSkillsByName(userSkills.filter((skill) => isSkillAvailableForCore(skill, composerCoreKind))),
        ];
    return [...new Map(candidates.map((skill) => [skill.settingsKey ?? skill.skillFilePath, skill])).values()];
  }, [composerCoreKind, skillsSnapshot?.projectSkills, skillsSnapshot?.userSkills]);
  const composerSkillsEnabled = useMemo(
    () =>
      deriveSkillsEnabled(composerAvailableSkills, {
        ...(activeThread && composerRuntimeConfig?.skillsEnabled
          ? { existing: composerRuntimeConfig.skillsEnabled }
          : {}),
        ...(projectSkillsSettings?.enabledByPath
          ? { remembered: projectSkillsSettings.enabledByPath }
          : {}),
      }),
    [
      activeThread?.id,
      composerAvailableSkills,
      composerRuntimeConfig?.skillsEnabled,
      projectSkillsSettings?.enabledByPath,
    ],
  );
  const slashPickerSkills = useMemo(
    () =>
      dedupeSkillsByName(
        composerAvailableSkills.filter(
          (skill) => composerSkillsEnabled[skill.settingsKey ?? skill.skillFilePath],
        ),
      ),
    [composerAvailableSkills, composerSkillsEnabled],
  );
  const composerSupportsSkills = true;
  const projectAgentsOnly = useMemo(
    () => composerCoreKind === "claude"
      ? (skillsSnapshot?.agentsOnlySkills ?? []).filter((skill) => skill.source === "project")
      : [],
    [composerCoreKind, skillsSnapshot?.agentsOnlySkills],
  );
  const projectCoreSkills = useMemo(
    () => composerAvailableSkills.filter((skill) => skill.source === "project"),
    [composerAvailableSkills],
  );
  const showProjectSkillsPanel =
    Boolean(currentProjectPath) &&
    (isLoadingSkills || projectCoreSkills.length > 0 || projectAgentsOnly.length > 0);
  const composerSkillSlash = useMemo(() => parseSlashQuery(prompt, composerCursor), [prompt, composerCursor]);
  const referencedSkillNames = useMemo(() => new Set(parseExplicitSkillNames(prompt)), [prompt]);
  const composerSkillMatches = useMemo(() => {
    if (!composerSkillSlash) {
      return [];
    }
    return filterSkillsForSlash(composerSkillSlash.query, slashPickerSkills, referencedSkillNames);
  }, [composerSkillSlash, slashPickerSkills, referencedSkillNames]);
  const composerSkillPopoverOpen =
    composerSupportsSkills && Boolean(composerSkillSlash) && slashPickerSkills.length > 0;

  useEffect(() => {
    setComposerSkillActiveIndex(Math.max(0, composerSkillMatches.length - 1));
  }, [composerSkillSlash?.query, composerSkillSlash?.start, composerSkillMatches.length]);

  const buildComposerDefaultConfig = useCallback(
    (options?: {
      planModeOverride?: boolean;
      workflowDefaults?: WorkflowSettingsSnapshot;
      orchestrationSelection?: OrchestrationSelection;
    }): ThreadRuntimeConfig | undefined => {
      if (settings.mainAgentConfigs.length === 0) {
        return undefined;
      }
      try {
        const defaults = options?.workflowDefaults ?? workflowSettings;
        if (
          currentProjectPath &&
          projectOrchestrationSettings?.workspacePath !== currentProjectPath
        ) {
          return undefined;
        }
        const projectMcpServersEnabled =
          projectMcpSettings?.workspacePath === currentProjectPath
            ? projectMcpSettings?.enabledByServer
            : undefined;
        const rememberedMcpServersEnabled =
          projectMcpServersEnabled && Object.keys(projectMcpServersEnabled).length > 0
            ? projectMcpServersEnabled
            : defaults.mcpServersEnabled;
        const rememberedIntegrationsEnabled =
          projectIntegrationsSettings &&
          projectIntegrationsSettings.workspacePath === currentProjectPath
            ? projectIntegrationsSettings.enabled
            : defaults.integrationsEnabled;
        const orchestrationSelection =
          options?.orchestrationSelection ??
          projectOrchestrationSelection ??
          defaults.defaultOrchestrationSelection;
        if (!hasCompleteOrchestrationSelection(orchestrationSelection)) {
          return undefined;
        }
        const workflowDefaults =
          options?.planModeOverride === undefined
            ? {
                ...defaults,
                ...(rememberedMcpServersEnabled
                  ? { mcpServersEnabled: rememberedMcpServersEnabled }
                  : {}),
                ...(rememberedIntegrationsEnabled
                  ? { integrationsEnabled: rememberedIntegrationsEnabled }
                  : {}),
              }
            : {
                ...defaults,
                sessionMode: options.planModeOverride ? ("plan" as const) : ("agent" as const),
                ...(rememberedMcpServersEnabled
                  ? { mcpServersEnabled: rememberedMcpServersEnabled }
                  : {}),
                ...(rememberedIntegrationsEnabled
                  ? { integrationsEnabled: rememberedIntegrationsEnabled }
                  : {}),
              };
        return buildThreadRuntimeConfigFromDefaults({
          settings,
          workflowDefaults,
          mcpServers: mcpSettings.servers,
          orchestrationSelection,
        });
      } catch {
        return undefined;
      }
    },
    [
      settings,
      workflowSettings,
      mcpSettings.servers,
      currentProjectPath,
      projectMcpSettings,
      projectIntegrationsSettings,
      projectOrchestrationSelection,
      projectOrchestrationSettings?.workspacePath,
    ],
  );

  const resetComposerDefaultConfig = useCallback(() => {
    setComposerRuntimeConfig(buildComposerDefaultConfig() ?? null);
  }, [buildComposerDefaultConfig]);

  useEffect(() => {
    if (activeThread?.runtimeConfig) {
      setComposerRuntimeConfig((current) => {
        const next = activeThread.runtimeConfig!;
        return current && threadRuntimeConfigsEquivalent(current, next) ? current : next;
      });
      return;
    }
    if (settings.mainAgentConfigs.length === 0) {
      setComposerRuntimeConfig((current) => (current ? null : current));
      return;
    }
    setComposerRuntimeConfig((current) => {
      if (current?.orchestrationSelection && hasCompleteOrchestrationSelection(current.orchestrationSelection)) {
        try {
          const refreshed = materializeThreadOrchestrationSnapshot(
            settings,
            current.orchestrationSelection,
          );
          const next: ThreadRuntimeConfig = {
            ...current,
            ...refreshed,
            subagentEnabled: deriveSubagentEnabledFromSnapshot(
              refreshed.resolvedOrchestrationSnapshot!,
              current.subagentEnabled,
            ),
          };
          return threadRuntimeConfigsEquivalent(current, next) ? current : next;
        } catch {
          return current;
        }
      }
      const defaults = buildComposerDefaultConfig();
      if (!defaults) {
        return current;
      }
      return current && threadRuntimeConfigsEquivalent(current, defaults) ? current : defaults;
    });
  }, [
    activeThread?.id,
    activeThread?.runtimeConfig,
    buildComposerDefaultConfig,
    settings.mainAgentConfigs,
    settings.mainAgentPrompts,
    settings.subagentOrchestrations,
  ]);

  const selectedOrchestrationSnapshot = useMemo(
    () =>
      composerRuntimeConfig
        ? resolveThreadOrchestrationSnapshot(settings, composerRuntimeConfig)
        : undefined,
    [settings, composerRuntimeConfig],
  );
  const composerMcpSettings = useMemo(() => {
    const availableServerKeys = listEnabledGlobalMcpServerKeys(mcpSettings.servers);
    if (availableServerKeys.length === 0) {
      return {};
    }
    const projectMcpServersEnabled =
      projectMcpSettings?.workspacePath === currentProjectPath
        ? projectMcpSettings?.enabledByServer
        : undefined;
    const projectRemembered =
      projectMcpServersEnabled && Object.keys(projectMcpServersEnabled).length > 0
        ? projectMcpServersEnabled
        : workflowSettings.mcpServersEnabled;
    return deriveMcpServersEnabled(availableServerKeys, {
      ...(composerRuntimeConfig?.mcpServersEnabled
        ? { existing: composerRuntimeConfig.mcpServersEnabled }
        : {}),
      ...(projectRemembered ? { remembered: projectRemembered } : {}),
    });
  }, [
    composerRuntimeConfig?.mcpServersEnabled,
    currentProjectPath,
    mcpSettings.servers,
    projectMcpSettings,
    workflowSettings.mcpServersEnabled,
  ]);
  const composerIntegrationSettings = useMemo(
    () =>
      composerRuntimeConfig?.integrationsEnabled ??
      (projectIntegrationsSettings &&
      projectIntegrationsSettings.workspacePath === currentProjectPath
        ? projectIntegrationsSettings.enabled
        : workflowSettings.integrationsEnabled) ??
      {},
    [
      composerRuntimeConfig?.integrationsEnabled,
      currentProjectPath,
      projectIntegrationsSettings,
      workflowSettings.integrationsEnabled,
    ],
  );
  const effectiveComposerRuntimeConfig = useMemo(
    () =>
      composerRuntimeConfig
        ? {
            ...composerRuntimeConfig,
            ...(Object.keys(composerSkillsEnabled).length > 0
              ? { skillsEnabled: composerSkillsEnabled }
              : {}),
            ...(Object.keys(composerMcpSettings).length > 0
              ? { mcpServersEnabled: composerMcpSettings }
              : {}),
            integrationsEnabled: composerIntegrationSettings,
          }
        : null,
    [composerRuntimeConfig, composerIntegrationSettings, composerMcpSettings, composerSkillsEnabled],
  );
  const resolveComposerRuntimeConfigForSend = useCallback((): ThreadRuntimeConfig | null => {
    const base = effectiveComposerRuntimeConfig ?? composerRuntimeConfig;
    const sessionSelection =
      base?.orchestrationSelection &&
      hasCompleteOrchestrationSelection(base.orchestrationSelection)
        ? base.orchestrationSelection
        : undefined;
    const selection = activeThread
      ? sessionSelection
      : sessionSelection ??
        (hasCompleteOrchestrationSelection(projectOrchestrationSelection)
          ? projectOrchestrationSelection
          : undefined) ??
        (hasCompleteOrchestrationSelection(workflowSettings.defaultOrchestrationSelection)
          ? workflowSettings.defaultOrchestrationSelection
          : undefined);
    if (!hasCompleteOrchestrationSelection(selection)) {
      return null;
    }
    try {
      const materialized = materializeThreadOrchestrationSnapshot(settings, selection);
      const shell =
        base ??
        buildThreadRuntimeConfigFromDefaults({
          settings,
          workflowDefaults: workflowSettings,
          orchestrationSelection: selection,
          mcpServers: mcpSettings.servers,
        });
      return {
        ...shell,
        ...materialized,
        ...(base?.mainAgentModelOverride ? { mainAgentModelOverride: base.mainAgentModelOverride } : {}),
        ...(base?.mainAgentSystemPromptPresetOverride
          ? { mainAgentSystemPromptPresetOverride: base.mainAgentSystemPromptPresetOverride }
          : {}),
        ...(effectiveComposerRuntimeConfig?.mcpServersEnabled
          ? { mcpServersEnabled: effectiveComposerRuntimeConfig.mcpServersEnabled }
          : {}),
        ...(effectiveComposerRuntimeConfig?.skillsEnabled
          ? { skillsEnabled: effectiveComposerRuntimeConfig.skillsEnabled }
          : {}),
        subagentEnabled: deriveSubagentEnabledFromSnapshot(
          materialized.resolvedOrchestrationSnapshot!,
          base?.subagentEnabled ?? shell.subagentEnabled,
        ),
        sessionMode: base?.sessionMode ?? shell.sessionMode,
        bashReviewMode: base?.bashReviewMode ?? shell.bashReviewMode,
      };
    } catch {
      return null;
    }
  }, [
    composerRuntimeConfig,
    effectiveComposerRuntimeConfig,
    activeThread,
    mcpSettings.servers,
    settings,
    workflowSettings,
    projectOrchestrationSelection,
  ]);
  const templateMainModel = useMemo<ComposerModelOption | undefined>(() => {
    if (!selectedOrchestrationSnapshot) {
      return undefined;
    }
    const route = runtimeRoleRoutesFromOrchestrationSnapshot(selectedOrchestrationSnapshot).find(
      (candidate) => candidate.role === "planner",
    );
    if (!route) {
      return undefined;
    }
    const provider = settings.providers.find((candidate) => candidate.id === route.providerId);
    return {
      providerId: route.providerId,
      providerName: provider?.name.trim() || route.providerId,
      modelId: route.modelId,
      ...(route.candidateModelId ? { candidateModelId: route.candidateModelId } : {}),
      ...(route.thinkingEffort ? { thinkingEffort: route.thinkingEffort } : {}),
    };
  }, [selectedOrchestrationSnapshot, settings.providers]);
  const composerModelProvider = templateMainModel
    ? settings.providers.find((provider) => provider.id === templateMainModel.providerId)
    : undefined;
  const composerModelProviderId = composerModelProvider?.enabled ? composerModelProvider.id : undefined;
  const composerMainAgentModelOverride = resolveMainAgentModelOverrideForProvider(
    templateMainModel?.providerId,
    composerRuntimeConfig?.mainAgentModelOverride,
  );
  const refreshComposerCandidateModels = useCallback(() => {
    setComposerModelsRefreshNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    const eco = window.eco;
    if (!eco || !composerModelProviderId) {
      setComposerCandidateModels([]);
      setComposerModelsError(undefined);
      setComposerModelsLoading(false);
      return;
    }
    let cancelled = false;
    setComposerModelsError(undefined);
    setComposerModelsLoading(true);
    void eco
      .listCandidateModels(composerModelProviderId)
      .then((candidates) => {
        if (!cancelled) {
          setComposerCandidateModels(candidates);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setComposerCandidateModels([]);
          setComposerModelsError(
            t("app.candidateModelsFailed", { detail: errorMessage(caught) }),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setComposerModelsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [composerModelProviderId, composerModelsRefreshNonce]);

  const composerModelOptions = useMemo<ComposerModelOption[]>(() => {
    return templateMainModel
      ? buildComposerModelOptions({
          provider: composerModelProvider,
          candidates: composerCandidateModels,
          templateModel: templateMainModel,
        })
      : [];
  }, [composerCandidateModels, composerModelProvider, templateMainModel]);
  const activeRoutes = useMemo(() => {
    return selectedOrchestrationSnapshot
      ? runtimeRoleRoutesFromOrchestrationSnapshot(
          selectedOrchestrationSnapshot,
          composerMainAgentModelOverride,
        )
      : [];
  }, [composerMainAgentModelOverride, selectedOrchestrationSnapshot]);

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
  const routesReady = selectedOrchestrationSnapshot
    ? isOrchestrationSnapshotReady(
        selectedOrchestrationSnapshot,
        providerById,
        composerMainAgentModelOverride,
      )
    : false;
  const composerModelAvailability = resolveComposerModelAvailability(
    settings.providers,
    templateMainModel,
  );
  const threadAcceptsInput = !activeThread || isContinuableThreadStatus(activeThread.status);
  const composerFollowUpMode = Boolean(
    activeThread && (isLiveFollowUpThreadStatus(activeThread.status) || editingFollowUpId),
  );
  const showBashApproval = Boolean(pendingBashApproval);
  const plannerSupportsImages =
    !plannerCapability?.capabilitiesResolved || plannerCapability.supportsImageInput;
  const canPasteComposerImages = plannerSupportsImages;
  const composerHasContent = Boolean(prompt.trim() || composerAttachments.length > 0);
  const persistedRunProjection = activeThread ? runProjectionByThread[activeThread.id] : undefined;
  const runProjection = useLocalStreamProjection(persistedRunProjection);
  const runProjectionRef = useRef(runProjection);
  runProjectionRef.current = runProjection;
  const activeFeedEarlier = activeThread ? feedEarlierByThread[activeThread.id] : undefined;
  const displayProjection = useMemo(() => {
    if (!runProjection) {
      return undefined;
    }
    if (!activeFeedEarlier?.timeline.length) {
      return runProjection;
    }
    return {
      ...runProjection,
      timeline: mergeFeedTimelineById(activeFeedEarlier.timeline, runProjection.timeline),
    };
  }, [activeFeedEarlier?.timeline, runProjection]);
  const contextCompactionInFlight = isThreadContextCompactionInFlight(runProjection);
  const autoCompactSuspended = isThreadAutoCompactSuspended(runProjection);
  const promptCacheInvalidated =
    promptCacheTipPreferences.enabled && isThreadPromptCacheInvalidated(runProjection);
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
  const composerPromptCacheOrchestrationLabel =
    composerPromptCacheDrift?.includes("orchestration") && composerRuntimeConfig
      ? resolvePromptCacheOrchestrationLabel(settings, composerRuntimeConfig)
      : undefined;
  const composerPromptCacheHint =
    promptCacheTipPreferences.enabled && composerPromptCacheDrift
      ? formatPromptCacheConfigDriftHint(
          composerPromptCacheDrift,
          composerPromptCacheOrchestrationLabel
            ? { orchestrationLabel: composerPromptCacheOrchestrationLabel }
            : undefined,
        )
      : null;
  const threadIdleCacheWarningEligible = Boolean(
    promptCacheTipPreferences.enabled &&
      activeThread &&
      runProjection?.timeline.length &&
      isContinuableThreadStatus(activeThread.status),
  );
  const threadIdleCacheWarningActivityAt = runProjection
    ? resolveLatestThreadActivityAt(runProjection.timeline)
    : undefined;

  function saveComposerDraftInBackground(contextKey: string, value: string): void {
    if (typeof window.eco?.saveComposerDraft !== "function") {
      return;
    }
    void window.eco.saveComposerDraft({ contextKey, prompt: value }).catch((caught) => {
      console.error("[eco] composer draft save failed", caught);
    });
  }

  function removeComposerDraft(contextKey: string | undefined): void {
    clearComposerDraft(composerDraftsByKeyRef.current, contextKey);
    if (!contextKey) {
      return;
    }
    if (composerContextKeyRef.current === contextKey) {
      composerPromptRef.current = "";
    }
    const pending = composerDraftSaveTimerRef.current;
    if (pending?.key === contextKey) {
      window.clearTimeout(pending.timer);
      composerDraftSaveTimerRef.current = undefined;
    }
    if (typeof window.eco?.deleteComposerDraft === "function") {
      void window.eco.deleteComposerDraft(contextKey).catch((caught) => {
        console.error("[eco] composer draft delete failed", caught);
      });
    }
  }

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
  const showClarification = Boolean(pendingClarification);
  const showComposerDockApproval = showBashApproval || showPlanApproval || showClarification;
  const composerDockSurfaceKey = showBashApproval
    ? `bash-${pendingBashApproval!.toolUseId}`
    : showPlanApproval
      ? `plan-${activeThread?.id ?? "unknown"}`
      : showClarification
        ? `clarification-${pendingClarification!.toolUseId}`
        : "composer";

  const planFailureMessage = activeThread ? extractPlanFailureMessage(activeThread.message) : undefined;

  useEffect(() => {
    const prevKey = prevComposerContextKeyRef.current;
    if (prevKey !== undefined && prevKey !== composerContextKey) {
      persistComposerDraftSnapshot(composerDraftsByKeyRef.current, prevKey, {
        prompt: composerPromptRef.current,
        attachments: composerAttachmentsRef.current,
        ...(composerRewindTargetRef.current ? { rewindTarget: composerRewindTargetRef.current } : {}),
      });
      saveComposerDraftInBackground(prevKey, composerPromptRef.current);
    }

    if (prevKey !== composerContextKey) {
      const draft = composerContextKey ? composerDraftsByKeyRef.current[composerContextKey] : undefined;
      const threadId = composerContextKey ? threadIdFromComposerContextKey(composerContextKey) : undefined;
      const nextPrompt = draft?.prompt ?? "";
      setEditingFollowUpId(undefined);
      composerPromptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      setComposerAttachments(draft?.attachments ? [...draft.attachments] : []);
      setComposerRewindTarget(
        draft?.rewindTarget && (!threadId || draft.rewindTarget.threadId === threadId)
          ? draft.rewindTarget
          : undefined,
      );
      setComposerImageNotice(undefined);
      prevComposerContextKeyRef.current = composerContextKey;

      const requestId = ++composerDraftLoadRequestRef.current;
      if (!draft && composerContextKey && typeof window.eco?.getComposerDraft === "function") {
        void window.eco
          .getComposerDraft(composerContextKey)
          .then((persisted) => {
            if (
              requestId !== composerDraftLoadRequestRef.current ||
              composerContextKeyRef.current !== composerContextKey ||
              composerPromptRef.current !== nextPrompt ||
              !persisted
            ) {
              return;
            }
            const restored: ComposerDraft = {
              prompt: persisted.prompt,
              attachments: [],
            };
            composerDraftsByKeyRef.current[composerContextKey] = restored;
            composerPromptRef.current = persisted.prompt;
            setPrompt(persisted.prompt);
          })
          .catch((caught) => {
            console.error("[eco] composer draft load failed", caught);
          });
      }
    }
  }, [composerContextKey]);

  useEffect(() => {
    if (
      !composerContextKey ||
      prevComposerContextKeyRef.current !== composerContextKey ||
      composerPromptRef.current !== prompt
    ) {
      return;
    }
    persistComposerDraftSnapshot(composerDraftsByKeyRef.current, composerContextKey, {
      prompt,
      attachments: composerAttachmentsRef.current,
      ...(composerRewindTargetRef.current ? { rewindTarget: composerRewindTargetRef.current } : {}),
    });
    const pending = composerDraftSaveTimerRef.current;
    if (pending) {
      window.clearTimeout(pending.timer);
    }
    const timer = window.setTimeout(() => {
      composerDraftSaveTimerRef.current = undefined;
      saveComposerDraftInBackground(composerContextKey, prompt);
    }, COMPOSER_DRAFT_SAVE_DEBOUNCE_MS);
    composerDraftSaveTimerRef.current = { key: composerContextKey, timer };
    return () => window.clearTimeout(timer);
  }, [composerContextKey, prompt]);

  useEffect(() => {
    const flushComposerDraft = () => {
      const contextKey = composerContextKeyRef.current;
      if (contextKey) {
        saveComposerDraftInBackground(contextKey, composerPromptRef.current);
      }
    };
    const flushHiddenComposerDraft = () => {
      if (document.visibilityState === "hidden") {
        flushComposerDraft();
      }
    };
    window.addEventListener("beforeunload", flushComposerDraft);
    document.addEventListener("visibilitychange", flushHiddenComposerDraft);
    return () => {
      window.removeEventListener("beforeunload", flushComposerDraft);
      document.removeEventListener("visibilitychange", flushHiddenComposerDraft);
    };
  }, []);

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
      displayProjection
        ? buildThreadRunProjectionViewModel(
            displayProjection,
            activeThread ? { id: activeThread.id, prompt: activeThread.prompt } : undefined,
            {
              agentDisplayNames: activeRuntimeAgentDisplayNames,
              includePromptCacheTips: promptCacheTipPreferences.enabled,
            },
          )
        : undefined,
    [
      activeRuntimeAgentDisplayNames,
      activeThread?.id,
      activeThread?.prompt,
      displayProjection,
      promptCacheTipPreferences.enabled,
    ],
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
    const nextThreadId = activeThread?.id;
    const prevThreadId = taskPanelUiThreadIdRef.current;
    if (prevThreadId === nextThreadId) {
      return;
    }

    if (prevThreadId) {
      taskPanelUiByThreadRef.current[prevThreadId] = liveTaskPanelUiRef.current;
    }

    taskPanelAnimationControls.stop();
    taskPanelCloseRequestRef.current += 1;
    taskPanelClosingRef.current = false;
    setTaskPanelExiting(false);
    pendingTaskPanelTabCloseRef.current = undefined;

    const restored = nextThreadId
      ? normalizeTaskPanelSessionUiState(taskPanelUiByThreadRef.current[nextThreadId])
      : emptyTaskPanelSessionUiState();

    setTaskPanelActiveTab(restored.activeTab);
    setOpenTaskPanelTabIds(restored.openTabIds);
    setSelectedSubagentAgentId(restored.selectedSubagentAgentId);
    setTaskPanelFullscreen(restored.open && restored.fullscreen);

    if (restored.fileTarget?.path) {
      fileReferenceRequestIdRef.current += 1;
      setFileTarget({
        path: restored.fileTarget.path,
        requestId: fileReferenceRequestIdRef.current,
        ...(typeof restored.fileTarget.line === "number" ? { line: restored.fileTarget.line } : {}),
        ...(typeof restored.fileTarget.column === "number"
          ? { column: restored.fileTarget.column }
          : {}),
        ...(restored.fileTarget.restricted === true ? { restricted: true } : {}),
      });
    } else {
      setFileTarget(undefined);
    }

    taskPanelActiveTabRef.current = restored.activeTab;
    if (restored.open) {
      taskDrawerOpenRef.current = true;
      taskPanelAnimationControls.set(
        prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0 },
      );
      setTaskPanelLayoutPresent(true);
      setTaskDrawerOpen(true);
      if (restored.activeTab === TASK_PANEL_REVIEW_TAB_ID) {
        void refreshReviewDiffRef.current();
      }
    } else {
      taskDrawerOpenRef.current = false;
      setTaskDrawerOpen(false);
      setTaskPanelLayoutPresent(false);
      void window.eco?.browserSetVisible?.({ visible: false });
    }

    taskPanelUiThreadIdRef.current = nextThreadId;
  }, [activeThread?.id, prefersReducedMotion, taskPanelAnimationControls]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(taskPanelNarrowMediaQuery);
    const exitFullscreenOnNarrow = () => {
      if (mediaQuery.matches) {
        setTaskPanelFullscreen(false);
      }
    };
    exitFullscreenOnNarrow();
    mediaQuery.addEventListener("change", exitFullscreenOnNarrow);
    return () => mediaQuery.removeEventListener("change", exitFullscreenOnNarrow);
  }, []);

  const revealTaskPanel = useCallback(() => {
    const openRequest = taskPanelCloseRequestRef.current + 1;
    taskPanelCloseRequestRef.current = openRequest;
    const reversingExit = taskPanelClosingRef.current;
    taskPanelClosingRef.current = false;
    // Cancel parallel exit reflow immediately so the panel returns to grid flow.
    setTaskPanelExiting(false);
    pendingTaskPanelTabCloseRef.current = undefined;
    taskPanelAnimationControls.stop();
    if (!taskPanelLayoutPresent) {
      taskPanelAnimationControls.set(
        prefersReducedMotion
          ? { opacity: 0 }
          : { opacity: 0, x: taskPanelWidth + 18 },
      );
    }
    setTaskPanelLayoutPresent(true);
    setTaskDrawerOpen(true);
    requestAnimationFrame(() => {
      if (taskPanelCloseRequestRef.current !== openRequest) {
        return;
      }
      void taskPanelAnimationControls.start(
        { opacity: 1, x: 0 },
        prefersReducedMotion
          ? { duration: 0.12, ease: "easeOut" }
          : {
              x: {
                type: "spring",
                bounce: 0,
                duration: reversingExit ? 0.28 : 0.34,
              },
              opacity: { duration: 0.18, ease: "easeOut" },
            },
      );
    });
  }, [
    prefersReducedMotion,
    taskPanelAnimationControls,
    taskPanelLayoutPresent,
    taskPanelWidth,
  ]);

  const dismissTaskPanel = useCallback(() => {
    if (!taskPanelLayoutPresent || taskPanelClosingRef.current) {
      return;
    }
    taskPanelClosingRef.current = true;
    const closeRequest = taskPanelCloseRequestRef.current + 1;
    taskPanelCloseRequestRef.current = closeRequest;
    // Hide native WebContentsViews before exit paint; they are not CSS-transformed with the
    // panel and would otherwise stick on the main pane while the drawer animates out.
    void window.eco?.browserSetVisible?.({ visible: false });
    // Detach the panel from grid flow immediately so the feed reflows in parallel
    // with the exit transform (avoids "animation finishes then layout pops open").
    setTaskPanelExiting(true);
    void taskPanelAnimationControls
      .start(
        prefersReducedMotion
          ? { opacity: 0 }
          : { opacity: 0, x: taskPanelWidth + 18 },
        prefersReducedMotion
          ? { duration: 0.12, ease: "easeOut" }
          : {
              x: { type: "spring", bounce: 0, duration: 0.34 },
              opacity: { duration: 0.2, ease: "easeOut" },
            },
      )
      .then(() => {
        if (taskPanelCloseRequestRef.current !== closeRequest) {
          return;
        }
        taskPanelClosingRef.current = false;
        setTaskPanelExiting(false);
        const pendingTabId = pendingTaskPanelTabCloseRef.current;
        pendingTaskPanelTabCloseRef.current = undefined;
        const availableWidth = mainPaneRef.current?.getBoundingClientRect().width;
        const nextLayoutMode = availableWidth
          ? resolveActivityWorkspaceLayoutMode(availableWidth, activityWorkspaceLayoutMode)
          : undefined;
        // Release layout on the critical path — startTransition delayed the grid reclaim
        // and read as a post-exit hitch.
        setTaskDrawerOpen(false);
        setTaskPanelLayoutPresent(false);
        setTaskPanelFullscreen(false);
        // Idempotent: covers any late reveal race during the exit spring.
        void window.eco?.browserSetVisible?.({ visible: false });
        if (pendingTabId) {
          setOpenTaskPanelTabIds(
            (current) => removeOpenTaskPanelTab(current, pendingTabId).tabs,
          );
          setTaskPanelActiveTab((current) =>
            current === pendingTabId ? TASK_PANEL_HOME_TAB_ID : current,
          );
          setSelectedSubagentAgentId(undefined);
        }
        if (nextLayoutMode) {
          startTransition(() => {
            setActivityWorkspaceLayoutMode(nextLayoutMode);
            if (shouldAutoOpenWorkspacePanel(nextLayoutMode)) {
              setWorkspacePanelManualOverride({
                layoutMode: nextLayoutMode,
                projectPath: currentProjectPath,
                threadId: activeThread?.id,
                open: true,
              });
            }
          });
        }
      });
  }, [
    activityWorkspaceLayoutMode,
    activeThread?.id,
    currentProjectPath,
    prefersReducedMotion,
    taskPanelAnimationControls,
    taskPanelLayoutPresent,
    taskPanelWidth,
  ]);

  useEffect(() => {
    const handleFileReference = (event: Event) => {
      const reference = (event as CustomEvent<WorkspaceFileReference>).detail;
      if (!reference?.path || !currentProjectPath) {
        return;
      }
      fileReferenceRequestIdRef.current += 1;
      setFileTarget({
        ...reference,
        requestId: fileReferenceRequestIdRef.current,
        restricted: !isWorkspacePathContained(currentProjectPath, reference.path),
      });
      setOpenTaskPanelTabIds((current) =>
        addOpenTaskPanelTab(current, TASK_PANEL_FILE_VIEWER_TAB_ID),
      );
      setTaskPanelActiveTab(TASK_PANEL_FILE_VIEWER_TAB_ID);
      setSelectedSubagentAgentId(undefined);
      setTaskPanelFullscreen(false);
      revealTaskPanel();
    };
    window.addEventListener(WORKSPACE_FILE_REFERENCE_EVENT, handleFileReference);
    return () => window.removeEventListener(WORKSPACE_FILE_REFERENCE_EVENT, handleFileReference);
  }, [currentProjectPath, revealTaskPanel]);

  useEffect(() => {
    const handleBrowserLink = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      if (typeof url !== "string" || !url.trim()) {
        return;
      }
      if (!currentProjectPath) {
        return;
      }
      void window.eco
        ?.browserOpen?.({
          url,
          reveal: true,
          newBrowser: true,
          ...(activeThread?.id ? { threadId: activeThread.id } : {}),
        })
        .then((state) => {
          if (!state) return;
          setBrowserViewState(state);
          const focusId = state.focusedBrowserId ?? state.revealBrowserId ?? state.instances.at(-1)?.id;
          if (focusId) {
            const tabId = browserTaskTabId(focusId);
            setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, tabId));
            setTaskPanelActiveTab(tabId);
          }
          setSelectedSubagentAgentId(undefined);
          setTaskPanelFullscreen(false);
          revealTaskPanel();
        });
    };
    window.addEventListener(BROWSER_LINK_OPEN_EVENT, handleBrowserLink);
    return () => window.removeEventListener(BROWSER_LINK_OPEN_EVENT, handleBrowserLink);
  }, [activeThread?.id, currentProjectPath, revealTaskPanel]);

  useEffect(() => {
    if (settingsOpen) {
      void window.eco?.browserSetVisible?.({ visible: false });
    }
  }, [settingsOpen]);

  useEffect(() => {
    void window.eco
      ?.browserSetUiScope?.({
        threadId: activeThread?.id ?? null,
      })
      .then(() => {
        // Switching chats while the work panel is collapsed must not leave guests painted.
        if (!taskDrawerOpenRef.current) {
          void window.eco?.browserSetVisible?.({ visible: false });
        }
      });
  }, [activeThread?.id]);

  useEffect(() => {
    const unsubscribe = window.eco?.onBrowserStateChanged?.((state) => {
      setBrowserViewState(state);
      // Agent navigated / created a page: track tabs, but never force-open the work panel.
      // When the panel is already open on a non-browser tab (files / plan / …), do not
      // switch active tab — that would mount BrowserPanel and steal composer focus.
      // Only follow the agent when the human is already watching a browser tab.
      if (state.revealBrowserId && currentProjectPath) {
        const tabId = browserTaskTabId(state.revealBrowserId);
        setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, tabId));
        if (
          taskDrawerOpenRef.current &&
          isBrowserTaskTabId(String(taskPanelActiveTabRef.current ?? ""))
        ) {
          setTaskPanelActiveTab(tabId);
          setSelectedSubagentAgentId(undefined);
        }
      }
      // Keep open browser tabs aligned with live instances for current UI scope.
      if (state.instances.length > 0) {
        setOpenTaskPanelTabIds((current) => {
          let next = current;
          for (const instance of state.instances) {
            next = addOpenTaskPanelTab(next, browserTaskTabId(instance.id));
          }
          return next;
        });
      }
    });
    return () => unsubscribe?.();
  }, [currentProjectPath]);

  useEffect(() => {
    const liveBrowserIds = new Set(
      (browserViewState?.instances ?? []).map((instance) => instance.id),
    );
    const projectionLoaded = Boolean(activeProjectionViewModel);
    setOpenTaskPanelTabIds((current) => {
      const next = current.filter((tabId) => {
        if (
          tabId === TASK_PANEL_FILES_TAB_ID ||
          tabId === TASK_PANEL_FILE_VIEWER_TAB_ID ||
          tabId === TASK_PANEL_REVIEW_TAB_ID ||
          tabId === TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID ||
          tabId === TASK_PANEL_PLAN_TAB_ID ||
          activeSubagentCards.some((card) => card.key === tabId)
        ) {
          return true;
        }
        if (parseImageGenerationTaskTabId(String(tabId))) {
          return true;
        }
        const browserId = parseBrowserTaskTabId(String(tabId));
        if (browserId) {
          return liveBrowserIds.has(browserId);
        }
        // Subagent tabs restored before projection hydrates must not be dropped.
        return !projectionLoaded;
      });
      if (next.length === current.length && next.every((tabId, index) => tabId === current[index])) {
        return current;
      }
      if (taskPanelActiveTab !== TASK_PANEL_HOME_TAB_ID && !next.includes(taskPanelActiveTab)) {
        const fallback = next.at(-1);
        setTaskPanelActiveTab(fallback ?? TASK_PANEL_HOME_TAB_ID);
        setSelectedSubagentAgentId(
          fallback && activeSubagentCards.some((card) => card.key === fallback)
            ? fallback
            : undefined,
        );
      }
      return next;
    });
  }, [
    activeProjectionViewModel,
    activeSubagentCards,
    browserViewState?.instances,
    taskPanelActiveTab,
  ]);

  const toggleTaskPanelForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    if (taskDrawerOpen) {
      if (taskPanelClosingRef.current) {
        revealTaskPanel();
      } else {
        dismissTaskPanel();
      }
      return;
    }
    setTaskPanelActiveTab(TASK_PANEL_HOME_TAB_ID);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    revealTaskPanel();
  }, [currentProjectPath, dismissTaskPanel, revealTaskPanel, taskDrawerOpen]);

  const toggleWorkPanelForCurrentProject = useCallback(() => {
    toggleWorkspacePanelForCurrentProject();
  }, [toggleWorkspacePanelForCurrentProject]);

  const toggleFileTreeForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    if (
      taskDrawerOpen &&
      taskPanelActiveTab === TASK_PANEL_FILES_TAB_ID &&
      !taskPanelClosingRef.current
    ) {
      dismissTaskPanel();
      return;
    }
    setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, TASK_PANEL_FILES_TAB_ID));
    setTaskPanelActiveTab(TASK_PANEL_FILES_TAB_ID);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    revealTaskPanel();
  }, [
    currentProjectPath,
    dismissTaskPanel,
    revealTaskPanel,
    taskDrawerOpen,
    taskPanelActiveTab,
  ]);

  const openBrowserTaskPanel = useCallback(
    (options?: string | { browserId?: string; url?: string }) => {
      if (!currentProjectPath) {
        return;
      }
      const resolved =
        typeof options === "string" ? { browserId: options } : (options ?? {});
      setSelectedSubagentAgentId(undefined);
      setTaskPanelFullscreen(false);
      revealTaskPanel();
      if (resolved.browserId) {
        const tabId = browserTaskTabId(resolved.browserId);
        setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, tabId));
        setTaskPanelActiveTab(tabId);
        void window.eco?.browserFocus?.({ browserId: resolved.browserId, reveal: true }).then((state) => {
          if (state) setBrowserViewState(state);
        });
        return;
      }
      void window.eco
        ?.browserOpen?.({
          reveal: true,
          newBrowser: true,
          ...(resolved.url ? { url: resolved.url } : {}),
          ...(activeThread?.id ? { threadId: activeThread.id } : {}),
        })
        .then((state) => {
          if (!state) return;
          setBrowserViewState(state);
          const focusId =
            state.focusedBrowserId ?? state.revealBrowserId ?? state.instances.at(-1)?.id;
          if (focusId) {
            const tabId = browserTaskTabId(focusId);
            setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, tabId));
            setTaskPanelActiveTab(tabId);
          }
        });
    },
    [activeThread?.id, currentProjectPath, revealTaskPanel],
  );

  const openWebChatItem = useCallback(
    (item: WebChatItem) => {
      openBrowserTaskPanel({ url: item.url });
    },
    [openBrowserTaskPanel],
  );

  const toggleBrowserForCurrentProject = useCallback(() => {
    if (!currentProjectPath) {
      return;
    }
    if (
      taskDrawerOpen &&
      isBrowserTaskTabId(String(taskPanelActiveTab)) &&
      !taskPanelClosingRef.current
    ) {
      dismissTaskPanel();
      return;
    }
    openBrowserTaskPanel();
  }, [
    currentProjectPath,
    dismissTaskPanel,
    openBrowserTaskPanel,
    taskDrawerOpen,
    taskPanelActiveTab,
  ]);

  menuCommandHandlerRef.current = (command) => {
    switch (command) {
      case "new-chat":
        startNewChat();
        return;
      case "open-folder":
        void openWorkspace();
        return;
      case "check-for-updates":
        void window.eco?.checkDesktopForUpdates();
        return;
      case "toggle-sidebar":
        setSidebarOpen((current) => !current);
        return;
      case "toggle-bottom-panel":
        toggleTerminalForCurrentProject();
        return;
      case "toggle-work-panel":
        toggleWorkPanelForCurrentProject();
        return;
      case "toggle-review-panel":
        toggleTaskPanelForCurrentProject();
        return;
      case "toggle-file-tree":
        toggleFileTreeForCurrentProject();
        return;
      case "toggle-browser":
        toggleBrowserForCurrentProject();
        return;
      default: {
        const exhaustiveCommand: never = command;
        throw new Error(`Unhandled app menu command: ${exhaustiveCommand}`);
      }
    }
  };

  const openPlanTaskDrawer = useCallback(() => {
    if (!taskPanelPlan) {
      return;
    }
    setOpenTaskPanelTabIds((current) =>
      addOpenTaskPanelTab(current, TASK_PANEL_PLAN_TAB_ID),
    );
    setTaskPanelActiveTab(TASK_PANEL_PLAN_TAB_ID);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    revealTaskPanel();
  }, [revealTaskPanel, taskPanelPlan]);

  const openSubagentTaskDrawer = useCallback((agentId: string) => {
    setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, agentId));
    setTaskPanelActiveTab(agentId);
    setSelectedSubagentAgentId(agentId);
    setTaskPanelFullscreen(false);
    revealTaskPanel();
  }, [revealTaskPanel]);

  const openImageGenerationArtifact = useCallback((artifactId: string) => {
    const tabId = imageGenerationTaskTabId(artifactId);
    setOpenTaskPanelTabIds((current) => addOpenTaskPanelTab(current, tabId));
    setTaskPanelActiveTab(tabId);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    revealTaskPanel();
  }, [revealTaskPanel]);

  const openImageGenerationTool = useCallback((toolUseId: string) => {
    const threadId = activeThread?.id;
    if (!threadId) return;
    const artifact = (imageArtifactsByThread[threadId] ?? []).find(
      (candidate) => candidate.toolUseId === toolUseId,
    );
    if (artifact) openImageGenerationArtifact(artifact.id);
  }, [activeThread?.id, imageArtifactsByThread, openImageGenerationArtifact]);

  const closeTaskPanelTab = useCallback(
    (tabId: TaskPanelActiveTab) => {
      const result = removeOpenTaskPanelTab(openTaskPanelTabIds, tabId);
      if (!openTaskPanelTabIds.includes(tabId)) {
        return;
      }
      const browserId = parseBrowserTaskTabId(String(tabId));
      if (browserId) {
        // Tab × closes the page for real (Agent target goes away with that WebContents).
        void window.eco?.browserCloseInstance?.({ browserId }).then((state) => {
          if (state) setBrowserViewState(state);
        });
      }
      if (result.tabs.length === 0) {
        pendingTaskPanelTabCloseRef.current = tabId;
        dismissTaskPanel();
        return;
      }
      setOpenTaskPanelTabIds(result.tabs);
      if (taskPanelActiveTab === tabId) {
        const fallback = result.fallback;
        setTaskPanelActiveTab(fallback ?? TASK_PANEL_HOME_TAB_ID);
        setSelectedSubagentAgentId(
          fallback && activeSubagentCards.some((card) => card.key === fallback)
            ? fallback
            : undefined,
        );
      }
    },
    [activeSubagentCards, dismissTaskPanel, openTaskPanelTabIds, taskPanelActiveTab],
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
  const canEditComposerConfig =
    !activeThread ||
    (threadAcceptsInput && activeThread.status !== "running" && activeThread.status !== "queued");
  const canEditBashReviewMode = Boolean(composerRuntimeConfig);
  const canSwitchRouteProfile = canEditComposerConfig;
  const openComposerRoutePopover = useCallback(
    (anchor: "plus" | "model-empty" = "plus") => {
      if (!canSwitchRouteProfile || isSavingSettings) {
        return;
      }
      setComposerRouteAnchor(anchor);
      // Defer open so the originating click is not treated as an outside dismiss.
      window.setTimeout(() => {
        setComposerRoutePopoverOpen(true);
      }, 0);
    },
    [canSwitchRouteProfile, isSavingSettings],
  );
  const openComposerOrchestrationChooser = useCallback(() => {
    if (!canSwitchRouteProfile || isSavingSettings) {
      return;
    }
    // 无主代理资源时 Popover 内无可选项，直接进入运行配置设置。
    if (settings.mainAgentConfigs.length === 0) {
      openModelsSettings("compositionParts");
      return;
    }
    openComposerRoutePopover("model-empty");
  }, [
    canSwitchRouteProfile,
    isSavingSettings,
    openComposerRoutePopover,
    settings.mainAgentConfigs.length,
  ]);
  const agentModelLabels = useMemo(
    () =>
      buildComposerAgentModelLabels({
        routes: activeRoutes,
        threadModelByRole,
        snapshot: selectedOrchestrationSnapshot,
        templates: settings.agentTemplates,
      }),
    [activeRoutes, selectedOrchestrationSnapshot, settings.agentTemplates, threadModelByRole],
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
  const activityWorkspaceRef = useRef<HTMLDivElement>(null);
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
    () => buildSkillMap(slashPickerSkills),
    [slashPickerSkills],
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
    if (!currentProjectPath || !activeThread) {
      setActivityWorkspaceLayoutMode("feed-only");
      return undefined;
    }

    const activityWorkspace = activityWorkspaceRef.current;
    if (!activityWorkspace) {
      return undefined;
    }

    let frame = 0;
    const update = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        // MainPane / activity-workspace width → cards dock|float program only.
        const width = activityWorkspace.clientWidth;
        setActivityWorkspaceLayoutMode((current) => resolveActivityWorkspaceLayoutMode(width, current));
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(activityWorkspace);
    window.addEventListener("resize", update);
    update();

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeThread?.id, currentProjectPath]);

  useLayoutEffect(() => {
    if (!currentProjectPath || !activeThread) {
      setFeedColumnWidth(0);
      return undefined;
    }

    const feedColumn = scrollBodyRef.current;
    if (!feedColumn) {
      return undefined;
    }

    let frame = 0;
    const update = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        setFeedColumnWidth(feedColumn.clientWidth);
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(feedColumn);
    window.addEventListener("resize", update);
    update();

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [activeThread?.id, currentProjectPath]);

  useEffect(() => {
    setActivityMessageNavSpaceVisible((current) =>
      shouldShowActivityMessageNav(
        feedColumnWidth,
        activityUserMessageNavItems.length,
        current,
      ),
    );
  }, [activityUserMessageNavItems.length, feedColumnWidth]);

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
        loadFeedEarlierRef.current();
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
    const threadId = activeThread?.id;
    if (!threadId || !runProjection) {
      return;
    }
    const historyRevision = runProjection.historyRevision ?? 0;
    const hasEarlier = runProjection.hasEarlier === true;
    setFeedEarlierByThread((current) => {
      const existing = current[threadId];
      if (existing && existing.historyRevision === historyRevision) {
        if (existing.timeline.length === 0 && hasEarlier && !existing.hasEarlier) {
          return {
            ...current,
            [threadId]: { ...existing, hasEarlier: true },
          };
        }
        return current;
      }
      return {
        ...current,
        [threadId]: createFeedEarlierHistoryState(threadId, {
          historyRevision,
          hasEarlier,
        }),
      };
    });
  }, [activeThread?.id, runProjection?.hasEarlier, runProjection?.historyRevision, runProjection]);

  const loadFeedEarlier = useCallback(() => {
    const threadId = selectedThreadIdRef.current;
    const liveProjection = runProjectionRef.current;
    if (
      !threadId ||
      !liveProjection ||
      loadingFeedEarlierRef.current ||
      typeof window.eco?.getThreadRunProjectionDetail !== "function"
    ) {
      return;
    }
    const earlier = feedEarlierByThreadRef.current[threadId];
    const hasEarlier = earlier ? earlier.hasEarlier : liveProjection.hasEarlier === true;
    if (!hasEarlier) {
      return;
    }
    const beforeSequence = resolveFeedEarlierBeforeSequence(earlier, liveProjection.timeline);
    if (beforeSequence === undefined) {
      return;
    }
    const container = activityMessagesRef.current;
    if (container) {
      feedEarlierScrollAnchorRef.current = {
        prevScrollHeight: container.scrollHeight,
        prevScrollTop: container.scrollTop,
      };
    }
    userDetachedFromBottomRef.current = true;
    loadingFeedEarlierRef.current = true;
    setLoadingFeedEarlier(true);
    const historyRevision = earlier?.historyRevision ?? liveProjection.historyRevision ?? 0;
    void window.eco
      .getThreadRunProjectionDetail({
        threadId,
        kind: "main",
        key: threadId,
        beforeSequence,
        tail: true,
        limit: ACTIVITY_FEED_EARLIER_PAGE_LIMIT,
      })
      .then((result) => {
        if (selectedThreadIdRef.current !== threadId) {
          return;
        }
        if (!result) {
          setFeedEarlierByThread((current) => {
            const existing = current[threadId];
            if (!existing) {
              return current;
            }
            return {
              ...current,
              [threadId]: { ...existing, hasEarlier: false },
            };
          });
          return;
        }
        setFeedEarlierByThread((current) => {
          const existing =
            current[threadId] ??
            createFeedEarlierHistoryState(threadId, {
              historyRevision,
              hasEarlier: true,
            });
          if (existing.historyRevision !== historyRevision) {
            return current;
          }
          const timeline = mergeFeedTimelineById(result.timeline, existing.timeline);
          return {
            ...current,
            [threadId]: {
              ...existing,
              timeline,
              hasEarlier: result.hasEarlier === true,
              ...(result.previousBeforeSequence !== undefined
                ? { beforeSequence: result.previousBeforeSequence }
                : timeline[0]?.sequence !== undefined
                  ? { beforeSequence: timeline[0].sequence }
                  : {}),
            },
          };
        });
      })
      .catch(() => {
        feedEarlierScrollAnchorRef.current = null;
      })
      .finally(() => {
        loadingFeedEarlierRef.current = false;
        setLoadingFeedEarlier(false);
      });
  }, []);
  loadFeedEarlierRef.current = loadFeedEarlier;

  useLayoutEffect(() => {
    const pending = feedEarlierScrollAnchorRef.current;
    const container = activityMessagesRef.current;
    if (!pending || !container) {
      return;
    }
    // Wait until earlier items are present (or loading finished with no growth).
    if (loadingFeedEarlier) {
      return;
    }
    const delta = container.scrollHeight - pending.prevScrollHeight;
    feedEarlierScrollAnchorRef.current = null;
    if (delta === 0) {
      return;
    }
    programmaticActivityFeedScrollRef.current = true;
    container.scrollTop = pending.prevScrollTop + delta;
    activityFeedScrollTopRef.current = container.scrollTop;
    requestAnimationFrame(() => {
      programmaticActivityFeedScrollRef.current = false;
      const el = activityMessagesRef.current;
      if (el) {
        activityFeedScrollTopRef.current = el.scrollTop;
      }
    });
  }, [activeFeedEarlier?.timeline, loadingFeedEarlier]);

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
      const threadId = selectedThreadIdRef.current;
      const earlier = threadId ? feedEarlierByThreadRef.current[threadId] : undefined;
      const liveProjection = runProjectionRef.current;
      const hasEarlier = earlier
        ? earlier.hasEarlier
        : liveProjection?.hasEarlier === true;
      if (
        shouldLoadFeedEarlier({
          scrollTop,
          hasEarlier,
          loadingEarlier: loadingFeedEarlierRef.current,
          programmaticScroll: false,
          thresholdPx: ACTIVITY_FEED_LOAD_EARLIER_THRESHOLD,
        })
      ) {
        loadFeedEarlier();
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
    loadFeedEarlier,
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

  useEffect(() => {
    const container = activityMessagesRef.current;
    if (!container || !activeThread?.id) {
      return;
    }
    let lastClientHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const nextClientHeight = container.clientHeight;
      const delta = lastClientHeight - nextClientHeight;
      lastClientHeight = nextClientHeight;
      if (delta === 0) {
        return;
      }
      clampActivityFeedOverscroll(container);
      // Terminal open/close resizes the feed viewport. Keep stick-to-bottom so content
      // rises with the panel instead of being clipped under it.
      if (userDetachedFromBottomRef.current) {
        if (delta > 0) {
          container.scrollTop = Math.max(0, container.scrollTop + delta);
          activityFeedScrollTopRef.current = container.scrollTop;
        }
        syncActivityFeedScrollJump(container);
        syncActivityUserMessageNavigator(container);
        return;
      }
      scrollActivityFeedToEnd();
      requestAnimationFrame(() => scrollActivityFeedToEnd());
      syncActivityUserMessageNavigator(container);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    activeThread?.id,
    clampActivityFeedOverscroll,
    scrollActivityFeedToEnd,
    syncActivityFeedScrollJump,
    syncActivityUserMessageNavigator,
  ]);

  useEffect(() => {
    if (!activeThread?.id || !currentProjectPath) {
      return;
    }
    if (userDetachedFromBottomRef.current) {
      return;
    }
    // Follow terminal height animation frames while stick-to-bottom is active.
    const startedAt = performance.now();
    const durationMs = 360;
    let frame = 0;
    const tick = () => {
      scrollActivityFeedToEnd();
      if (performance.now() - startedAt < durationMs) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [
    activeThread?.id,
    currentProjectPath,
    currentTerminalState?.height,
    currentTerminalState?.open,
    scrollActivityFeedToEnd,
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
      approvedPlan,
      clarification,
      bashApproval,
      followUps,
      todos,
      usageSnapshot,
    ] = await Promise.all([
      typeof window.eco.getThreadRunProjection === "function"
        ? window.eco.getThreadRunProjection({ threadId, mode: "feed" })
        : Promise.resolve(undefined),
      typeof window.eco.listSubagentSessions === "function"
        ? window.eco.listSubagentSessions(threadId)
        : Promise.resolve(undefined),
      typeof window.eco.listSubagentMetrics === "function"
        ? window.eco.listSubagentMetrics(threadId)
        : Promise.resolve(undefined),
      window.eco.getPendingPlan(threadId),
      typeof window.eco.getApprovedPlan === "function"
        ? window.eco.getApprovedPlan(threadId)
        : Promise.resolve(undefined),
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
      setRunProjectionByThread((current) => ({
        ...current,
        [threadId]: mergeThreadRunProjectionUpdate(current[threadId], projection),
      }));
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
      if (approvedPlan) {
        rememberApprovedPlanForThread(threadId, approvedPlan);
      } else {
        clearApprovedPlanForThread(threadId);
      }
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

  async function loadUserMessageEdit(activityLineId: string) {
    if (!activeThread) {
      throw new Error(t("activity.editUnavailable", { defaultValue: "未选择会话，无法编辑此消息" }));
    }
    if (typeof window.eco?.getUserMessageEdit !== "function") {
      throw new Error(t("activity.editUnavailable", { defaultValue: "当前版本不支持消息编辑" }));
    }
    return window.eco.getUserMessageEdit({
      threadId: activeThread.id,
      activityLineId,
    });
  }

  async function rewriteUserMessage(input: {
    activityLineId: string;
    prompt: string;
    attachments: import("../shared/ipc").PromptImageAttachment[];
    expectedHistoryRevision: number;
  }) {
    if (!activeThread) {
      throw new Error(t("activity.editUnavailable", { defaultValue: "未选择会话，无法编辑此消息" }));
    }
    if (typeof window.eco?.rewriteThreadFromMessage !== "function") {
      throw new Error(t("activity.editUnavailable", { defaultValue: "当前版本不支持消息编辑" }));
    }
    const threadId = activeThread.id;
    const result = await window.eco.rewriteThreadFromMessage({
      threadId,
      activityLineId: input.activityLineId,
      prompt: input.prompt,
      attachments: input.attachments,
      expectedHistoryRevision: input.expectedHistoryRevision,
    });
    setThreads((current) =>
      current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
    );
    clearPendingPlanForThread(threadId);
    clearPendingClarificationForThread(threadId);
    clearPendingBashApprovalForThread(threadId);
    try {
      await refreshThreadState(threadId);
    } catch (caught) {
      throw new Error(
        t("activity.editRefreshFailed", {
          defaultValue: "消息已提交，但历史刷新失败：{{detail}}",
          detail: errorMessage(caught),
        }),
      );
    }
    requestActivityFeedForceScroll();
    return result;
  }

  async function startEditingFollowUp(followUp: ThreadPendingFollowUp) {
    if (typeof window.eco?.setThreadFollowUpEditing !== "function") {
      setError(t("app.preload.followUpEditing"));
      return;
    }
    setFollowUpBusy(true);
    setError(undefined);
    try {
      await window.eco.setThreadFollowUpEditing({
        threadId: followUp.threadId,
        followUpId: followUp.id,
      });
      if (selectedThreadIdRef.current !== followUp.threadId) {
        await window.eco.setThreadFollowUpEditing({ threadId: followUp.threadId });
        return;
      }
      setEditingFollowUpId(followUp.id);
      setPrompt(followUp.prompt);
      setComposerAttachments(fromPromptImageAttachments(followUp.attachments ?? []));
      setComposerImageNotice(undefined);
      setComposerRewindTarget(undefined);
      composerRef.current?.focus();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setFollowUpBusy(false);
    }
  }

  function cancelEditingFollowUp() {
    setEditingFollowUpId(undefined);
    setPrompt("");
    setComposerAttachments([]);
    setComposerImageNotice(undefined);
  }

  useEffect(() => {
    if (!editingFollowUpId || !activeThread || !window.eco?.setThreadFollowUpEditing) {
      return undefined;
    }
    const threadId = activeThread.id;
    return () => {
      void window.eco?.setThreadFollowUpEditing?.({ threadId }).catch(() => undefined);
    };
  }, [activeThread?.id, editingFollowUpId]);

  async function sendComposerMessage(promptOverride?: string) {
    const promptForSend = promptOverride ?? prompt;
    if (!currentProjectPath || !window.eco || (!promptForSend.trim() && composerAttachments.length === 0)) {
      return;
    }
    const canSendWithPrompt = composerFollowUpMode
      ? Boolean(
          activeThread &&
            !followUpBusy &&
            !isStarting &&
            !planActionBusy &&
            !contextCompactionInFlight,
        )
      : Boolean(
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
    if (!canSendWithPrompt) return;
    if (isStarting || followUpBusy) {
      return;
    }
    if (contextCompactionInFlight) {
      setError(t("app.contextCompacting"));
      return;
    }
    setError(undefined);
    requestActivityFeedForceScroll();
    const attachments =
      composerAttachments.length > 0 ? toPromptImageAttachments(composerAttachments) : undefined;
    const messagePrompt = promptForSend.trim() || (attachments?.length ? t("app.imagePrompt") : "");

    if (composerFollowUpMode && activeThread) {
      if (editingFollowUpId) {
        if (typeof window.eco.updateThreadFollowUp !== "function") {
          setError(t("app.preload.followUpUpdate"));
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
        setError(t("app.preload.followUpEnqueue"));
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
        removeComposerDraft(composerContextKey);
        setPrompt("");
        setComposerRewindTarget(undefined);
        setComposerAttachments([]);
        setComposerImageNotice(undefined);
        requestActivityFeedForceScroll();
        // 用户已发送消息，接受当前的 prompt cache 配置漂移
        const acceptedRuntimeConfig = effectiveComposerRuntimeConfig ?? composerRuntimeConfig;
        if (acceptedRuntimeConfig) {
          promptCacheBaselineByThreadRef.current[activeThread.id] = acceptedRuntimeConfig;
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
    const runtimeConfigForSend = resolveComposerRuntimeConfigForSend();
    if (!runtimeConfigForSend) {
      setError(t("app.configureOrchestration"));
      setIsStarting(false);
      return;
    }
    try {
      if (activeThread && isContinuableThreadStatus(activeThread.status)) {
        const rewindTarget = activeComposerRewindTarget
          ? {
              activityLineId: activeComposerRewindTarget.activityLineId,
              ...(activeComposerRewindTarget.userMessageId
                ? { userMessageId: activeComposerRewindTarget.userMessageId }
                : {}),
            }
          : undefined;
        const result = await window.eco.continueThread({
          threadId: activeThread.id,
          prompt: messagePrompt,
          runtimeConfig: runtimeConfigForSend,
          ...(rewindTarget && { rewindTarget }),
          ...(attachments && { attachments }),
        });
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
        );
        clearPendingPlanForThread(result.thread.id);
        removeComposerDraft(composerContextKey);
        setPrompt("");
        setComposerRewindTarget(undefined);
        setComposerAttachments([]);
        setComposerImageNotice(undefined);
        requestActivityFeedForceScroll();
        try {
          await refreshThreadState(result.thread.id);
        } catch (caught) {
          setError(t("app.sentSyncFailed", { detail: errorMessage(caught) }));
        }
        // 用户已发送消息，接受当前的 prompt cache 配置漂移
        promptCacheBaselineByThreadRef.current[activeThread.id] =
          result.thread.runtimeConfig ?? runtimeConfigForSend;
        setPromptCacheBaselineVersion((v) => v + 1);
      } else {
        const result = await window.eco.startThread({
          workspacePath: currentProjectPath,
          prompt: messagePrompt,
          coreKind: newThreadCoreKind,
          runtimeConfig: runtimeConfigForSend,
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
        if (result.thread.status === "blocked") {
          setError(result.thread.message?.trim() || t("app.configureOrchestration"));
        }
        // 用户已发送消息，接受当前的 prompt cache 配置漂移
        promptCacheBaselineByThreadRef.current[result.thread.id] =
          result.thread.runtimeConfig ?? runtimeConfigForSend;
        setPromptCacheBaselineVersion((v) => v + 1);
      }
      removeComposerDraft(composerContextKey);
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

  async function reorderQueuedFollowUps(followUpIds: string[]) {
    if (!activeThread || typeof window.eco?.reorderThreadFollowUps !== "function") {
      return;
    }
    const previous = followUpsByThread[activeThread.id] ?? [];
    const queuedById = new Map(previous.filter((item) => item.status === "queued").map((item) => [item.id, item]));
    const reordered = followUpIds.map((id) => queuedById.get(id)).filter((item): item is ThreadPendingFollowUp => Boolean(item));
    if (reordered.length !== queuedById.size) {
      return;
    }
    const nonQueued = previous.filter((item) => item.status !== "queued");
    setFollowUpsByThread((current) => ({ ...current, [activeThread.id]: [...reordered, ...nonQueued] }));
    try {
      const result = await window.eco.reorderThreadFollowUps({ threadId: activeThread.id, followUpIds });
      setFollowUpsByThread((current) => ({ ...current, [activeThread.id]: result.followUps }));
    } catch (caught) {
      setFollowUpsByThread((current) => ({ ...current, [activeThread.id]: previous }));
      setError(errorMessage(caught));
    }
  }

  async function cancelQueuedFollowUp(followUp: ThreadPendingFollowUp) {
    if (!window.eco || typeof window.eco.cancelThreadFollowUp !== "function") {
      setError(t("app.preload.followUpCancel"));
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
      setError(t("app.preload.followUpEscalate"));
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
    const planToRemember = pendingPlan;
    setError(undefined);
    setPlanActionBusy(true);
    try {
      const result = await window.eco.approvePlan({
        threadId: activeThread.id,
      });
      if (planToRemember) {
        rememberApprovedPlanForThread(activeThread.id, planToRemember);
      }
      clearPendingPlanForThread(activeThread.id);
      const updatedThread = result.thread;
      if (updatedThread) {
        setThreads((current) =>
          current.map((thread) => (thread.id === updatedThread.id ? updatedThread : thread)),
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
      const updatedThread = result.thread;
      if (updatedThread) {
        setThreads((current) =>
          current.map((thread) => (thread.id === updatedThread.id ? updatedThread : thread)),
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

  async function uninstallSkill(skill: SkillInfo) {
    if (!window.eco) {
      throw new Error("Desktop bridge is unavailable.");
    }
    await window.eco.uninstallSkill({ directory: skill.directory });
    await refreshSkillsList(currentProjectPath);
  }

  async function searchSkillsCatalog(query: string) {
    if (!window.eco) throw new Error("Desktop bridge is unavailable.");
    return window.eco.searchSkillsCatalog({ query, limit: 20 });
  }

  async function loadSkillsCatalogLeaderboard() {
    if (!window.eco) throw new Error("Desktop bridge is unavailable.");
    return window.eco.listSkillsCatalogLeaderboard(12);
  }

  async function installCatalogSkill(entry: SkillCatalogEntry, layout: SkillLayout) {
    if (!window.eco) throw new Error("Desktop bridge is unavailable.");
    await window.eco.installCatalogSkill({ source: entry.source, skillId: entry.skillId, layout });
    await refreshSkillsList(currentProjectPath);
  }

  function openModelsSettings(tab: ModelsSettingsTab = "subagents") {
    setModelsSettingsTab(tab);
    setSettingsSection(tab === "compositionParts" ? "orchestrationComponents" : "agentLibrary");
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

  async function savePersonalizationSettingsSnapshot(snapshot: PersonalizationSettingsSnapshot) {
    if (!window.eco) {
      return;
    }
    const saved = await window.eco.savePersonalizationSettings(snapshot);
    setPersonalizationSettings(saved);
  }

  async function saveBrowserSettingsSnapshot(snapshot: BrowserSettingsSnapshot) {
    if (!window.eco?.saveBrowserSettings) {
      return;
    }
    const saved = await window.eco.saveBrowserSettings(snapshot);
    setBrowserSettings(saved);
    const state = await window.eco.getBrowserState?.();
    if (state) {
      setBrowserViewState(state);
    }
    setIntegrationAvailability(await window.eco.getIntegrationAvailability());
  }

  async function saveNotificationSettingsSnapshot(snapshot: NotificationSettingsSnapshot) {
    if (!window.eco?.saveNotificationSettings) {
      return;
    }
    const saved = await window.eco.saveNotificationSettings(snapshot);
    setNotificationSettings(saved);
  }

  async function saveContextWindowLimit(contextWindowLimitTokens: number) {
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    const saved = await window.eco.saveWorkflowSettings({
      ...workflowSettings,
      contextWindowLimitTokens,
    });
    setWorkflowSettings(saved);
  }

  async function saveMaxOutputLimit(maxOutputLimitTokens: number) {
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    const saved = await window.eco.saveWorkflowSettings({
      ...workflowSettings,
      maxOutputLimitTokens,
    });
    setWorkflowSettings(saved);
  }

  async function runAsrProfilesMutation(
    mutation: () => Promise<AsrProfilesSnapshot>,
  ): Promise<void> {
    if (asrBusyRef.current) throw new Error(t("asr.busy"));
    asrBusyRef.current = true;
    setAsrBusy(true);
    try {
      setAsrProfiles(await mutation());
      setAsrSettingsLoadError(undefined);
    } finally {
      asrBusyRef.current = false;
      setAsrBusy(false);
    }
  }

  async function saveAsrProfile(input: AsrProfileSaveInput): Promise<AsrProfileSnapshot> {
    const eco = window.eco;
    if (!eco) throw new Error(t("asr.apiUnavailable"));
    if (asrBusyRef.current) throw new Error(t("asr.busy"));
    asrBusyRef.current = true;
    setAsrBusy(true);
    try {
      const saved = await eco.saveAsrProfile(input);
      setAsrProfiles(await eco.listAsrProfiles());
      setAsrSettingsLoadError(undefined);
      return saved;
    } finally {
      asrBusyRef.current = false;
      setAsrBusy(false);
    }
  }

  async function deleteAsrProfile(profileId: string) {
    const eco = window.eco;
    if (!eco) throw new Error(t("asr.apiUnavailable"));
    await runAsrProfilesMutation(() => eco.deleteAsrProfile({ id: profileId }));
  }

  async function activateAsrProfile(profileId: string) {
    const eco = window.eco;
    if (!eco) throw new Error(t("asr.apiUnavailable"));
    await runAsrProfilesMutation(async () => {
      await eco.activateAsrProfile({ id: profileId });
      return eco.listAsrProfiles();
    });
  }

  async function saveAsrInputDevice(inputDeviceId: string) {
    const eco = window.eco;
    if (!eco) throw new Error(t("asr.apiUnavailable"));
    await runAsrProfilesMutation(() =>
      eco.saveAsrInputDevice({ inputDeviceId: inputDeviceId || null }),
    );
  }

  async function saveCommitMessageModelPreference(candidateModelId: string) {
    const mainAgentConfigId = composerRuntimeConfig?.orchestrationSelection?.mainAgentConfigId;
    if (!window.eco || !mainAgentConfigId) {
      return;
    }
    const result = await window.eco.listGitCommitModelOptions({ mainAgentConfigId });
    const option = result.options.find((candidate) => candidate.candidateModelId === candidateModelId);
    if (!option) {
      throw new Error("所选 Git 提交模型已不在候选模型列表中。");
    }
    const saved = await window.eco.saveGitSettings({
      ...gitSettings,
      commitMessageCandidateModelIdByMainAgentConfigId: {
        ...gitSettings.commitMessageCandidateModelIdByMainAgentConfigId,
        [mainAgentConfigId]: option.candidateModelId,
      },
    });
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
      storeGitStatus(currentProjectPath, status);
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
      storeGitStatus(currentProjectPath, status);
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
    await refreshGitStatus(undefined, { force: true });
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
      if (!currentProjectPath || !window.eco) {
        return;
      }
      const current = gitStatusByWorkspaceRef.current[currentProjectPath]?.status;
      if (current) {
        storeGitStatus(currentProjectPath, {
          ...current,
          insertions: diff.totalAdditions,
          deletions: diff.totalDeletions,
          dirtyFileCount: diff.fileCount,
          canCommit: diff.fileCount > 0,
        });
      }
      const workspace = await window.eco.inspectWorkspace(currentProjectPath);
      setProjectWorkspace(workspace);
    },
    [currentProjectPath, storeGitStatus],
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

  const refreshReviewDiff = useCallback(async () => {
    const eco = window.eco;
    if (!currentProjectPath || !eco) {
      return;
    }
    const requestId = reviewDiffRequestRef.current + 1;
    reviewDiffRequestRef.current = requestId;
    await loadTaskPanelReviewDiff({
      workspacePath: currentProjectPath,
      getWorkspaceDiff: (workspacePath) => eco.getWorkspaceDiff(workspacePath),
      isCurrent: () => reviewDiffRequestRef.current === requestId,
      onLoadingChange: handleChangesDiffLoadingChange,
      onLoaded: handleChangesDiffLoaded,
      onError: handleChangesDiffError,
    });
  }, [
    currentProjectPath,
    handleChangesDiffError,
    handleChangesDiffLoaded,
    handleChangesDiffLoadingChange,
  ]);
  refreshReviewDiffRef.current = refreshReviewDiff;

  const openReviewTaskDrawer = useCallback(async () => {
    setOpenTaskPanelTabIds((current) =>
      addOpenTaskPanelTab(current, TASK_PANEL_REVIEW_TAB_ID),
    );
    setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
    setSelectedSubagentAgentId(undefined);
    setTaskPanelFullscreen(false);
    revealTaskPanel();
    await refreshReviewDiff();
  }, [refreshReviewDiff, revealTaskPanel]);

  async function handleGitPullSuccess() {
    await handleGitCommitSuccess();
  }

  async function handleGitPullConflictsWithAgent(conflictFiles: string[]) {
    if (!currentProjectPath || !window.eco || conflictFiles.length === 0) {
      return;
    }
    if (!composerRuntimeConfig) {
      setError(t("app.configureOrchestration"));
      return;
    }
    const fileList = conflictFiles.map((file) => `- ${file}`).join("\n");
    const prompt = `Git pull 产生了合并冲突，请解决以下文件的冲突并完成合并：\n${fileList}\n\n请查看冲突标记（<<<<<<< / ======= / >>>>>>>），保留正确代码，然后 git add 相关文件并完成合并提交。`;
    setError(undefined);

    if (activeThread) {
      if (activeThread.status === "running" || activeThread.status === "queued") {
        if (typeof window.eco.enqueueThreadFollowUp !== "function") {
          setError(t("app.preload.followUpEnqueue"));
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
            runtimeConfig: effectiveComposerRuntimeConfig ?? composerRuntimeConfig,
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
        coreKind: newThreadCoreKind,
        runtimeConfig: effectiveComposerRuntimeConfig ?? composerRuntimeConfig,
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

  function emptyOrchestrationSelection(): OrchestrationSelection {
    return {
      mainAgentConfigId: "",
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "none" },
    };
  }

  async function applyComposerOrchestrationSelection(patch: {
    mainAgentConfigId?: string;
    mainPrompt?: MainAgentPromptSelection;
    subagents?: SubagentSelection;
  }) {
    if (!canEditComposerConfig) {
      return;
    }
    const current: OrchestrationSelection =
      composerRuntimeConfig?.orchestrationSelection ??
      projectOrchestrationSelection ??
      workflowSettings.defaultOrchestrationSelection ??
      emptyOrchestrationSelection();
    const nextSelection: OrchestrationSelection = {
      mainAgentConfigId: patch.mainAgentConfigId ?? current.mainAgentConfigId,
      mainPrompt: patch.mainPrompt ?? current.mainPrompt,
      subagents: patch.subagents ?? current.subagents,
    };
    if (!hasCompleteOrchestrationSelection(nextSelection)) {
      const partialBase = composerRuntimeConfig ?? {
        subagentEnabled: defaultSubagentAvailability(),
        sessionMode: workflowSettings.sessionMode ?? "agent",
        bashReviewMode: "always" as const,
      };
      const { resolvedOrchestrationSnapshot: _removed, ...base } = partialBase;
      await persistComposerRuntimeConfig({
        ...base,
        orchestrationSelection: nextSelection,
      });
      return;
    }
    let materialized: Pick<ThreadRuntimeConfig, "orchestrationSelection" | "resolvedOrchestrationSnapshot">;
    try {
      materialized = materializeThreadOrchestrationSnapshot(settings, nextSelection);
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    const snapshot = materialized.resolvedOrchestrationSnapshot!;
    const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(mcpSettings.servers);
    const projectMcpServersEnabled =
      projectMcpSettings?.workspacePath === currentProjectPath
        ? projectMcpSettings?.enabledByServer
        : undefined;
    const bootstrapped =
      composerRuntimeConfig ??
      buildThreadRuntimeConfigFromDefaults({
        settings,
        workflowDefaults: workflowSettings,
        orchestrationSelection: nextSelection,
        mcpServers: mcpSettings.servers,
      });
    const next: ThreadRuntimeConfig = {
      ...bootstrapped,
      ...materialized,
      subagentEnabled: deriveSubagentEnabledFromSnapshot(
        snapshot,
        composerRuntimeConfig?.subagentEnabled ?? bootstrapped.subagentEnabled,
      ),
      ...(availableMcpServerKeys.length > 0
        ? {
            mcpServersEnabled: deriveMcpServersEnabled(availableMcpServerKeys, {
              ...(composerRuntimeConfig?.mcpServersEnabled
                ? { existing: composerRuntimeConfig.mcpServersEnabled }
                : bootstrapped.mcpServersEnabled
                  ? { existing: bootstrapped.mcpServersEnabled }
                  : {}),
              ...(projectMcpServersEnabled && Object.keys(projectMcpServersEnabled).length > 0
                ? { remembered: projectMcpServersEnabled }
                : workflowSettings.mcpServersEnabled
                  ? { remembered: workflowSettings.mcpServersEnabled }
                  : {}),
            }),
          }
        : {}),
    };
    await persistComposerRuntimeConfig(next);
    if (!activeThread && hasCompleteOrchestrationSelection(nextSelection)) {
      await saveProjectOrchestrationSelection(nextSelection);
    }
  }

  async function selectComposerMainAgentConfig(id: string) {
    if (!id.trim()) {
      return;
    }
    await applyComposerOrchestrationSelection({ mainAgentConfigId: id });
  }

  async function selectComposerMainPrompt(selection: MainAgentPromptSelection) {
    await applyComposerOrchestrationSelection({ mainPrompt: selection });
  }

  async function selectComposerSubagents(selection: SubagentSelection) {
    await applyComposerOrchestrationSelection({ subagents: selection });
  }

  async function selectComposerAuxiliaryModel(selection: AuxiliaryModelSelection) {
    if (!composerRuntimeConfig || !canEditComposerConfig || !window.eco?.saveWorkflowSettings) {
      return;
    }
    await persistComposerRuntimeConfig({ ...composerRuntimeConfig, auxiliaryModel: selection });
    try {
      const saved = await window.eco.saveWorkflowSettings({
        ...workflowSettings,
        defaultAuxiliaryModel: selection,
      });
      setWorkflowSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function selectComposerVisionModel(selection: VisionModelSelection) {
    if (!composerRuntimeConfig || !canEditComposerConfig || !window.eco?.saveWorkflowSettings) {
      return;
    }
    await persistComposerRuntimeConfig({ ...composerRuntimeConfig, visionModel: selection });
    try {
      const saved = await window.eco.saveWorkflowSettings({
        ...workflowSettings,
        defaultVisionModel: selection,
      });
      setWorkflowSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function selectComposerMainAgentModel(override: MainAgentModelOverride | undefined) {
    if (!composerRuntimeConfig || !canEditComposerConfig) {
      return;
    }
    if (
      override &&
      !resolveMainAgentModelOverrideForProvider(templateMainModel?.providerId, override)
    ) {
      setError(t("app.modelBackendMismatch"));
      return;
    }
    const { mainAgentModelOverride: _currentOverride, ...baseRuntimeConfig } = composerRuntimeConfig;
    const next: ThreadRuntimeConfig = {
      ...baseRuntimeConfig,
      ...(override ? { mainAgentModelOverride: override } : {}),
    };
    await persistComposerRuntimeConfig(next);
  }

  async function toggleComposerSubagent(role: SubagentRole, enabled: boolean) {
    if (!composerRuntimeConfig) {
      return;
    }
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      subagentEnabled: { ...composerRuntimeConfig.subagentEnabled, [role]: enabled },
    };
    await persistComposerRuntimeConfig(next);
  }

  async function toggleComposerMcpServer(serverKey: string, enabled: boolean) {
    if (!composerRuntimeConfig || !currentProjectPath) {
      return;
    }
    const nextMcpServersEnabled = { ...composerMcpSettings, [serverKey]: enabled };
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      mcpServersEnabled: nextMcpServersEnabled,
    };
    await persistComposerRuntimeConfig(next, { persistWhileRunning: true });
    if (!window.eco) {
      return;
    }
    try {
      const saved = await window.eco.saveProjectMcpSettings({
        workspacePath: currentProjectPath,
        enabledByServer: nextMcpServersEnabled,
      });
      setProjectMcpSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function toggleComposerIntegration(
    integrationId: "browser" | "imageGeneration",
    enabled: boolean,
  ) {
    if (!composerRuntimeConfig || !currentProjectPath || !window.eco) return;
    const nextEnabled = { ...composerIntegrationSettings, [integrationId]: enabled };
    await persistComposerRuntimeConfig(
      { ...composerRuntimeConfig, integrationsEnabled: nextEnabled },
      { persistWhileRunning: true },
    );
    try {
      const saved = await window.eco.saveProjectIntegrationsSettings({
        workspacePath: currentProjectPath,
        enabled: nextEnabled,
      });
      setProjectIntegrationsSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function toggleComposerSkill(settingsKey: string, enabled: boolean) {
    if (!composerRuntimeConfig || !currentProjectPath) return;
    const nextSkillsEnabled = { ...composerSkillsEnabled, [settingsKey]: enabled };
    await persistComposerRuntimeConfig(
      { ...composerRuntimeConfig, skillsEnabled: nextSkillsEnabled },
      { persistWhileRunning: true },
    );
    if (!window.eco) return;
    try {
      const saved = await window.eco.saveProjectSkillsSettings({
        workspacePath: currentProjectPath,
        enabledByPath: nextSkillsEnabled,
      });
      setProjectSkillsSettings(saved);
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

  async function saveDefaultOrchestrationSelection(selection: OrchestrationSelection | undefined) {
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const nextWorkflowSettings: WorkflowSettingsSnapshot = {
        ...workflowSettings,
      };
      if (selection && hasCompleteOrchestrationSelection(selection)) {
        nextWorkflowSettings.defaultOrchestrationSelection = selection;
      } else {
        delete nextWorkflowSettings.defaultOrchestrationSelection;
      }
      const saved = await window.eco.saveWorkflowSettings(nextWorkflowSettings);
      setWorkflowSettings(saved);
      if (!activeThread && !projectOrchestrationSelection) {
        setComposerRuntimeConfig(
          selection
            ? (buildComposerDefaultConfig({
                workflowDefaults: saved,
                orchestrationSelection: selection,
              }) ?? null)
            : null,
        );
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function saveDefaultAuxiliaryModel(selection: AuxiliaryModelSelection | undefined) {
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const nextWorkflowSettings: WorkflowSettingsSnapshot = {
        ...workflowSettings,
      };
      if (selection) {
        nextWorkflowSettings.defaultAuxiliaryModel = selection;
      } else {
        delete nextWorkflowSettings.defaultAuxiliaryModel;
      }
      const saved = await window.eco.saveWorkflowSettings(nextWorkflowSettings);
      setWorkflowSettings(saved);
      if (!activeThread && composerRuntimeConfig) {
        const { auxiliaryModel: _previous, ...baseRuntimeConfig } = composerRuntimeConfig;
        setComposerRuntimeConfig({
          ...baseRuntimeConfig,
          ...(selection ? { auxiliaryModel: selection } : {}),
        });
      } else if (!activeThread && !composerRuntimeConfig && selection) {
        const next = buildComposerDefaultConfig({
          workflowDefaults: saved,
        });
        if (next) {
          setComposerRuntimeConfig(next);
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function saveDefaultVisionModel(selection: VisionModelSelection | undefined) {
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const nextWorkflowSettings: WorkflowSettingsSnapshot = {
        ...workflowSettings,
      };
      if (selection) {
        nextWorkflowSettings.defaultVisionModel = selection;
      } else {
        delete nextWorkflowSettings.defaultVisionModel;
      }
      const saved = await window.eco.saveWorkflowSettings(nextWorkflowSettings);
      setWorkflowSettings(saved);
      if (!activeThread && composerRuntimeConfig) {
        const { visionModel: _previous, ...baseRuntimeConfig } = composerRuntimeConfig;
        setComposerRuntimeConfig({
          ...baseRuntimeConfig,
          ...(selection ? { visionModel: selection } : {}),
        });
      } else if (!activeThread && !composerRuntimeConfig && selection) {
        const next = buildComposerDefaultConfig({
          workflowDefaults: saved,
        });
        if (next) {
          setComposerRuntimeConfig(next);
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function saveProjectOrchestrationSelection(
    selection: OrchestrationSelection,
  ): Promise<void> {
    if (
      !window.eco?.saveProjectOrchestrationSettings ||
      !currentProjectPath ||
      !hasCompleteOrchestrationSelection(selection)
    ) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const saved = await window.eco.saveProjectOrchestrationSettings({
        workspacePath: currentProjectPath,
        orchestrationSelection: selection,
      });
      setProjectOrchestrationSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function saveDefaultCoreKind(coreKind: CoreKind) {
    if (!window.eco?.saveWorkflowSettings) {
      return;
    }
    setIsSavingSettings(true);
    setError(undefined);
    try {
      const saved = await window.eco.saveWorkflowSettings({
        ...workflowSettings,
        defaultCoreKind: coreKind,
      });
      setWorkflowSettings(saved);
      if (!activeThread) {
        setNewThreadCoreKind(saved.defaultCoreKind ?? "claude");
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
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
    selectedThreadIdRef.current = undefined;
    setSelectedThreadId(undefined);
    setComposerRuntimeConfig(null);
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
    const leavingThread = Boolean(selectedThreadIdRef.current);
    const sameProject = nextPath === currentProjectPath || nextPath === selectedProjectPath;
    setSelectedProjectPath(nextPath);
    selectedThreadIdRef.current = undefined;
    setSelectedThreadId(undefined);
    setComposerRewindTarget(undefined);
    if (!sameProject) {
      // Different project: drop in-memory config so project/default defaults load.
      setComposerRuntimeConfig(null);
    } else if (leavingThread) {
      // Same project, leaving a real thread → project/default composition.
      resetComposerDefaultConfig();
    }
    // Same project while already on landing: keep composerRuntimeConfig (new-chat affordance).
  }

  function requestSidebarReveal(kind: "project" | "thread", id: string) {
    setSidebarRevealTarget((current) => ({ kind, id, requestId: (current?.requestId ?? 0) + 1 }));
  }

  function selectSearchProject(projectPath: string) {
    switchProject(projectPath);
    setCollapsedProjectPaths((current) => {
      if (!current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.delete(projectPath);
      window.localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    requestSidebarReveal("project", projectPath);
  }

  function selectThread(thread: ThreadSummary) {
    setUnreadThreadIds((current) => {
      if (!current.has(thread.id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(thread.id);
      window.localStorage.setItem(unreadThreadsStorageKey, JSON.stringify([...next]));
      return next;
    });
    selectedThreadIdRef.current = thread.id;
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
    const projectThreads = threadsByProject.get(thread.workspacePath) ?? [];
    const threadIndex = projectThreads.findIndex((item) => item.id === thread.id);
    if (threadIndex >= sidebarThreadsCollapsed) {
      expandProjectThreads(thread.workspacePath);
    }
  }

  function selectSearchThread(thread: ThreadSummary) {
    selectThread(thread);
    requestSidebarReveal("thread", thread.id);
  }

  function clearThreadClientState(threadId: string) {
    clearLocalStreamUpdates(threadId);
    removeComposerDraft(`thread:${threadId}`);
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    setUnreadThreadIds((current) => {
      if (!current.has(threadId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(threadId);
      window.localStorage.setItem(unreadThreadsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setSelectedThreadId((current) => (current === threadId ? undefined : current));
    if (selectedThreadId === threadId) {
      resetComposerDefaultConfig();
      setComposerRewindTarget(undefined);
    }
    setRunProjectionByThread((current) => removeRecordKey(current, threadId));
    setFeedEarlierByThread((current) => removeRecordKey(current, threadId));
    setSubagentTimingsByThread((current) => removeRecordKey(current, threadId));
    setSubagentMetricsByThread((current) => removeRecordKey(current, threadId));
    setUsageByThread((current) => removeRecordKey(current, threadId));
    setBillingByThread((current) => removeRecordKey(current, threadId));
    setContextByThread((current) => removeRecordKey(current, threadId));
    setModelByThread((current) => removeRecordKey(current, threadId));
    setTodosByThread((current) => removeRecordKey(current, threadId));
    setFollowUpsByThread((current) => removeRecordKey(current, threadId));
    clearPendingPlanForThread(threadId);
    setApprovedPlansByThread((current) => removeRecordKey(current, threadId));
    clearPendingClarificationForThread(threadId);
    clearPendingBashApprovalForThread(threadId);
  }

  async function deleteThread(thread: ThreadSummary) {
    if (!window.eco) {
      return;
    }
    if (thread.status === "running" || thread.status === "queued") {
      setError(t("thread.stopFirst"));
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
    const leavingThread = Boolean(selectedThreadIdRef.current);
    setComposerRoutePopoverOpen(false);
    removeComposerDraft(composerContextKeyFromParts(undefined, currentProjectPath));
    selectedThreadIdRef.current = undefined;
    setSelectedThreadId(undefined);
    setNewThreadCoreKind(workflowSettings.defaultCoreKind ?? "claude");
    // Already on an unstarted landing composer: keep orchestration / model edits.
    // Only reset when leaving an existing thread into a new landing surface.
    if (leavingThread) {
      resetComposerDefaultConfig();
    }
    setEditingFollowUpId(undefined);
    setPrompt("");
    setComposerRewindTarget(undefined);
    setComposerAttachments([]);
    setComposerImageNotice(undefined);
    setError(undefined);
  }

  async function addComposerImageFiles(files: FileList | File[]) {
    if (!canPasteComposerImages) {
      setComposerImageNotice(t("app.imageUnsupported"));
      return;
    }
    if (plannerCapability && !plannerCapability.capabilitiesResolved) {
      setComposerImageNotice(t("app.imageCapabilityUnknown"));
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

  const showLanding = !activeThread;
  const showWorkspacePanel = Boolean(currentProjectPath);
  useEffect(() => {
    if (window.eco?.platform !== "win32" && window.eco?.platform !== "linux") {
      return;
    }
    void window.eco.setWindowTitlebarMode(showLanding ? "landing" : "conversation");
  }, [showLanding]);
  const workspaceCardsLayoutMode = workspacePanelLayoutForMode(activityWorkspaceLayoutMode);
  const workspaceCardsPanelOpen = Boolean(showWorkspacePanel && workspacePanelResolvedOpen);
  useEffect(() => {
    if (showWorkspacePanel) {
      void refreshGitStatus();
    }
  }, [showWorkspacePanel, workspaceCardsPanelOpen, activeThread?.id, refreshGitStatus]);
  const workspaceCardsDockedLayout = Boolean(
    workspaceCardsPanelOpen && !showLanding && workspaceCardsLayoutMode === "docked",
  );
  const taskPanelOpen = Boolean(showWorkspacePanel && taskDrawerOpen);
  const taskPanelLayoutOpen = Boolean(showWorkspacePanel && taskPanelLayoutPresent);
  const taskPanelFullscreenOpen = Boolean(taskPanelLayoutOpen && taskPanelFullscreen);
  const taskPanelPhase = resolveTaskPanelLayoutPhase({
    layoutPresent: taskPanelLayoutOpen,
    exiting: taskPanelExiting,
    fullscreen: taskPanelFullscreenOpen,
  });
  const chromeFsSlotOpen = taskPanelPhase === "open" || taskPanelPhase === "fullscreen";
  const activityUserMessageNavHidden = !activityMessageNavSpaceVisible;
  const activityFeedPanelLayout = activityWorkspaceLayoutMode === "feed-panel";
  const showWorkspaceActionGroupA = shouldShowWorkspaceActionGroupA({
    settingsOpen,
    showWorkspacePanel,
  });
  const showPanelChromeGroupB = shouldShowPanelChromeGroupB({
    settingsOpen,
    showWorkspacePanel,
  });
  const rightPanelStyle = {
    "--workspace-panel-width": `${WORKSPACE_CARDS_PANEL_WIDTH_PX}px`,
    "--workspace-cards-panel-width": `${WORKSPACE_CARDS_PANEL_WIDTH_PX}px`,
    "--workspace-cards-panel-gap": `${WORKSPACE_CARDS_RESPONSIVE_GAP_PX}px`,
    "--task-panel-width": `${taskPanelWidth}px`,
    ...(showPanelChromeGroupB ? panelChromeCssVariables({ fullscreenSlotOpen: chromeFsSlotOpen }) : {}),
  } as CSSProperties;
  const toggleTaskPanelFullscreen = useCallback(() => {
    if (window.matchMedia(taskPanelNarrowMediaQuery).matches) {
      setTaskPanelFullscreen(false);
      return;
    }
    setTaskPanelFullscreen((current) => !current);
  }, []);

  // B group (ChromeStrip): top-only MainPane overlay — never mounts on settings.
  const panelControlButtons = showPanelChromeGroupB ? (
    <div
      className="codex-main-pane-panel-actions"
      data-group="chrome"
      aria-label={t("app.workspaceControls")}
    >
      <span
        className={[
          "codex-main-pane-panel-action-slot",
          // Open only while docked; collapse as soon as exit reflow starts so the slot
          // motion runs with the panel (not after the spring settles).
          taskPanelLayoutOpen && !taskPanelExiting ? "is-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden={!taskPanelLayoutOpen || taskPanelExiting}
      >
        <button
          type="button"
          className={
            taskPanelFullscreenOpen
              ? "codex-main-toolbar-button is-active codex-main-topbar-fullscreen"
              : "codex-main-toolbar-button codex-main-topbar-fullscreen"
          }
          onClick={toggleTaskPanelFullscreen}
          title={
            taskPanelFullscreenOpen ? t("task.exitFullscreenTitle") : t("task.enterFullscreen")
          }
          aria-label={
            taskPanelFullscreenOpen ? t("task.exitFullscreen") : t("task.enterFullscreen")
          }
          aria-pressed={taskPanelFullscreenOpen}
          tabIndex={taskPanelLayoutOpen && !taskPanelExiting ? 0 : -1}
          disabled={!taskPanelLayoutOpen || taskPanelExiting}
        >
          {taskPanelFullscreenOpen ? (
            <Minimize2 size={15} aria-hidden />
          ) : (
            <Maximize2 size={15} aria-hidden />
          )}
        </button>
      </span>
      <button
        type="button"
        className={
          currentTerminalState?.open ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"
        }
        onClick={toggleTerminalForCurrentProject}
        title={`${currentTerminalState?.open ? t("app.terminalClose") : t("app.terminalOpen")} (Ctrl+\`)`}
        aria-label={currentTerminalState?.open ? t("app.terminalClose") : t("app.terminalOpen")}
        aria-expanded={currentTerminalState?.open === true}
        aria-controls="terminal-panel"
      >
        <PanelBottom size={15} aria-hidden />
      </button>
      <button
        type="button"
        className={taskPanelOpen ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"}
        onClick={toggleTaskPanelForCurrentProject}
        title={taskPanelOpen ? t("app.taskSidebarCollapse") : t("app.taskSidebarOpen")}
        aria-label={taskPanelOpen ? t("app.taskSidebarCollapse") : t("app.taskSidebarOpen")}
        aria-expanded={taskPanelOpen}
        aria-controls="task-panel"
      >
        <PanelRight size={15} aria-hidden />
      </button>
    </div>
  ) : null;

  // A group (workspace): web chat + workpanel — rides the feed topbar. Hidden on settings.
  const workspaceTopbarActions = showWorkspaceActionGroupA ? (
    <div className="codex-main-topbar-actions" aria-label={t("app.workspaceControls")}>
      <div className="codex-main-topbar-action-group" data-group="workspace">
        <button
          ref={webChatListAnchorRef}
          type="button"
          className={
            webChatListOpen ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"
          }
          onClick={() => setWebChatListOpen((open) => !open)}
          title={t("app.webChat.openList")}
          aria-label={t("app.webChat.openList")}
          aria-expanded={webChatListOpen}
          aria-haspopup="dialog"
        >
          <MessageSquare size={15} aria-hidden />
        </button>
        <WebChatListPopover
          open={webChatListOpen}
          items={webChatList.items}
          anchorRef={webChatListAnchorRef}
          onClose={() => setWebChatListOpen(false)}
          onSelect={openWebChatItem}
          onListChange={setWebChatList}
        />
        <button
          type="button"
          className={
            workspaceCardsPanelOpen ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"
          }
          onClick={toggleWorkspacePanelForCurrentProject}
          title={workspaceCardsPanelOpen ? t("app.workspaceCardsCollapse") : t("app.workspaceCardsOpen")}
          aria-label={workspaceCardsPanelOpen ? t("app.workspaceCardsCollapse") : t("app.workspaceCardsOpen")}
          aria-expanded={workspaceCardsPanelOpen}
          aria-controls="workspace-cards-panel"
        >
          <SlidersHorizontal size={15} aria-hidden />
        </button>
      </div>
    </div>
  ) : null;
  const taskPanelNode =
    showWorkspacePanel && taskPanelLayoutOpen ? (
      <motion.aside
        id="task-panel-container"
        className={["workspace-panel", "is-task-panel-mode", taskPanelFullscreenOpen ? "is-fullscreen" : ""]
          .filter(Boolean)
          .join(" ")}
        aria-label={taskPanelFullscreenOpen ? t("app.taskPanelFullscreen") : t("app.taskPanel")}
        aria-hidden={!taskPanelOpen}
        initial={false}
        animate={taskPanelAnimationControls}
        style={{ willChange: "transform, opacity" }}
      >
        <hr
          className="task-panel-resize-handle"
          aria-label={t("app.taskPanelResize")}
          aria-orientation="vertical"
          tabIndex={0}
          title={t("app.dragResize")}
          onMouseDown={handleTaskPanelResizeMouseDown}
          onKeyDown={handleTaskPanelResizeKeyDown}
        />
        <SubagentTaskDrawer
          open={taskPanelLayoutOpen}
          surfaceActive={taskPanelOpen && !taskPanelExiting}
          fullscreen={taskPanelFullscreenOpen}
          cards={activeSubagentCards}
          {...(taskPanelPlan && { plan: taskPanelPlan })}
          activeTab={taskPanelActiveTab}
          openTabIds={openTaskPanelTabIds}
          {...(runProjection && { projection: runProjection })}
          {...(activeThread && { threadStatus: activeThread.status })}
          agentDisplayNames={activeRuntimeAgentDisplayNames}
          agentThemes={activeRuntimeAgentThemes}
          backgroundTasks={backgroundTerminalTasks}
          imageArtifacts={activeThread ? imageArtifactsByThread[activeThread.id] ?? [] : []}
          onSelectImageArtifact={openImageGenerationArtifact}
          {...(reviewDiff && { reviewDiff })}
          reviewLoading={reviewDiffLoading}
          {...(reviewDiffError && { reviewError: reviewDiffError })}
          {...(reviewSelectedPath && { reviewSelectedPath })}
          onSelectAgent={(agentId) => {
            setTaskPanelActiveTab(agentId);
            setSelectedSubagentAgentId(agentId);
          }}
          onSelectPlan={() => {
            setOpenTaskPanelTabIds((current) =>
              addOpenTaskPanelTab(current, TASK_PANEL_PLAN_TAB_ID),
            );
            setTaskPanelActiveTab(TASK_PANEL_PLAN_TAB_ID);
            setSelectedSubagentAgentId(undefined);
          }}
          onCloseTab={closeTaskPanelTab}
          onSelectBackgroundTasks={() => {
            setOpenTaskPanelTabIds((current) =>
              addOpenTaskPanelTab(current, TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID),
            );
            setTaskPanelActiveTab(TASK_PANEL_BACKGROUND_TERMINAL_TAB_ID);
            setSelectedSubagentAgentId(undefined);
          }}
          onSelectReview={() => {
            setOpenTaskPanelTabIds((current) =>
              addOpenTaskPanelTab(current, TASK_PANEL_REVIEW_TAB_ID),
            );
            setTaskPanelActiveTab(TASK_PANEL_REVIEW_TAB_ID);
            setSelectedSubagentAgentId(undefined);
            void refreshReviewDiff();
          }}
          workspacePath={currentProjectPath ?? ""}
          {...(fileTarget && { fileTarget })}
          onSelectFiles={() => {
            setOpenTaskPanelTabIds((current) =>
              addOpenTaskPanelTab(current, TASK_PANEL_FILES_TAB_ID),
            );
            setTaskPanelActiveTab(TASK_PANEL_FILES_TAB_ID);
            setSelectedSubagentAgentId(undefined);
          }}
          onSelectFileViewer={() => {
            setOpenTaskPanelTabIds((current) =>
              addOpenTaskPanelTab(current, TASK_PANEL_FILE_VIEWER_TAB_ID),
            );
            setTaskPanelActiveTab(TASK_PANEL_FILE_VIEWER_TAB_ID);
            setSelectedSubagentAgentId(undefined);
          }}
          onSelectBrowser={(browserId) => {
            openBrowserTaskPanel(browserId);
          }}
          browserInstances={(browserViewState?.instances ?? []).map((instance) => ({
            id: instance.id,
            title: instance.title,
            url: instance.url,
            ...(instance.faviconUrl ? { faviconUrl: instance.faviconUrl } : {}),
          }))}
          onViewedFileChange={(target) => {
            fileReferenceRequestIdRef.current = Math.max(
              fileReferenceRequestIdRef.current,
              target.requestId,
            );
            setFileTarget(target);
          }}
          onOpenTerminal={() => {
            toggleTerminalForCurrentProject();
            dismissTaskPanel();
          }}
          onShowHome={() => {
            setTaskPanelActiveTab(TASK_PANEL_HOME_TAB_ID);
            setSelectedSubagentAgentId(undefined);
          }}
          onSelectReviewPath={setReviewSelectedPath}
          onOpenTerminalTask={(task) => void openBackgroundTerminalTask(task)}
          onStopTerminalTask={(task) => void stopBackgroundTerminalTask(task)}
        />
      </motion.aside>
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
    workspaceCardsPanelOpen,
    workspaceCardsLayoutMode,
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
  const shellClassName = [
    "shell",
    settingsOpen ? "shell-settings-open" : "",
    sidebarOpen ? "" : "shell-sidebar-hidden",
  ]
    .filter(Boolean)
    .join(" ");
  const composerPlaceholder = showClarification
    ? t("thread.composer.answerQuestion")
    : showBashApproval
      ? t("thread.composer.approveTool")
      : showPlanApproval
        ? t("thread.composer.approvePlan")
        : contextCompactionInFlight
          ? t("thread.composer.compacting")
          : activeThread?.status === "awaiting_plan"
            ? t("thread.composer.confirmPlan")
            : activeThread && isContinuableThreadStatus(activeThread.status)
              ? t("thread.composer.continue")
              : composerFollowUpMode
                ? editingFollowUpId
                  ? t("thread.composer.editFollowUp")
                  : t("thread.composer.requestChanges")
                : activeThread
                  ? t("thread.composer.unavailable")
                  : t("thread.composer.placeholder");
  const composerDisabled = Boolean(activeThread && !threadAcceptsInput && !composerFollowUpMode);
  const composerActionMode = editingFollowUpId
    ? "save-follow-up"
    : canStopThread
      ? composerHasContent
        ? "queue"
        : "stop"
      : "send";
  const composerActionBusy = composerActionMode === "stop" ? cancelBusy : isStarting || followUpBusy;
  const composerActionDisabled = composerActionMode === "stop" ? cancelBusy : !canSend;
  const composerActionLabel =
    composerActionMode === "stop"
      ? t("thread.action.stop")
      : composerActionMode === "queue"
        ? t("thread.action.queue")
        : composerActionMode === "save-follow-up"
          ? t("thread.action.saveFollowUp")
          : t("thread.action.send");
  const composerActionClassName = ["send-button", composerActionMode].filter(Boolean).join(" ");
  const composerCompact = !showLanding;
  const handleAsrText = useCallback((text: string) => {
    const start = composerRef.current?.getSelectionStart() ?? composerPromptRef.current.length;
    const end = composerRef.current?.getSelectionEnd() ?? start;
    const merged = mergeAsrTextAtSelection(composerPromptRef.current, text, start, end);
    composerPromptRef.current = merged.prompt;
    setPrompt(merged.prompt);
    requestAnimationFrame(() => composerRef.current?.setCursor(merged.cursor));
  }, []);
  const handleAsrSend = useCallback(
    (text: string) => {
      const start = composerRef.current?.getSelectionStart() ?? composerPromptRef.current.length;
      const end = composerRef.current?.getSelectionEnd() ?? start;
      const merged = mergeAsrTextAtSelection(composerPromptRef.current, text, start, end);
      composerPromptRef.current = merged.prompt;
      setPrompt(merged.prompt);
      requestAnimationFrame(() => composerRef.current?.setCursor(merged.cursor));
      void sendComposerMessage(merged.prompt);
    },
    [sendComposerMessage],
  );
  const handleAsrError = useCallback((message: string) => {
    showAppMessageErrorRef.current(message);
  }, []);
  const asrSession = useAsrRecorder({
    ...(asrProfiles.activeProfileId ? { activeProfileId: asrProfiles.activeProfileId } : {}),
    selectedInputDeviceId: asrProfiles.inputDeviceId ?? "",
    disabled: composerDisabled,
    onText: handleAsrText,
    onSendText: handleAsrSend,
    onError: handleAsrError,
  });

  useEffect(() => {
    if (!asrSession.active) return;
    if (composerRoutePopoverOpen) setComposerRoutePopoverOpen(false);
  }, [asrSession.active, composerRoutePopoverOpen]);

  const composerRouteControl = (
    <ComposerRoutePopover
      open={composerRoutePopoverOpen && canSwitchRouteProfile}
      settings={settings}
      busy={isSavingSettings}
      anchorRef={
        composerRouteAnchor === "model-empty" ? composerModelEmptyTriggerRef : composerPlusButtonRef
      }
      runtimeConfig={composerRuntimeConfig ?? undefined}
      onClose={() => setComposerRoutePopoverOpen(false)}
      onSelectMainAgentConfig={selectComposerMainAgentConfig}
      onSelectMainPrompt={selectComposerMainPrompt}
      onSelectSubagents={selectComposerSubagents}
      onSelectAuxiliaryModel={selectComposerAuxiliaryModel}
      onSelectVisionModel={selectComposerVisionModel}
      onOpenFullSettings={() => openModelsSettings("compositionParts")}
    />
  );

  const composerAgentModelsControl = (
    <div>
      <ComposerAgentModels
        labels={agentModelLabels}
        subagentSettings={composerRuntimeConfig?.subagentEnabled ?? defaultSubagentAvailability()}
        canEditSubagents={canEditComposerConfig}
        subagentSaving={isSavingSettings}
        compact={composerCompact}
        onToggleSubagent={(role, enabled) => void toggleComposerSubagent(role, enabled)}
      />
    </div>
  );

  const composerMcpControl = (
    <div>
      <ComposerMcpServers
        servers={mcpSettings.servers}
        enabledSettings={composerMcpSettings}
        canEdit={canEditComposerConfig}
        saving={isSavingSettings}
        compact={composerCompact}
        onToggleServer={(serverKey, enabled) => void toggleComposerMcpServer(serverKey, enabled)}
      />
    </div>
  );

  const composerIntegrationsControl = (
    <div>
      <ComposerIntegrations
        availability={integrationAvailability}
        enabledSettings={composerIntegrationSettings}
        canEdit={canEditComposerConfig}
        saving={isSavingSettings}
        compact={composerCompact}
        onToggle={(id, enabled) => void toggleComposerIntegration(id, enabled)}
      />
    </div>
  );

  const composerSkillsControl = (
    <div>
      <ComposerSkillsControl
        skills={composerAvailableSkills}
        enabledSettings={composerSkillsEnabled}
        canEdit={canEditComposerConfig}
        saving={isSavingSettings}
        compact={composerCompact}
        onToggleSkill={(settingsKey, enabled) => void toggleComposerSkill(settingsKey, enabled)}
      />
    </div>
  );

  const composerModelControl =
    composerModelAvailability === "ready" &&
    templateMainModel &&
    !(composerRoutePopoverOpen && composerRouteAnchor === "model-empty") ? (
      <ComposerModelSelector
        options={composerModelOptions}
        templateModel={templateMainModel}
        value={composerMainAgentModelOverride}
        disabled={!canEditComposerConfig || isSavingSettings}
        loading={composerModelsLoading}
        error={composerModelsError}
        onOpen={refreshComposerCandidateModels}
        onChange={(override) => void selectComposerMainAgentModel(override)}
      />
    ) : composerModelAvailability === "no-provider" ? (
      <ComposerModelEmptyTrigger
        state="no-provider"
        onAction={openProviderSettings}
      />
    ) : (
      <ComposerModelEmptyTrigger
        state="no-orchestration"
        buttonRef={composerModelEmptyTriggerRef}
        disabled={!canSwitchRouteProfile || isSavingSettings}
        onAction={openComposerOrchestrationChooser}
      />
    );

  const showComposerContextOverlays = showLanding && !asrSession.active;
  const showComposerInputOverlays =
    displayedQueuedFollowUps.length > 0 ||
    composerAttachments.length > 0 ||
    showComposerContextOverlays;

  useLayoutEffect(() => {
    const overlays = composerInputOverlaysRef.current;
    if (!overlays) {
      setComposerInputOverlaysHeight(0);
      return;
    }
    const updateHeight = () => setComposerInputOverlaysHeight(Math.ceil(overlays.getBoundingClientRect().height));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(overlays);
    return () => observer.disconnect();
  }, [
    displayedQueuedFollowUps.length,
    composerAttachments.length,
    showComposerContextOverlays,
  ]);

  const composer = (
    <div
      className="codex-composer-wrap"
      style={
        {
          "--composer-input-overlays-height": `${composerInputOverlaysHeight}px`,
        } as CSSProperties
      }
    >
      {composerImageNotice && <p className="composer-image-notice">{composerImageNotice}</p>}
      {composerPromptCacheHint ? (
        <p className="composer-prompt-cache-hint" role="status">
          {composerPromptCacheHint}
        </p>
      ) : null}
      {activeThread && threadIdleCacheWarningEligible ? (
        <ThreadIdleCacheWarning
          lastActivityAt={threadIdleCacheWarningActivityAt}
          onStartNewThread={startNewChat}
        />
      ) : null}
      <div className="composer-input-stack">
        {showComposerInputOverlays ? (
          <div ref={composerInputOverlaysRef} className="composer-input-overlays">
            {displayedQueuedFollowUps.length > 0 ? (
              <FollowUpQueuePanel
                followUps={displayedQueuedFollowUps}
                cancelBusyId={followUpCancelBusyId}
                escalateBusyId={followUpEscalateBusyId}
                onCancel={(followUp) => void cancelQueuedFollowUp(followUp)}
                onEscalate={(followUp) => void escalateQueuedFollowUp(followUp)}
                onEdit={startEditingFollowUp}
                onReorder={(followUpIds) => void reorderQueuedFollowUps(followUpIds)}
              />
            ) : null}
            {composerAttachments.length > 0 ? (
              <ul className="composer-attachments" aria-label={t("app.pastedImages")}>
                {composerAttachments.map((attachment) => (
                  <li key={attachment.id} className="composer-attachment">
                    <img src={attachment.previewUrl} alt="" />
                    <button
                      type="button"
                      className="composer-attachment-remove"
                      aria-label={t("app.removeImage")}
                      onClick={() => removeComposerAttachment(attachment.id)}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {showComposerContextOverlays ? (
              <div className="composer-context-bar">
                {composerAgentModelsControl}
                {composerMcpControl}
                {composerIntegrationsControl}
                {composerSkillsControl}
              </div>
            ) : null}
          </div>
        ) : null}
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
              onOpenInPanel={openPlanTaskDrawer}
            />
          ) : showClarification && pendingClarification ? (
            <ClarificationPanel
              request={pendingClarification}
              busy={clarificationBusy}
              variant="dock"
              onSubmit={submitClarificationAnswers}
              onDismiss={() => void dismissPendingClarification()}
            />
          ) : null
        }
        composer={
          asrSession.active ? (
            <div
              className={["codex-composer", "is-voice-recording", composerCompact ? "is-compact" : ""]
                .filter(Boolean)
                .join(" ")}
              ref={composerAnchorRef}
            >
              <AsrVoiceComposer session={asrSession} />
            </div>
          ) : (
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
                    composerPromptRef.current = next;
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
                  <div className="composer-footer-row composer-footer-config-row">
                    <ComposerPlusMenu
                      buttonRef={composerPlusButtonRef}
                      sessionMode={composerRuntimeConfig?.sessionMode ?? "agent"}
                      canEditMode={canEditComposerConfig}
                      canOpenRoute={canSwitchRouteProfile && !isSavingSettings}
                      saving={isSavingSettings}
                      onSelectMode={(mode) => void selectComposerSessionMode(mode)}
                      onPickImage={() => composerImageInputRef.current?.click()}
                      onOpenRoute={() => {
                        openComposerRoutePopover("plus");
                      }}
                      onOpenChange={(open) => {
                        if (open) {
                          setComposerRoutePopoverOpen(false);
                        }
                      }}
                    />
                    {composerRuntimeConfig &&
                    (composerRuntimeConfig.sessionMode === "plan" ||
                      composerRuntimeConfig.sessionMode === "ask") ? (
                      <ComposerSessionModeTag
                        mode={composerRuntimeConfig.sessionMode}
                        {...(canEditComposerConfig && !isSavingSettings
                          ? {
                              onClose: () => {
                                void selectComposerSessionMode("agent");
                              },
                            }
                          : {})}
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
                  <div className="composer-footer-spacer" aria-hidden />
                  {composerRouteControl}
                  <input
                    ref={composerImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="composer-image-file-input"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(event) => {
                      const files = event.target.files;
                      if (files && files.length > 0) {
                        void addComposerImageFiles(files);
                      }
                      event.target.value = "";
                    }}
                  />
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
                      agentModelLabels={agentModelLabels}
                    />
                  ) : null}
                  {composerModelControl}
                  <AsrMicButton session={asrSession} disabled={composerDisabled} />
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
                      <Activity size={COMPOSER_SEND_ICON_PX} strokeWidth={ICON_STROKE} />
                    ) : composerActionMode === "stop" ? (
                      <Square size={COMPOSER_SEND_ICON_PX} strokeWidth={ICON_STROKE} />
                    ) : composerActionMode === "queue" ? (
                      <CornerDownRight size={COMPOSER_SEND_ICON_PX} strokeWidth={ICON_STROKE} />
                    ) : (
                      <ArrowUp size={COMPOSER_SEND_ICON_PX} strokeWidth={ICON_STROKE} />
                    )}
                  </button>
                </div>
                {error && (
                  <p className="composer-error">
                    <CircleAlert size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} /> {error}
                  </p>
                )}
                {!routesReady && !composerFollowUpMode && (
                  <p className="composer-hint">
                    {composerModelAvailability === "no-orchestration" ? (
                      <>
                        {t("composer.hint.noOrchestrationPrefix")}{" "}
                        <button
                          type="button"
                          className="link-button"
                          disabled={!canSwitchRouteProfile || isSavingSettings}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openComposerOrchestrationChooser();
                          }}
                        >
                          {t("composer.hint.noOrchestrationAction")}
                        </button>
                        {t("composer.hint.noOrchestrationSuffix")}
                      </>
                    ) : (
                      <>
                        {t(
                          composerModelAvailability === "no-provider"
                            ? "composer.hint.noProviderPrefix"
                            : "thread.configureModelsPrefix",
                        )}{" "}
                        <button type="button" className="link-button" onClick={openProviderSettings}>
                          {t("settings.providers")}
                        </button>{" "}
                        {t(
                          composerModelAvailability === "no-provider"
                            ? "composer.hint.noProviderSuffix"
                            : "thread.configureModelsSuffix",
                        )}
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>
          )
        }
        />
      </div>
    </div>
  );

  const isMacWindowChrome = window.eco?.platform === "darwin";

  // Electron: sibling `no-drag` cannot punch another element's drag region.
  // Keep controls inside a dedicated drag root, and leave a chrome gap in the sidebar.
  // Windows uses WCO (titleBarOverlay); macOS uses hiddenInset; Linux keeps a native frame.
  const windowSidebarToolbar = (
    <div className={isMacWindowChrome ? "macos-window-chrome-root" : "window-sidebar-chrome-root"}>
      <div className={isMacWindowChrome ? "macos-window-toolbar" : "window-sidebar-toolbar"}>
        <button
          type="button"
          className="codex-main-toolbar-button"
          onClick={() => setSidebarOpen((current) => !current)}
          title={sidebarOpen ? t("app.sidebarCollapse") : t("app.sidebarOpen")}
          aria-label={sidebarOpen ? t("app.sidebarCollapse") : t("app.sidebarOpen")}
          aria-expanded={sidebarOpen}
          aria-controls="primary-sidebar"
        >
          <PanelLeft size={15} aria-hidden />
        </button>
        {!sidebarOpen ? (
          <>
            <button
              type="button"
              className={
                sidebarSearchOpen ? "codex-main-toolbar-button is-active" : "codex-main-toolbar-button"
              }
              onClick={() => setSidebarSearchOpen((current) => !current)}
              title={t("nav.search")}
              aria-label={t("nav.search")}
              aria-expanded={sidebarSearchOpen}
              aria-haspopup="dialog"
            >
              <Search size={15} aria-hidden />
            </button>
            {activeThread ? (
              <button
                type="button"
                className="codex-main-toolbar-button is-narrow-new-thread"
                onClick={startNewChat}
                title={t("nav.newThread")}
                aria-label={t("nav.newThread")}
              >
                <MessageCirclePlus size={15} aria-hidden />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <main className={shellClassName}>
      {windowSidebarToolbar}
      {appMessageState ? (
        <AppMessage
          kind={appMessageState.kind}
          message={appMessageState.message}
          onDismiss={dismissAppMessage}
        />
      ) : null}
      <DesktopUpdateBanner
        state={desktopUpdateBannerDismissed ? undefined : desktopUpdateState}
        onCheck={() => {
          void window.eco?.checkDesktopForUpdates();
        }}
        onDownload={() => {
          void window.eco?.downloadDesktopUpdate();
        }}
        onInstall={() => {
          void window.eco?.installDesktopUpdate();
        }}
        onOpenRelease={() => {
          void window.eco?.openDesktopReleasePage();
        }}
        onDismiss={() => setDesktopUpdateBannerDismissed(true)}
      />
      <button
        type="button"
        className={[
          "responsive-sidebar-backdrop",
          sidebarOpen ? "is-visible" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setSidebarOpen(false)}
        aria-label={t("app.sidebarCollapse")}
        tabIndex={sidebarOpen ? 0 : -1}
        aria-hidden={!sidebarOpen}
      />
      <aside
        id="primary-sidebar"
        className="codex-sidebar"
        aria-hidden={!sidebarOpen || settingsOpen}
        inert={!sidebarOpen || settingsOpen ? true : undefined}
      >
        <div className="codex-sidebar-chrome" aria-hidden>
          <div className="codex-sidebar-chrome-drag" />
        </div>
        <div className="codex-sidebar-body-drag">
          <SidebarCoreSelector
            coreKind={activeThread ? activeThread.coreKind : newThreadCoreKind}
            locked={Boolean(activeThread)}
            busy={isStarting}
            codexAvailable={coreAvailability?.codex.available !== false}
            {...(coreAvailability?.codex.reason && {
              codexUnavailableReason: coreAvailability.codex.reason,
            })}
            attentionItems={attentionItems}
            onChange={setNewThreadCoreKind}
            onOpenSearch={() => setSidebarSearchOpen(true)}
            onSelectAttentionThread={(threadId) => {
              const thread = threads.find((item) => item.id === threadId);
              if (thread) {
                selectSearchThread(thread);
              }
            }}
          />
          <button type="button" className="sidebar-action" onClick={startNewChat}>
            <MessageCirclePlus size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
            {t("nav.newThread")}
          </button>
          <button type="button" className="sidebar-action muted" onClick={openWorkspace} disabled={isOpening}>
            {isOpening ? (
              <LoaderCircle size={ICON_SIZE.md} strokeWidth={ICON_STROKE} className="spinning" aria-hidden />
            ) : (
              <FolderOpen size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
            )}
            {isOpening ? t("nav.opening") : t("nav.openProject")}
          </button>

          <div className="sidebar-section sidebar-section-grow">
            <ProjectSidebarTree
              projectTree={projectTree}
              currentProjectPath={currentProjectPath}
              activeThreadId={activeThread?.id}
              revealTarget={sidebarRevealTarget}
              unreadThreadIds={unreadThreadIds}
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
            {t("nav.settings")}
          </button>
        </div>
      </aside>

      <SidebarSearchDialog
        open={sidebarSearchOpen}
        threads={sidebarSearchThreads}
        projects={projects}
        onClose={() => setSidebarSearchOpen(false)}
        onSelectThread={selectSearchThread}
        onSelectProject={selectSearchProject}
      />

      <section
        className={[
          "codex-main",
          showLanding ? "codex-main-landing" : "",
          currentProjectPath ? "codex-main-has-toolbar" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          ref={mainPaneRef}
          className={[
            "codex-main-pane",
            showPanelChromeGroupB ? "has-panel-chrome" : "",
            chromeFsSlotOpen ? "is-chrome-fs-slot-open" : "",
            taskPanelLayoutOpen ? "is-task-panel-open" : "",
            taskPanelExiting ? "is-task-panel-exiting" : "",
            taskPanelFullscreenOpen ? "is-task-panel-fullscreen" : "",
            taskPanelPhase !== "closed" ? `is-task-phase-${taskPanelPhase}` : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={rightPanelStyle}
        >
          <motion.div
            ref={activityWorkspaceRef}
            className={[
              "activity-workspace-shell",
              `is-${activityWorkspaceLayoutMode}`,
              workspaceCardsDockedLayout ? "has-docked-workspace-cards" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            layout={prefersReducedMotion ? false : "size"}
            transition={{ layout: { type: "spring", bounce: 0, duration: 0.36 } }}
            style={{ transformOrigin: "left center" }}
          >
          <div
            className={[
              "codex-main-scroll",
              showWorkspacePanel ? "has-workspace-panel" : "",
              workspaceCardsDockedLayout ? "is-workspace-cards-docked" : "",
              activityFeedPanelLayout ? "is-feed-panel-layout" : "",
              !showLanding && currentProjectPath && !topbarSolid ? "is-topbar-clear" : "",
              !showLanding && currentProjectPath && topbarSolid ? "is-topbar-solid" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {currentProjectPath ? (
              <header
                ref={topbarRef}
                className={["codex-main-topbar", showLanding || topbarSolid ? "is-solid" : "is-clear"]
                  .filter(Boolean)
                  .join(" ")}
              >
                {/* Keep the titlebar topology stable across landing and conversation states. */}
                {activeThread ? (
                  <div className="activity-header">
                    <h2 title={activeThread.title}>{activeThread.title}</h2>
                    {canRegenerateThreadTitle(
                      activeThread.title,
                      titleGeneratingThreadIds.has(activeThread.id),
                    ) ? (
                      <button
                        type="button"
                        className="activity-header-regenerate-title"
                        title={t("thread.regenerateTitle")}
                        aria-label={t("thread.regenerateTitle")}
                        onClick={() => {
                          if (!window.eco) {
                            return;
                          }
                          void window.eco.regenerateThreadTitle(activeThread.id).catch((error) => {
                            showAppMessageError(
                              error instanceof Error ? error.message : t("thread.titleGenerationFailed"),
                            );
                          });
                        }}
                      >
                        <RefreshCw size={14} strokeWidth={2} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="activity-header is-placeholder" aria-hidden>
                    <h2 />
                  </div>
                )}
                <div className="codex-main-topbar-drag-fill" aria-hidden />
                {workspaceTopbarActions}
              </header>
            ) : null}
            <div className="codex-main-left-column">
              <div ref={scrollBodyRef} className="codex-main-scroll-body">
                {showLanding ? (
                  <div className="codex-landing">
                    <div className="codex-landing-brand">
                      <img
                        className="codex-landing-logo"
                        src="./splash-icon.png"
                        alt=""
                        width={72}
                        height={72}
                      />
                      <h1 className="codex-hero">
                        {currentProjectPath
                          ? homeProjectPath && isHomeProjectPath(currentProjectPath, homeProjectPath)
                            ? t("app.landing.home")
                            : t("app.landing.project", { project: currentProjectName })
                          : t("app.landing.openProject")}
                      </h1>
                      {showProjectSkillsPanel && composerSupportsSkills ? (
                        <ComposerSkillsBar
                          availableSkills={projectCoreSkills}
                          skillsNeedingLink={projectAgentsOnly}
                          referencedSkillNames={referencedSkillNames}
                          linking={skillsLinking}
                          {...(skillsLinkResult && { lastLinkResult: skillsLinkResult })}
                          {...(composerCoreKind === "claude" && { onLinkAgents: linkProjectAgentsSkills })}
                        />
                      ) : null}
                    </div>
                    {composer}
                  </div>
                ) : (
                  <div
                    className="codex-feed-stack"
                    style={
                      {
                        "--composer-input-overlays-height": `${composerInputOverlaysHeight}px`,
                      } as CSSProperties
                    }
                  >
                    <div className="activity-feed">
                      <div className="activity-messages-shell">
                        <div className="activity-feed-top-mask" aria-hidden />
                        <ActivityUserMessageNavigator
                          items={activityUserMessageNavItems}
                          hidden={activityUserMessageNavHidden}
                          {...(activeActivityUserMessageNavId && {
                            activeId: activeActivityUserMessageNavId,
                          })}
                          onJump={jumpToActivityUserMessage}
                        />
                        <div ref={activityMessagesRef} className="activity-messages">
                          {loadingFeedEarlier ? (
                            <div className="activity-feed-loading-earlier" aria-live="polite">
                              {t("feed.loadingEarlier")}
                            </div>
                          ) : null}
                          <ActivityLogView
                            {...(activeThread && { thread: activeThread })}
                            {...(displayProjection && { projection: displayProjection })}
                            {...(activeProjectionViewModel && { viewModel: activeProjectionViewModel })}
                            {...(activeThread &&
                              billingByThread[activeThread.id] && {
                                billing: billingByThread[activeThread.id],
                              })}
                            onRestorePrompt={restorePrompt}
                            onLoadUserMessageEdit={loadUserMessageEdit}
                            onRewriteUserMessage={rewriteUserMessage}
                            onPlannerLayoutChange={handleActivityPlannerLayoutChange}
                            {...(Object.keys(activityModelByRole).length > 0 && {
                              modelByRole: activityModelByRole,
                            })}
                            agentDisplayNames={activeRuntimeAgentDisplayNames}
                            agentThemes={activeRuntimeAgentThemes}
                            {...(taskDrawerOpen && selectedSubagentAgentId && { selectedSubagentAgentId })}
                            onOpenSubagent={openSubagentTaskDrawer}
                            onOpenImageGenerationTool={openImageGenerationTool}
                            {...(threadUsageByRole && { usageByRole: threadUsageByRole })}
                            {...(subagentTimings && { subagentTimings })}
                            {...(subagentMetrics && { subagentMetrics })}
                            {...(activeThread &&
                              contextByThread[activeThread.id] && {
                                context: contextByThread[activeThread.id],
                              })}
                          />
                          <div ref={activityEndRef} className="activity-scroll-anchor" aria-hidden />
                        </div>
                        {activityFeedScrollJump ? (
                          <button
                            type="button"
                            className="activity-feed-scroll-jump is-visible"
                            onClick={handleActivityFeedScrollJump}
                            aria-label={activityFeedScrollJump === "top" ? t("app.scrollTop") : t("app.scrollBottom")}
                            title={activityFeedScrollJump === "top" ? t("app.scrollTop") : t("app.scrollBottom")}
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
                    <div
                      key={workspacePath}
                      className="codex-terminal-project-slot"
                      hidden={!isCurrentProject}
                    >
                    <TerminalPanel
                      workspacePath={workspacePath}
                      workspaceLabel={workspaceLabel}
                      state={terminalState}
                      isCurrentProject={isCurrentProject}
                      onStateChange={(next) => updateProjectTerminal(workspacePath, next)}
                      onSessionExit={handleTerminalSessionExit}
                      sessionPresentations={terminalSessionPresentations}
                      {...(isCurrentProject && {
                        injectedSessionId: injectedTerminalSessionId,
                        onInjectedSessionConsumed: () => setInjectedTerminalSessionId(null),
                      })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
            {showWorkspacePanel ? (
            <aside
              ref={workspaceCardsPanelRef}
                id="workspace-cards-panel"
              className={[
                "workspace-panel",
                "workspace-panel--floating-cards",
                workspaceCardsPanelOpen ? "is-open" : "",
                workspaceCardsDockedLayout ? "is-docked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={t("app.workspacePanel")}
              aria-hidden={!workspaceCardsPanelOpen}
              style={
                {
                  "--workspace-terminal-height": `${currentTerminalState?.open ? currentTerminalState.height : 0}px`,
                } as CSSProperties
              }
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
                integrationAvailability={integrationAvailability}
                composerIntegrationSettings={composerIntegrationSettings}
                skills={composerAvailableSkills}
                composerSkillsEnabled={composerSkillsEnabled}
                onToggleComposerSubagent={(role, enabled) => void toggleComposerSubagent(role, enabled)}
                onToggleComposerMcpServer={(serverKey, enabled) =>
                  void toggleComposerMcpServer(serverKey, enabled)
                }
                onToggleComposerIntegration={(id, enabled) =>
                  void toggleComposerIntegration(id, enabled)
                }
                onToggleComposerSkill={(settingsKey, enabled) =>
                  void toggleComposerSkill(settingsKey, enabled)
                }
                {...(approvedPlan && { approvedPlan })}
                onOpenPlan={openPlanTaskDrawer}
                browserInstances={(browserViewState?.instances ?? []).map((instance) => ({
                  id: instance.id,
                  title: instance.title,
                  url: instance.url,
                  ...(instance.faviconUrl ? { faviconUrl: instance.faviconUrl } : {}),
                }))}
                onOpenBrowser={(browserId) => openBrowserTaskPanel(browserId)}
                imageArtifacts={activeThread ? imageArtifactsByThread[activeThread.id] ?? [] : []}
                onOpenImageArtifact={openImageGenerationArtifact}
                {...(projectWorkspace && { workspace: projectWorkspace })}
                {...(currentProjectPath && { workspacePath: currentProjectPath })}
                workspaceLabel={currentProjectName}
                {...(gitStatus && { gitStatus })}
                gitBusy={gitStatusBusy || gitStatusLoading}
                onCheckoutGitBranch={handleGitCheckoutBranch}
                onCreateGitBranch={handleGitCreateBranch}
                onOpenGitSettings={openGitSettings}
                {...(composerRuntimeConfig?.orchestrationSelection?.mainAgentConfigId && {
                  mainAgentConfigId: composerRuntimeConfig.orchestrationSelection.mainAgentConfigId,
                })}
                {...(composerRuntimeConfig?.auxiliaryModel?.candidateModelId && {
                  defaultCommitCandidateModelId: composerRuntimeConfig.auxiliaryModel.candidateModelId,
                })}
                gitSettings={gitSettings}
                onSaveCommitModelPreference={saveCommitMessageModelPreference}
                onCommitSuccess={() => void handleGitCommitSuccess()}
                onPushSuccess={() => {
                  showAppMessageSuccessRef.current(
                    t("git.pushSucceeded", { project: currentProjectName }),
                  );
                }}
                onOpenChangesReview={openReviewTaskDrawer}
                onChangesDiffLoaded={(diff) => void handleChangesDiffLoaded(diff)}
                onChangesDiffLoadingChange={handleChangesDiffLoadingChange}
                onChangesDiffError={handleChangesDiffError}
                onPullSuccess={() => void handleGitPullSuccess()}
                onResolveConflictsWithAgent={(conflictFiles) =>
                  void handleGitPullConflictsWithAgent(conflictFiles)
                }
                onRefreshGitStatus={(force = false) =>
                  refreshGitStatus(undefined, { force })
                }
                {...(showPackageScriptsEntry && {
                  onOpenScriptsDialog: () => {
                    void refreshPackageScripts();
                    setScriptsDialogOpen(true);
                  },
                })}
              />
            </aside>
          ) : null}
          </motion.div>
          {taskPanelLayoutOpen ? taskPanelNode : null}
          {showPanelChromeGroupB ? panelControlButtons : null}
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
        <div className="settings-page" role="dialog" aria-modal="true" aria-label={t("settings.dialog")}>
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
              {t("settings.back")}
            </button>

            <div className="settings-nav-search">
              <Search size={15} className="settings-nav-search-icon" aria-hidden />
              <input
                type="search"
                className="settings-nav-search-input"
                placeholder={t("settings.searchPlaceholder")}
                value={settingsSearch}
                onChange={(event) => setSettingsSearch(event.target.value)}
                aria-label={t("settings.search")}
              />
            </div>

            <nav className="settings-nav-groups" aria-label={t("settings.categories")}>
              {settingsNavGroups
                .map((group) => ({
                  ...group,
                  sections: group.sections.filter((section) => {
                    const query = settingsSearch.trim().toLowerCase();
                    if (!query) {
                      return true;
                    }
                    return (
                      section.label.toLowerCase().includes(query) ||
                      group.label.toLowerCase().includes(query) ||
                      section.keywords?.some((keyword) => keyword.toLowerCase().includes(query))
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
              {settingsSection === "preferences" && (
                <NotificationPreferencesPanel
                  settings={notificationSettings}
                  onSave={saveNotificationSettingsSnapshot}
                  localePreference={localePreference}
                  onLocalePreferenceChange={setLocalePreference}
                  cacheBreakTipsEnabled={promptCacheTipPreferences.enabled}
                  onCacheBreakTipsEnabledChange={(enabled) =>
                    setPromptCacheTipPreferences({ enabled })
                  }
                />
              )}

              {settingsSection === "general" && (
                <GeneralSettingsPanel
                  theme={appTheme}
                  onThemeChange={setAppTheme}
                  typography={typographyPreferences}
                  onTypographyChange={setTypographyPreferences}
                />
              )}

              {settingsSection === "personalization" && (
                <PersonalizationSettingsPanel
                  settings={personalizationSettings}
                  onSave={savePersonalizationSettingsSnapshot}
                />
              )}

              {settingsSection === "storage" && <StorageSettingsPanel />}

              {settingsSection === "browser" && (
                <BrowserSettingsPanel
                  settings={browserSettings}
                  {...(browserViewState ? { browserState: browserViewState } : {})}
                  onSave={saveBrowserSettingsSnapshot}
                />
              )}

              {settingsSection === "imageGeneration" && (
                <ImageGenerationSettingsPanel
                  settings={imageGenerationSettings}
                  onChange={(snapshot) => {
                    setImageGenerationSettings(snapshot);
                    void window.eco?.getIntegrationAvailability().then(setIntegrationAvailability);
                  }}
                  onError={setError}
                />
              )}

              {settingsSection === "skills" && (
                <SkillsSettingsPanel
                  {...(skillsSnapshot && { snapshot: skillsSnapshot })}
                  loading={isLoadingSkills}
                  onRefresh={() => void refreshSkillsList()}
                  onUninstall={uninstallSkill}
                  onLoadCatalogLeaderboard={loadSkillsCatalogLeaderboard}
                  onSearchCatalog={searchSkillsCatalog}
                  onInstallCatalog={installCatalogSkill}
                />
              )}

              {settingsSection === "defaultAgent" && (
                <DefaultAgentSettingsPanel
                  defaultCoreKind={workflowSettings.defaultCoreKind ?? "claude"}
                  codexAvailable={coreAvailability?.codex.available !== false}
                  {...(coreAvailability?.codex.reason && {
                    codexUnavailableReason: coreAvailability.codex.reason,
                  })}
                  busy={isSavingSettings}
                  onChange={(coreKind) => void saveDefaultCoreKind(coreKind)}
                />
              )}

              {settingsSection === "contextWindow" && (
                <ContextWindowSettingsPanel
                  contextWindowLimitTokens={workflowSettings.contextWindowLimitTokens}
                  maxOutputLimitTokens={workflowSettings.maxOutputLimitTokens}
                  onChangeContextWindow={saveContextWindowLimit}
                  onChangeMaxOutput={saveMaxOutputLimit}
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

              {settingsSection === "asr" && (
                <AsrSettingsPanel
                  snapshot={asrProfiles}
                  busy={asrBusy}
                  {...(asrSettingsLoadError !== undefined ? { loadError: asrSettingsLoadError } : {})}
                  onSave={saveAsrProfile}
                  onDelete={deleteAsrProfile}
                  onActivate={activateAsrProfile}
                  onInputDeviceChange={saveAsrInputDevice}
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
                  <p className="settings-empty-hint">{t("settings.loadingProviders")}</p>
                ))}

              {(settingsSection === "agentLibrary" || settingsSection === "orchestrationComponents") &&
                (proxyBridgeSettings ? (
                  <ModelsSettingsPanel
                    settings={settings}
                    proxyBridgeSettings={proxyBridgeSettings}
                    mcpServers={mcpSettings.servers}
                    skillsSnapshot={skillsSnapshot}
                    proxyBridgeSettingsSaving={isSavingProxyBridgeSettings}
                    initialTab={
                      settingsSection === "orchestrationComponents"
                        ? "compositionParts"
                        : "subagents"
                    }
                    mode="agentBuilder"
                    hideCategoryTabs
                    heading={
                      settingsSection === "orchestrationComponents"
                        ? t("settings.orchestrationComponents")
                        : t("settings.agentLibrary")
                    }
                    busy={isSavingSettings}
                    {...(effectiveDefaultOrchestrationSelection && {
                      defaultOrchestrationSelection: effectiveDefaultOrchestrationSelection,
                    })}
                    {...(workflowSettings.defaultAuxiliaryModel && {
                      defaultAuxiliaryModel: workflowSettings.defaultAuxiliaryModel,
                    })}
                    {...(workflowSettings.defaultVisionModel && {
                      defaultVisionModel: workflowSettings.defaultVisionModel,
                    })}
                    onSettingsChange={setSettings}
                    onSavingChange={setIsSavingSettings}
                    onDefaultOrchestrationSelectionChange={(selection) =>
                      void saveDefaultOrchestrationSelection(selection)
                    }
                    onDefaultAuxiliaryModelChange={(selection) =>
                      void saveDefaultAuxiliaryModel(selection)
                    }
                    onDefaultVisionModelChange={(selection) =>
                      void saveDefaultVisionModel(selection)
                    }
                    onProxyBridgeSettingsChange={(next) => void saveProxyBridgeSettings(next)}
                  />
                ) : (
                  <p className="settings-empty-hint">{t("settings.loadingModels")}</p>
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
  onReorder,
}: {
  followUps: ThreadPendingFollowUp[];
  cancelBusyId: string | undefined;
  escalateBusyId: string | undefined;
  onCancel: (followUp: ThreadPendingFollowUp) => void;
  onEscalate: (followUp: ThreadPendingFollowUp) => void;
  onEdit: (followUp: ThreadPendingFollowUp) => void;
  onReorder: (followUpIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draggedId, setDraggedId] = useState<string>();

  const moveDraggedBefore = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const next = followUps.map((followUp) => followUp.id);
    const from = next.indexOf(draggedId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(to, 0, next.splice(from, 1)[0]!);
    onReorder(next);
  };
  return (
    <div className="follow-up-queue" aria-label={t("app.queuedGuidance")}>
      <div className="follow-up-queue-rows">
        {followUps.map((followUp) => {
          const actionBusy = cancelBusyId === followUp.id || escalateBusyId === followUp.id;
          const isEscalating = escalateBusyId === followUp.id;
          const canEscalate = followUp.priority !== "escalated";

          return (
            <div
              key={followUp.id}
              className={`follow-up-row${draggedId === followUp.id ? " is-dragging" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                moveDraggedBefore(followUp.id);
                setDraggedId(undefined);
              }}
            >
              <div
                className="follow-up-card-main follow-up-card-main-editable"
                role="button"
                tabIndex={actionBusy ? -1 : 0}
                aria-label={t("thread.editFollowUpAria")}
                title={t("thread.editFollowUp")}
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
                <span
                  className="follow-up-card-drag-handle"
                  draggable={!actionBusy}
                  role="button"
                  tabIndex={actionBusy ? -1 : 0}
                  aria-label={t("thread.reorderFollowUpAria")}
                  title={t("thread.reorderFollowUp")}
                  onClick={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setDraggedId(followUp.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDraggedId(undefined)}
                >
                  <GripVertical size={14} aria-hidden />
                </span>
                <span className="follow-up-card-text">{formatThreadFollowUpPreview(followUp)}</span>
              </div>
              <div className="follow-up-card-actions">
                {canEscalate ? (
                  <span
                    className="follow-up-card-type follow-up-card-type-action"
                    role="button"
                    tabIndex={actionBusy ? -1 : 0}
                    aria-disabled={actionBusy}
                    aria-label={t("thread.followUpNowAria")}
                    title={t("thread.followUpNow")}
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
                    <CornerDownRight size={11} aria-hidden />
                    {isEscalating ? t("thread.processing") : t("thread.guide")}
                  </span>
                ) : (
                  <span className="follow-up-card-type">
                    <CornerDownRight size={11} aria-hidden />
                    {t("thread.guide")}
                  </span>
                )}
                <button
                  type="button"
                  className="follow-up-card-action"
                  onClick={() => onCancel(followUp)}
                  disabled={actionBusy}
                  title={t("common.delete")}
                  aria-label={t("thread.deleteFollowUpAria")}
                >
                  {cancelBusyId === followUp.id ? <Activity size={12} /> : <Trash2 size={12} />}
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

installVitePreloadRecovery();
document.documentElement.lang = i18n.resolvedLanguage ?? "zh-CN";
createRoot(document.getElementById("root") as HTMLElement).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>,
);
