import { defaultSubagentAvailability, formatPlanExecutionSummary, mergeStreamText } from "@eco/runtime";
import {
  Activity,
  AlertCircle,
  ArrowUp,
  ChevronLeft,
  Clock3,
  Database,
  FolderOpen,
  GitBranch,
  MessageSquarePlus,
  Monitor,
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";
import { isReconnectActivityMessage, shouldClearReconnectActivity } from "../shared/activity-display";
import { enrichBillingDisplaySource } from "../shared/billing-display-source";
import {
  buildThreadRuntimeConfigFromDefaults,
  type BashApprovalRequest,
  type ClarificationRequest,
  type CoderTodoItem,
  deriveSubagentEnabledFromProfile,
  getDefaultAgentProfileId,
  type LinkAgentsSkillsResult,
  type McpServerConfigInput,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type OrchestrationProfile,
  type ProxyBridgeSettingsSnapshot,
  type RouteCapabilityHint,
  resolveThreadAgentProfile,
  runtimeRoleRoutesFromAgentProfile,
  type SessionSyncSettingsInput,
  type SessionSyncSettingsSnapshot,
  type SkillsListResult,
  type SubagentRole,
  type ThreadActivityLine,
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
  type WorkspaceInfo,
} from "../shared/ipc";
import { isEcoSdkModelAlias, pickDisplayModelId } from "../shared/model-id";
import {
  dedupeSkillsByName,
  listSdkReadyProjectSkills,
  parseExplicitSkillNames,
  promptIncludesSkillName,
  type SkillInfo,
} from "../shared/skills";
import { isContinuableThreadStatus, isUsageNoiseMessage } from "../shared/thread-continuation";
import {
  extractPlanFailureMessage,
  resolveRetryBannerDetail,
  resolveRetryBannerHint,
  resolveThreadMessageFromLiveEvent,
  retryBannerNoDetailHint,
  shouldUpdateThreadSummaryFromLiveEvent,
} from "../shared/thread-failure-message";
import { buildThreadUsageSummary } from "../shared/thread-usage-summary";
import { ActivityLogView } from "./ActivityLogView";
import {
  isActivityStatusNoise,
  shouldScrollMainActivityFeedForLine,
  stripActivityStatusNoise,
} from "./activity-log";
import { areCodingRoutesReady, isAgentProfileReady } from "./agent-profile-readiness";
import { findSelectableAgentProfileSummary } from "./agent-profile-summary";
import { BashApprovalPanel } from "./BashApprovalPanel";
import { ClarificationPanel } from "./ClarificationPanel";
import { ComposerAgentModels } from "./ComposerAgentModels";
import { ComposerBashReviewToggle } from "./ComposerBashReviewToggle";
import { ComposerPlanModeToggle } from "./ComposerPlanModeToggle";
import { ComposerRoutePopover, ComposerRoutePopoverTrigger } from "./ComposerRoutePopover";
import { ComposerSkillsBar } from "./ComposerSkillsBar";
import { ComposerSkillsInput, type ComposerSkillsInputHandle } from "./ComposerSkillsInput";
import { ComposerSkillsSlashMenu } from "./ComposerSkillsSlashMenu";
import { buildComposerAgentModelLabels } from "./composer-agent-model-labels";
import {
  COMPOSER_MAX_IMAGES,
  type ComposerImageAttachment,
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
import { PlanApprovalPanel } from "./PlanApprovalPanel";
import { ProjectSidebarTree } from "./ProjectSidebarTree";
import {
  buildInitialProjectOrder,
  type ProjectReorderPosition,
  prependProjectOrder,
  reorderProjectPaths,
  sortProjectsByOrder,
} from "./project-sidebar-order";
import { buildRuntimeAgentDisplayNames } from "./runtime-agent-display";
import { SessionSyncSettingsPanel } from "./SessionSyncSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";
import { StopThreadConfirmDialog } from "./StopThreadConfirmDialog";
import { ThreadInfoPanel } from "./ThreadInfoPanel";
import {
  formatThreadFollowUpPreview,
  isLiveFollowUpThreadStatus,
  mergeThreadFollowUp,
  queuedThreadFollowUps,
  sortThreadFollowUps,
} from "./thread-follow-up-ui";
import { type AppTheme, persistAppTheme, readStoredAppTheme } from "./theme";
import "./themes.css";
import "./styles.css";
import "./theme-overrides.css";

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
const collapsedProjectsStorageKey = "eco.sidebar.collapsed-projects";
const hiddenProjectsStorageKey = "eco.sidebar.hidden-projects";
const sidebarThreadsCollapsed = 5;

interface RecentProject {
  path: string;
  name: string;
  /** Set once when the project is first opened in the app; used for stable sidebar order. */
  importedAt: string;
}

const settingsNavGroups = [
  {
    label: "个人",
    sections: [{ id: "general", label: "外观", icon: Monitor }],
  },
  {
    label: "集成",
    sections: [
      { id: "providers", label: "Provider", icon: Settings2 },
      { id: "mcp", label: "MCP", icon: Plug },
      { id: "sessionSync", label: "会话同步", icon: Database },
    ],
  },
  {
    label: "编码",
    sections: [
      { id: "models", label: "Agent Builder", icon: SlidersHorizontal },
      { id: "skills", label: "Skills", icon: Sparkles },
      { id: "git", label: "Git", icon: GitBranch },
    ],
  },
] as const;

const settingsSections = settingsNavGroups.flatMap((group) => group.sections);

const emptySessionSyncSettings: SessionSyncSettingsSnapshot = {
  settings: {
    redisEnabled: false,
    redisUrl: "",
    keyPrefix: "eco-sessions",
    hasRedisPassword: false,
  },
};

const emptyMcpSettings: McpSettingsSnapshot = { servers: [] };

type SettingsSectionId = (typeof settingsSections)[number]["id"];

type ActivityLine = ThreadActivityLine;

interface ComposerRewindTarget extends ThreadActivityRewindTarget {
  threadId: string;
}

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("general");
  const [settingsSearch, setSettingsSearch] = useState("");
  const [appTheme, setAppTheme] = useState<AppTheme>(() => readStoredAppTheme());

  useEffect(() => {
    persistAppTheme(appTheme);
  }, [appTheme]);
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [projectWorkspace, setProjectWorkspace] = useState<WorkspaceInfo>();
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>();
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<Set<string>>(() => new Set());
  const [expandedProjectThreadPaths, setExpandedProjectThreadPaths] = useState<Set<string>>(() => new Set());
  const [hiddenProjectPaths, setHiddenProjectPaths] = useState<Set<string>>(() => new Set());
  const [pinnedProjectPaths, setPinnedProjectPaths] = useState<Set<string>>(() => new Set());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [projectOrder, setProjectOrder] = useState<string[]>([]);
  const projectOrderInitializedRef = useRef(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [settings, setSettings] = useState<ModelSettingsSnapshot>(emptySettings);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsSnapshot>(emptyMcpSettings);
  const [sessionSyncSettings, setSessionSyncSettings] =
    useState<SessionSyncSettingsSnapshot>(emptySessionSyncSettings);
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
  const [pendingPlan, setPendingPlan] = useState<ThreadPendingPlan>();
  const [pendingClarification, setPendingClarification] = useState<ClarificationRequest>();
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [pendingBashApproval, setPendingBashApproval] = useState<BashApprovalRequest>();
  const [bashApprovalBusy, setBashApprovalBusy] = useState(false);
  const [followUpsByThread, setFollowUpsByThread] = useState<Record<string, ThreadPendingFollowUp[]>>({});
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpCancelBusyId, setFollowUpCancelBusyId] = useState<string>();
  const [followUpEscalateBusyId, setFollowUpEscalateBusyId] = useState<string>();
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string>();
  const [activityByThread, setActivityByThread] = useState<Record<string, ActivityLine[]>>({});
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
  const [workspaceDirtyFiles, setWorkspaceDirtyFiles] = useState<string[]>([]);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [stopConfirm, setStopConfirm] = useState<{ changedFiles: string[] }>();
  const [rollbackBusy, setRollbackBusy] = useState(false);
  const [retryBusy, setRetryBusy] = useState(false);
  const [composerRuntimeConfig, setComposerRuntimeConfig] = useState<ThreadRuntimeConfig | null>(null);

  useEffect(() => {
    if (!window.eco) {
      setError("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
      return undefined;
    }

    void Promise.all([
      window.eco.getCurrentWorkspace(),
      window.eco.listThreads(),
      window.eco.getModelSettings(),
      window.eco.getMcpSettings(),
      window.eco.getSessionSyncSettings(),
      window.eco.getProxyBridgeSettings(),
    ]).then(([currentWorkspace, currentThreads, modelSettings, mcp, sessionSync, proxyBridge]) => {
      setWorkspace(currentWorkspace);
      if (currentWorkspace) {
        setSelectedProjectPath(currentWorkspace.path);
        registerImportedProject(currentWorkspace.path, currentWorkspace.name);
      }
      setThreads(currentThreads);
      setSettings(modelSettings);
      setMcpSettings(mcp);
      setSessionSyncSettings(sessionSync);
      setProxyBridgeSettings(proxyBridge);
    });

    return window.eco.onThreadEvent((event) => {
      if (!isThreadLiveEvent(event) || event.threadId === "settings") {
        return;
      }

      if (event.type === "thread.deleted") {
        clearThreadClientState(event.threadId);
        return;
      }

      if (event.type === "thread.run_projection_updated" && event.projection) {
        setRunProjectionByThread((current) => ({
          ...current,
          [event.threadId]: event.projection!,
        }));
        return;
      }

      if (event.title) {
        setThreads((current) =>
          current.map((thread) =>
            thread.id === event.threadId ? { ...thread, title: event.title ?? thread.title } : thread,
          ),
        );
        if (event.type === "thread.title_updated") {
          return;
        }
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
        setPendingPlan(undefined);
      }

      if (event.plan && event.threadId) {
        setPendingPlan({
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
          current.map((thread) =>
            thread.id === event.threadId ? { ...thread, runtimeConfig } : thread,
          ),
        );
      }

      if (event.type === "clarification.requested" && event.clarification) {
        setPendingClarification(event.clarification);
      }

      if (event.type === "bash_approval.requested" && event.bashApproval) {
        setPendingBashApproval(event.bashApproval);
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
      if (
        event.type === "bash_approval.approved" ||
        event.type === "bash_approval.rejected" ||
        event.type === "bash_approval.denied" ||
        event.type === "thread.completed" ||
        event.type === "thread.failed" ||
        event.type === "thread.idle" ||
        event.type === "thread.stopped"
      ) {
        setPendingBashApproval((current) => (current?.threadId === event.threadId ? undefined : current));
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

      if (event.type === "thread.execution_failed" && window.eco) {
        void window.eco.getPendingPlan(event.threadId).then((plan) => {
          if (plan) {
            setPendingPlan(plan);
          }
        });
      }

      if (event.type === "thread.user_prompt" || event.type === "thread.api_error") {
        if (event.activityLine) {
          appendActivityLine(event.threadId, event.activityLine);
        }
        return;
      }

      if (event.activityLine) {
        appendActivityLine(event.threadId, event.activityLine);
        return;
      }

      if (
        event.type.startsWith("thread.") &&
        event.type !== "thread.auto_retry" &&
        event.type !== "thread.retry"
      ) {
        return;
      }

      appendActivityLine(event.threadId, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: event.role ?? "system",
        message: event.message,
        ...(event.stream !== undefined && { stream: event.stream }),
        ...(event.apiError && { apiError: event.apiError }),
      });
    });
  }, []);

  const selectedThreadStatus = threads.find((thread) => thread.id === selectedThreadId)?.status;

  useEffect(() => {
    if (!selectedThreadId || !window.eco) {
      return;
    }

    let cancelled = false;
    void window.eco.listThreadActivity(selectedThreadId).then((lines) => {
      if (cancelled) {
        return;
      }
      setActivityByThread((current) => ({
        ...current,
        [selectedThreadId]: lines,
      }));
    });

    if (typeof window.eco.getThreadRunProjection === "function") {
      void window.eco.getThreadRunProjection(selectedThreadId).then((projection) => {
        if (cancelled || !projection) {
          return;
        }
        setRunProjectionByThread((current) => ({
          ...current,
          [selectedThreadId]: projection,
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
        setPendingPlan(plan);
      });
      void window.eco.getPendingClarification(selectedThreadId).then((clarification) => {
        if (cancelled) {
          return;
        }
        setPendingClarification(clarification);
      });
      if (typeof window.eco.getPendingBashApproval === "function") {
        void window.eco.getPendingBashApproval(selectedThreadId).then((approval) => {
          if (cancelled) {
            return;
          }
          setPendingBashApproval(approval);
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
    for (const project of recentProjects) {
      merged.set(project.path, project);
    }
    if (workspace) {
      const existing = merged.get(workspace.path);
      if (existing) {
        merged.set(workspace.path, { ...existing, name: workspace.name });
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
          name: pathToName(thread.workspacePath),
          importedAt,
        });
      }
    }
    return [...merged.values()].filter((project) => !hiddenProjectPaths.has(project.path));
  }, [hiddenProjectPaths, recentProjects, threads, workspace]);

  const projects = useMemo(
    () => sortProjectsByOrder(mergedProjects, projectOrder),
    [mergedProjects, projectOrder],
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
    return grouped;
  }, [threads]);

  const projectTree = useMemo(
    () =>
      projects.map((project) => {
        const projectThreads = threadsByProject.get(project.path) ?? [];
        const threadsExpanded = expandedProjectThreadPaths.has(project.path);
        const visibleCount = threadsExpanded ? projectThreads.length : sidebarThreadsCollapsed;
        return {
          project: { ...project, pinned: pinnedProjectPaths.has(project.path) },
          projectThreads,
          collapsed: collapsedProjectPaths.has(project.path),
          visibleThreads: projectThreads.slice(0, visibleCount),
          hasMore: !threadsExpanded && projectThreads.length > visibleCount,
        };
      }),
    [collapsedProjectPaths, expandedProjectThreadPaths, pinnedProjectPaths, projects, threadsByProject],
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
  const currentProjectName = currentProjectPath ? pathToName(currentProjectPath) : "项目";
  const activeThread = useMemo(
    () => (selectedThreadId ? threads.find((thread) => thread.id === selectedThreadId) : undefined),
    [selectedThreadId, threads],
  );
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

  useEffect(() => {
    if (!activeThread?.id || !window.eco) {
      setWorkspaceDirtyFiles([]);
      return undefined;
    }

    if (activeThread.status === "running") {
      setWorkspaceDirtyFiles([]);
      return undefined;
    }

    let cancelled = false;
    void window.eco.getWorktreeStatus(activeThread.id).then((status) => {
      if (cancelled) {
        return;
      }
      setWorkspaceDirtyFiles(status.exists ? status.changedFiles : []);
    });

    return () => {
      cancelled = true;
    };
  }, [activeThread?.id, activeThread?.status, activeThread?.message]);

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
        const planModeEnabled = planModeOverride ?? composerRuntimeConfig?.planModeEnabled ?? false;
        return buildThreadRuntimeConfigFromDefaults({
          settings,
          workflowDefaults: { planModeEnabled },
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
      composerRuntimeConfig?.planModeEnabled,
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
  const activeRoutes = useMemo(() => {
    return selectedRuntimeProfile ? runtimeRoleRoutesFromAgentProfile(selectedRuntimeProfile) : [];
  }, [selectedRuntimeProfile]);

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
  const activeBashApproval =
    activeThread && pendingBashApproval?.threadId === activeThread.id ? pendingBashApproval : undefined;
  const plannerSupportsImages =
    !plannerCapability?.capabilitiesResolved || plannerCapability.supportsImageInput;
  const canPasteComposerImages = plannerSupportsImages;
  const composerHasContent = Boolean(prompt.trim() || composerAttachments.length > 0);

  const canSendFollowUp = Boolean(
    currentProjectPath &&
      activeThread &&
      composerFollowUpMode &&
      composerHasContent &&
      !followUpBusy &&
      !isStarting &&
      !planActionBusy,
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
      !activeBashApproval &&
      threadAcceptsInput,
  );
  const canSend = composerFollowUpMode ? canSendFollowUp : canSendThreadMessage;
  const showPlanApproval =
    activeThread?.status === "awaiting_plan" && pendingPlan?.threadId === activeThread.id;
  const showClarification =
    pendingClarification && activeThread && pendingClarification.threadId === activeThread.id;
  const showBashApproval = Boolean(activeBashApproval);
  const planFailureMessage = activeThread ? extractPlanFailureMessage(activeThread.message) : undefined;
  const retryBannerDetail = activeThread
    ? resolveRetryBannerDetail(activeThread.message, activeThread.status)
    : undefined;
  const retryBannerHint = retryBannerDetail ? resolveRetryBannerHint(retryBannerDetail) : undefined;
  const alternateAgentProfiles = useMemo(
    () =>
      settings.orchestrationProfiles.filter(
        (profile) => profile.id !== composerRuntimeConfig?.agentProfileId,
      ),
    [settings.orchestrationProfiles, composerRuntimeConfig?.agentProfileId],
  );
  const [retryAgentProfileId, setRetryAgentProfileId] = useState<string>("");

  useEffect(() => {
    setRetryAgentProfileId("");
  }, [activeThread?.id]);

  const canRetryThread = Boolean(
    activeThread &&
      routesReady &&
      !isStarting &&
      !planActionBusy &&
      !clarificationBusy &&
      !bashApprovalBusy &&
      !pendingClarification &&
      !activeBashApproval &&
      !retryBusy &&
      (activeThread.status === "failed" ||
        activeThread.status === "blocked" ||
        (activeThread.status === "awaiting_plan" &&
          pendingPlan?.threadId === activeThread.id &&
          Boolean(planFailureMessage))),
  );
  const canStopThread =
    activeThread?.status === "running" ||
    activeThread?.status === "queued" ||
    activeThread?.status === "awaiting_plan";
  const canRollbackThread = activeThread?.status === "completed" || activeThread?.status === "idle";

  const activityLines = activeThread ? (activityByThread[activeThread.id] ?? []) : [];
  const activeFollowUps = activeThread ? (followUpsByThread[activeThread.id] ?? []) : [];
  const queuedFollowUps = useMemo(() => queuedThreadFollowUps(activeFollowUps), [activeFollowUps]);
  const runProjection = activeThread ? runProjectionByThread[activeThread.id] : undefined;
  const subagentTimings = activeThread ? subagentTimingsByThread[activeThread.id] : undefined;
  const subagentMetrics = activeThread ? subagentMetricsByThread[activeThread.id] : undefined;
  const coderTodos = activeThread ? (todosByThread[activeThread.id] ?? []) : [];
  const threadUsageByRole = activeThread ? usageByThread[activeThread.id] : undefined;
  const threadModelByRole = activeThread ? modelByThread[activeThread.id] : undefined;
  const activeRuntimeAgentDisplayNames = useMemo(
    () => buildRuntimeAgentDisplayNames(settings, activeThread?.runtimeConfig),
    [settings, activeThread?.runtimeConfig],
  );
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
  const activityEndRef = useRef<HTMLDivElement>(null);
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
        return `${agent.agentId}:${agent.status}:${agent.durationMs}:${lastAgentItem?.id ?? ""}`;
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

  const scrollActivityFeedToEnd = useCallback((force = false) => {
    const container = activityEndRef.current?.parentElement;
    if (!container) {
      return;
    }
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (!force && distanceFromBottom > 120) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const lastLine = activityLines.at(-1);
    if (!shouldScrollMainActivityFeedForLine(lastLine)) {
      return;
    }
    const isStreaming = lastLine?.stream === true;
    scrollActivityFeedToEnd(isStreaming);
    const frame = requestAnimationFrame(() => scrollActivityFeedToEnd(isStreaming));
    return () => cancelAnimationFrame(frame);
  }, [activityLines, activeThread?.id, scrollActivityFeedToEnd]);

  useLayoutEffect(() => {
    if (!runProjectionLayoutSignature) {
      return;
    }
    const force = activeThread?.status === "running" || activeThread?.status === "queued";
    scrollActivityFeedToEnd(force);
    const frame = requestAnimationFrame(() => scrollActivityFeedToEnd(force));
    return () => cancelAnimationFrame(frame);
  }, [activeThread?.status, runProjectionLayoutSignature, scrollActivityFeedToEnd]);

  useLayoutEffect(() => {
    if (
      !canRetryThread ||
      showPlanApproval ||
      !activeThread ||
      (!planFailureMessage && activeThread.status !== "failed")
    ) {
      return;
    }
    scrollActivityFeedToEnd(true);
    const frame = requestAnimationFrame(() => scrollActivityFeedToEnd(true));
    return () => cancelAnimationFrame(frame);
  }, [
    activeThread?.id,
    activeThread?.status,
    canRetryThread,
    planFailureMessage,
    scrollActivityFeedToEnd,
    showPlanApproval,
  ]);

  function withoutReconnectActivityLines(lines: ActivityLine[]): ActivityLine[] {
    return lines.filter((entry) => !isReconnectActivityMessage(entry.message));
  }

  function appendActivityLine(threadId: string, line: ActivityLine) {
    const cleanedMessage = stripActivityStatusNoise(line.message);
    if (isUsageNoiseMessage(cleanedMessage) || isActivityStatusNoise(line.message)) {
      return;
    }
    const normalizedLine: ActivityLine = {
      ...line,
      message: cleanedMessage,
    };
    const clearsReconnect = shouldClearReconnectActivity(normalizedLine);
    if (isReconnectActivityMessage(cleanedMessage)) {
      setActivityByThread((current) => {
        const previous = current[threadId] ?? [];
        for (let index = previous.length - 1; index >= 0; index -= 1) {
          const candidate = previous[index];
          if (candidate && isReconnectActivityMessage(candidate.message)) {
            return {
              ...current,
              [threadId]: [
                ...previous.slice(0, index),
                { ...candidate, message: cleanedMessage, role: normalizedLine.role },
                ...previous.slice(index + 1),
              ],
            };
          }
        }
        return {
          ...current,
          [threadId]: [...previous, normalizedLine].slice(-300),
        };
      });
      return;
    }
    setActivityByThread((current) => {
      const previous = clearsReconnect
        ? withoutReconnectActivityLines(current[threadId] ?? [])
        : (current[threadId] ?? []);
      const last = previous[previous.length - 1];
      if (
        last &&
        !normalizedLine.stream &&
        last.role === normalizedLine.role &&
        last.message === normalizedLine.message &&
        last.stream !== true
      ) {
        if (clearsReconnect && previous.length !== (current[threadId] ?? []).length) {
          return { ...current, [threadId]: previous };
        }
        return current;
      }
      if (normalizedLine.stream && last && !last.stream && isActivityStatusNoise(last.message)) {
        return {
          ...current,
          [threadId]: [...previous.slice(0, -1), { ...normalizedLine, stream: true }].slice(-300),
        };
      }
      if (!normalizedLine.stream && last?.stream && last.role === normalizedLine.role) {
        const merged = normalizedLine.message.trim()
          ? mergeStreamText(last.message, normalizedLine.message)
          : last.message;
        return {
          ...current,
          [threadId]: [
            ...previous.slice(0, -1),
            { ...last, message: stripActivityStatusNoise(merged), stream: false },
          ].slice(-300),
        };
      }
      if (normalizedLine.stream && last?.stream) {
        return {
          ...current,
          [threadId]: [
            ...previous.slice(0, -1),
            {
              ...last,
              role: normalizedLine.role,
              message: stripActivityStatusNoise(mergeStreamText(last.message, normalizedLine.message)),
            },
          ].slice(-300),
        };
      }
      return {
        ...current,
        [threadId]: [...previous, normalizedLine].slice(-300),
      };
    });
  }

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
      lines,
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
      window.eco.listThreadActivity(threadId),
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

    setActivityByThread((current) => ({ ...current, [threadId]: lines }));
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
    setPendingPlan(plan);
    setPendingClarification(clarification);
    setPendingBashApproval(bashApproval);
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

  function restorePrompt(text: string, rewindTarget?: ThreadActivityRewindTarget) {
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
  }

  async function sendComposerMessage() {
    if (!currentProjectPath || !window.eco || (!prompt.trim() && composerAttachments.length === 0)) {
      return;
    }
    setError(undefined);
    const attachments =
      composerAttachments.length > 0 ? toPromptImageAttachments(composerAttachments) : undefined;
    const messagePrompt = prompt.trim() || (attachments?.length ? "请查看并分析我附上的图片。" : "");

    if (composerFollowUpMode && activeThread) {
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
        setPrompt("");
        setComposerRewindTarget(undefined);
        setComposerAttachments([]);
        setComposerImageNotice(undefined);
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
        const rewindTarget =
          activeComposerRewindTarget
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
        setPendingPlan(undefined);
        await refreshThreadState(result.thread.id);
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
        setPendingPlan(undefined);
        setTodosByThread((current) => ({
          ...current,
          [result.thread.id]: [],
        }));
        void window.eco.listThreadActivity(result.thread.id).then((lines) => {
          setActivityByThread((current) => ({
            ...current,
            [result.thread.id]: lines,
          }));
        });
      }
      setPrompt("");
      setComposerRewindTarget(undefined);
      setComposerAttachments([]);
      setComposerImageNotice(undefined);
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
    const confirmed = window.confirm(
      "立即处理会在必要时先停止当前步骤，完成清理后再恢复处理这条后续消息。继续？",
    );
    if (!confirmed) {
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
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setFollowUpEscalateBusyId(undefined);
    }
  }

  async function retryActiveThread(agentProfileId?: string) {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    setRetryBusy(true);
    try {
      const result = await window.eco.retryThread({
        threadId: activeThread.id,
        ...(agentProfileId ? { agentProfileId } : {}),
      });
      if (result.thread) {
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
        );
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRetryBusy(false);
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
      setPendingPlan(undefined);
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
      setPendingClarification(undefined);
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
      setPendingClarification(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setClarificationBusy(false);
    }
  }

  async function resolvePendingBashApproval(decision: "approved" | "denied") {
    if (!pendingBashApproval || !window.eco) return;
    setBashApprovalBusy(true);
    setError(undefined);
    try {
      await window.eco.resolveBashApproval({
        toolUseId: pendingBashApproval.toolUseId,
        decision,
      });
      setPendingBashApproval(undefined);
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
      setPendingPlan(undefined);
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

  async function rollbackToActiveThread() {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    setRollbackBusy(true);
    try {
      await window.eco.rollbackToThread(activeThread.id);
      setThreads(await window.eco.listThreads());
      setWorkspaceDirtyFiles([]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRollbackBusy(false);
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

  async function persistComposerRuntimeConfig(
    next: ThreadRuntimeConfig,
    options?: { persistWhileRunning?: boolean },
  ): Promise<void> {
    setComposerRuntimeConfig(next);
    if (!activeThread || !window.eco) {
      return;
    }
    const isRunning = activeThread.status === "running" || activeThread.status === "queued";
    const canPersist =
      canEditComposerConfig || (options?.persistWhileRunning === true && isRunning);
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
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      routeProfileId: agentProfileId,
      agentProfileId,
      ...(profile
        ? {
            subagentEnabled: deriveSubagentEnabledFromProfile(
              profile,
              composerRuntimeConfig.subagentEnabled,
            ),
          }
        : {}),
    };
    await persistComposerRuntimeConfig(next);
    setComposerRoutePopoverOpen(false);
  }

  async function saveComposerSelectionAsProfile() {
    if (!window.eco?.saveOrchestrationProfile || !window.eco?.getModelSettings) {
      setError("Agent Profile 保存接口不可用。");
      return;
    }
    if (!composerRuntimeConfig || !selectedRuntimeProfile) {
      return;
    }
    const defaultName = `${selectedRuntimeProfile.name} Copy`;
    const name = window.prompt("保存为 Agent Profile", defaultName);
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

  async function toggleComposerPlanMode(planModeEnabled: boolean) {
    if (!composerRuntimeConfig || !canEditComposerConfig) {
      return;
    }
    const next: ThreadRuntimeConfig = { ...composerRuntimeConfig, planModeEnabled };
    await persistComposerRuntimeConfig(next);
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

  async function saveSessionSyncSettings(input: SessionSyncSettingsInput) {
    if (!window.eco) return;
    setIsSavingSettings(true);
    try {
      const settings = await window.eco.saveSessionSyncSettings(input);
      setSessionSyncSettings({ settings });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function testSessionSyncConnection(input: { redisUrl: string; redisPassword?: string }) {
    if (!window.eco) {
      return { ok: false, error: "Electron preload API is unavailable." };
    }
    return window.eco.testSessionSyncConnection(input);
  }

  function activateWorkspace(nextWorkspace: WorkspaceInfo) {
    setWorkspace(nextWorkspace);
    setSelectedProjectPath(nextWorkspace.path);
    registerImportedProject(nextWorkspace.path, nextWorkspace.name);
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
    setActivityByThread({});
    setTodosByThread({});
    setFollowUpsByThread({});
  }

  function registerImportedProject(path: string, name: string) {
    setHiddenProjectPaths((current) => {
      if (!current.has(path)) {
        return current;
      }
      const next = new Set(current);
      next.delete(path);
      window.localStorage.setItem(hiddenProjectsStorageKey, JSON.stringify([...next]));
      return next;
    });
    setRecentProjects((current) => {
      const existing = current.find((item) => item.path === path);
      const next = existing
        ? current.map((item) => (item.path === path ? { ...item, name } : item))
        : [{ path, name, importedAt: new Date().toISOString() }, ...current].slice(0, 12);
      window.localStorage.setItem(recentProjectsStorageKey, JSON.stringify(next));
      return next;
    });
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

  function removeProject(projectPath: string) {
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
    setThreads((current) => current.filter((thread) => thread.id !== threadId));
    setSelectedThreadId((current) => (current === threadId ? undefined : current));
    if (selectedThreadId === threadId) {
      resetComposerDefaultConfig();
      setComposerRewindTarget(undefined);
    }
    setActivityByThread((current) => removeRecordKey(current, threadId));
    setSubagentTimingsByThread((current) => removeRecordKey(current, threadId));
    setSubagentMetricsByThread((current) => removeRecordKey(current, threadId));
    setRunProjectionByThread((current) => removeRecordKey(current, threadId));
    setUsageByThread((current) => removeRecordKey(current, threadId));
    setBillingByThread((current) => removeRecordKey(current, threadId));
    setContextByThread((current) => removeRecordKey(current, threadId));
    setModelByThread((current) => removeRecordKey(current, threadId));
    setTodosByThread((current) => removeRecordKey(current, threadId));
    setFollowUpsByThread((current) => removeRecordKey(current, threadId));
    setPendingPlan((current) => (current?.threadId === threadId ? undefined : current));
    setPendingClarification((current) => (current?.threadId === threadId ? undefined : current));
    setPendingBashApproval((current) => (current?.threadId === threadId ? undefined : current));
  }

  async function deleteThread(thread: ThreadSummary) {
    if (!window.eco) {
      return;
    }
    if (thread.status === "running" || thread.status === "queued") {
      setError("请先停止当前运行后再删除对话。");
      return;
    }
    try {
      await window.eco.deleteThread(thread.id);
      clearThreadClientState(thread.id);
    } catch (caught) {
      setError(errorMessage(caught));
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
    setSelectedThreadId(undefined);
    resetComposerDefaultConfig();
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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

  const showThreadInfo = Boolean(activeThread);
  const showLanding = !activeThread;
  const composerPlaceholder = showClarification
    ? "补充消息会排队；回答问题请用上方卡片"
    : showBashApproval
      ? "补充消息会排队；命令审批请用上方卡片"
      : activeThread?.status === "awaiting_plan"
        ? "请先确认或忽略上方计划"
        : activeThread && isContinuableThreadStatus(activeThread.status)
          ? "继续对话；若需改计划请说明，将重新生成完整计划…"
          : composerFollowUpMode
            ? "追加后续消息；当前步骤结束后处理…"
            : activeThread
              ? "当前对话不可发送"
              : "尽管问";
  const composerDisabled = Boolean(activeThread && !threadAcceptsInput && !composerFollowUpMode);

  const composer = (
    <div className="codex-composer-wrap">
      {composerImageNotice && <p className="composer-image-notice">{composerImageNotice}</p>}
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
      <div className="codex-composer" ref={composerAnchorRef}>
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
            <div className="composer-footer-row composer-footer-config-row">
              <div className="composer-route-control">
                <ComposerRoutePopoverTrigger
                  buttonRef={composerRouteButtonRef}
                  open={composerRoutePopoverOpen}
                  disabled={!canSwitchRouteProfile || isSavingSettings}
                  profileName={selectedAgentProfileSummary?.name}
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
                    selectedRuntimeProfile && composerRuntimeConfig
                      ? saveComposerSelectionAsProfile
                      : undefined
                  }
                  selectedProfileId={selectedRuntimeProfileId}
                  onOpenFullSettings={() => openModelsSettings("routes")}
                />
              </div>
              {composerRuntimeConfig ? (
                <ComposerPlanModeToggle
                  planModeEnabled={composerRuntimeConfig.planModeEnabled}
                  canEdit={canEditComposerConfig}
                  saving={isSavingSettings}
                  onToggle={(enabled) => void toggleComposerPlanMode(enabled)}
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
              <ComposerAgentModels
                labels={agentModelLabels}
                subagentSettings={composerRuntimeConfig?.subagentEnabled ?? defaultSubagentAvailability()}
                canEditSubagents={canEditComposerConfig}
                subagentSaving={isSavingSettings}
                onToggleSubagent={(role, enabled) => void toggleComposerSubagent(role, enabled)}
              />
            </div>
          </div>
          {canStopThread ? (
            <button
              type="button"
              className="send-button stop"
              onClick={() => void requestStopThread()}
              disabled={cancelBusy}
              title="停止当前运行"
              aria-label="停止"
            >
              {cancelBusy ? <Activity size={18} /> : <Square size={14} />}
            </button>
          ) : null}
          <button
            type="button"
            className="send-button"
            onClick={sendComposerMessage}
            disabled={!canSend}
            title={composerFollowUpMode ? "排队后续消息" : "发送"}
            aria-label={composerFollowUpMode ? "排队后续消息" : "发送"}
          >
            {isStarting || followUpBusy ? <Activity size={18} /> : <ArrowUp size={18} />}
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
              Provider
            </button>
            中配置模型（API Key 可选）
          </p>
        )}
      </div>
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
    <main className={showThreadInfo ? "shell shell-with-info" : "shell"}>
      <aside className="codex-sidebar">
        <button type="button" className="sidebar-action" onClick={startNewChat}>
          <MessageSquarePlus size={18} />
          新对话
        </button>
        <button type="button" className="sidebar-action muted" onClick={openWorkspace} disabled={isOpening}>
          <FolderOpen size={18} />
          打开项目…
        </button>

        <div className="sidebar-section sidebar-section-grow">
          <ProjectSidebarTree
            projectTree={projectTree}
            currentProjectPath={currentProjectPath}
            activeThreadId={activeThread?.id}
            onSwitchProject={switchProject}
            onSelectThread={selectThread}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            onExpandProjectThreads={expandProjectThreads}
            onReorderProjects={reorderProjects}
            onOpenProjectPath={handleOpenProjectFromDrop}
            onPinProject={pinProject}
            onUnpinProject={unpinProject}
            onRemoveProject={removeProject}
            onDeleteThread={(thread) => void deleteThread(thread)}
          />
        </div>

        <button type="button" className="sidebar-settings" onClick={openProviderSettings}>
          <Settings2 size={18} />
          设置
        </button>
      </aside>

      <section className={showLanding ? "codex-main codex-main-landing" : "codex-main"}>
        <div className="codex-main-scroll">
          {showLanding ? (
            <div className="codex-landing">
              <h1 className="codex-hero">
                {currentProjectPath
                  ? `我们应该在 ${currentProjectName} 中构建什么？`
                  : "打开一个项目开始编码"}
              </h1>
              {composer}
            </div>
          ) : (
            <div className="activity-feed">
              {activeThread && (
                <header className="activity-header">
                  <h2>{activeThread.title}</h2>
                  <div className="activity-header-actions">
                    {canRetryThread ? (
                      <button
                        type="button"
                        className="activity-icon-button"
                        onClick={() => void retryActiveThread()}
                        disabled={retryBusy}
                        title="使用相同需求重试此次请求"
                        aria-label="重试此次请求"
                      >
                        <RefreshCw size={15} className={retryBusy ? "spinning" : undefined} />
                      </button>
                    ) : null}
                    {canRollbackThread ? (
                      <button
                        type="button"
                        className="activity-icon-button"
                        onClick={() => void rollbackToActiveThread()}
                        disabled={rollbackBusy}
                        title="撤销此对话之后的已应用变更"
                        aria-label="回滚到此对话"
                      >
                        <RotateCcw size={15} className={rollbackBusy ? "spinning" : undefined} />
                      </button>
                    ) : null}
                  </div>
                </header>
              )}
              <div className="activity-messages">
                <ActivityLogView
                  lines={activityLines}
                  {...(activeThread && { thread: activeThread })}
                  {...(runProjection && { projection: runProjection })}
                  {...(activeThread &&
                    billingByThread[activeThread.id] && { billing: billingByThread[activeThread.id] })}
                  onRestorePrompt={restorePrompt}
                  onPlannerLayoutChange={() => scrollActivityFeedToEnd(true)}
                  {...(Object.keys(activityModelByRole).length > 0 && { modelByRole: activityModelByRole })}
                  agentDisplayNames={activeRuntimeAgentDisplayNames}
                  {...(threadUsageByRole && { usageByRole: threadUsageByRole })}
                  {...(subagentTimings && { subagentTimings })}
                  {...(subagentMetrics && { subagentMetrics })}
                  {...(activeThread &&
                    contextByThread[activeThread.id] && { context: contextByThread[activeThread.id] })}
                />
                {queuedFollowUps.length > 0 ? (
                  <FollowUpQueuePanel
                    followUps={queuedFollowUps}
                    cancelBusyId={followUpCancelBusyId}
                    escalateBusyId={followUpEscalateBusyId}
                    onCancel={(followUp) => void cancelQueuedFollowUp(followUp)}
                    onEscalate={(followUp) => void escalateQueuedFollowUp(followUp)}
                  />
                ) : null}
                {canRetryThread &&
                !showPlanApproval &&
                (planFailureMessage ||
                  activeThread?.status === "failed" ||
                  activeThread?.status === "blocked") ? (
                  <div className="thread-retry-banner" role="alert">
                    <div className="thread-retry-banner-body">
                      <strong>{activeThread?.status === "blocked" ? "会话受阻" : "此次请求失败"}</strong>
                      {retryBannerDetail ? (
                        <p>{retryBannerDetail}</p>
                      ) : (
                        <p className="thread-retry-banner-hint">{retryBannerNoDetailHint}</p>
                      )}
                      {retryBannerHint ? <p className="thread-retry-banner-hint">{retryBannerHint}</p> : null}
                    </div>
                    <div className="thread-retry-banner-actions">
                      {alternateAgentProfiles.length > 0 ? (
                        <label className="thread-retry-banner-route-picker">
                          <span>Agent Profile</span>
                          <select
                            className="mcp-field-input"
                            value={retryAgentProfileId}
                            disabled={retryBusy}
                            onChange={(event) => setRetryAgentProfileId(event.target.value)}
                          >
                            <option value="">请选择…</option>
                            {alternateAgentProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="thread-retry-banner-buttons">
                        {alternateAgentProfiles.length > 0 && retryAgentProfileId ? (
                          <button
                            type="button"
                            className="plan-button primary"
                            onClick={() => void retryActiveThread(retryAgentProfileId)}
                            disabled={retryBusy}
                          >
                            {retryBusy ? "正在重试…" : "用所选 Profile 重试"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={
                            alternateAgentProfiles.length > 0 && retryAgentProfileId
                              ? "plan-button"
                              : "plan-button primary"
                          }
                          onClick={() => void retryActiveThread()}
                          disabled={retryBusy}
                        >
                          {retryBusy
                            ? "正在重试…"
                            : activeThread?.status === "awaiting_plan"
                              ? "重试执行"
                              : alternateAgentProfiles.length > 0
                                ? "仍用当前 Profile 重试"
                                : "重试此次请求"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
                {showClarification && pendingClarification ? (
                  <ClarificationPanel
                    request={pendingClarification}
                    busy={clarificationBusy}
                    onSubmit={submitClarificationAnswers}
                    onDismiss={() => void dismissPendingClarification()}
                  />
                ) : null}
                {showBashApproval && pendingBashApproval ? (
                  <BashApprovalPanel
                    request={pendingBashApproval}
                    busy={bashApprovalBusy}
                    onApprove={() => void resolvePendingBashApproval("approved")}
                    onDeny={() => void resolvePendingBashApproval("denied")}
                  />
                ) : null}
                {showPlanApproval && pendingPlan && (
                  <PlanApprovalPanel
                    plan={pendingPlan}
                    busy={planActionBusy}
                    executionSummary={formatPlanExecutionSummary(
                      activeThread?.runtimeConfig?.subagentEnabled ??
                        composerRuntimeConfig?.subagentEnabled ??
                        defaultSubagentAvailability(),
                    )}
                    {...(planFailureMessage && { failureMessage: planFailureMessage })}
                    onApprove={approvePendingPlan}
                    onDismiss={dismissPendingPlan}
                  />
                )}
                <div ref={activityEndRef} className="activity-scroll-anchor" aria-hidden />
              </div>
            </div>
          )}
        </div>

        {!showLanding ? composer : null}
      </section>

      {showThreadInfo && activeThread ? (
        <ThreadInfoPanel
          threadId={activeThread.id}
          todos={coderTodos}
          threadStatus={activeThread.status}
          {...(projectWorkspace && { workspace: projectWorkspace })}
          {...(currentProjectPath && { workspacePath: currentProjectPath })}
          {...(projectWorkspace?.branch && { gitBranch: projectWorkspace.branch })}
          {...(projectWorkspace?.dirtyFileCount !== undefined && {
            dirtyFileCount: projectWorkspace.dirtyFileCount,
          })}
          {...(threadUsageSummary && { usageSummary: threadUsageSummary })}
          agentDisplayNames={activeRuntimeAgentDisplayNames}
          {...(workspaceDirtyFiles.length > 0 && { workspaceDirtyFiles })}
        />
      ) : null}

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
                      section.label.toLowerCase().includes(query) ||
                      group.label.toLowerCase().includes(query)
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
                            settingsSection === section.id
                              ? "settings-nav-item active"
                              : "settings-nav-item"
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

          <div className="settings-content">
            {settingsSection === "general" && (
              <GeneralSettingsPanel
                theme={appTheme}
                onThemeChange={setAppTheme}
              />
            )}

            {settingsSection === "skills" && (
              <SkillsSettingsPanel
                {...(skillsSnapshot && { snapshot: skillsSnapshot })}
                loading={isLoadingSkills}
                linking={skillsLinking}
                {...(skillsLinkResult && { lastLinkResult: skillsLinkResult })}
                onRefresh={() => void refreshSkillsList()}
                onLinkAgents={linkUserAgentsSkills}
              />
            )}

            {settingsSection === "mcp" && (
              <McpSettingsPanel
                servers={mcpSettings.servers}
                busy={isSavingSettings}
                onSave={saveMcpServer}
                onDelete={deleteMcpServer}
              />
            )}

            {settingsSection === "sessionSync" && (
              <SessionSyncSettingsPanel
                settings={sessionSyncSettings.settings}
                busy={isSavingSettings}
                onSave={saveSessionSyncSettings}
                onTestConnection={testSessionSyncConnection}
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
                <p className="settings-empty-hint">正在加载 Provider 配置…</p>
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
              <>
                <header className="settings-page-header">
                  <h1>Git</h1>
                  <p className="settings-page-desc">当前已打开项目的工作区 Git 状态。</p>
                </header>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <span className="settings-section-label">工作区</span>
                  </div>
                  <div className="settings-editor-card">
                    {projectWorkspace ? (
                      <>
                        <ul className="settings-kv-list">
                          <li>
                            <span>路径</span>
                            <strong>{projectWorkspace.path}</strong>
                          </li>
                          <li>
                            <span>分支</span>
                            <strong>
                              {projectWorkspace.isGitRepository
                                ? projectWorkspace.hasGitCommits === false
                                  ? "尚无提交"
                                  : (projectWorkspace.branch ?? "detached")
                                : "非 Git 仓库"}
                            </strong>
                          </li>
                          <li>
                            <span>未提交变更</span>
                            <strong>{projectWorkspace.dirtyFileCount} 个文件</strong>
                          </li>
                          {projectWorkspace.packageManager && (
                            <li>
                              <span>包管理器</span>
                              <strong>{projectWorkspace.packageManager}</strong>
                            </li>
                          )}
                        </ul>
                      </>
                    ) : currentProjectPath ? (
                      <p className="settings-empty">正在读取 Git 状态…</p>
                    ) : (
                      <p className="settings-empty">请先在主界面打开一个项目。</p>
                    )}
                  </div>
                </section>
              </>
            )}
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
}: {
  followUps: ThreadPendingFollowUp[];
  cancelBusyId: string | undefined;
  escalateBusyId: string | undefined;
  onCancel: (followUp: ThreadPendingFollowUp) => void;
  onEscalate: (followUp: ThreadPendingFollowUp) => void;
}) {
  return (
    <section className="follow-up-queue-panel" aria-label="已排队的后续消息">
      <div className="follow-up-queue-header">
        <Clock3 size={15} aria-hidden />
        <span>已排队 {followUps.length} 条后续消息</span>
      </div>
      <ul className="follow-up-queue-list">
        {followUps.map((followUp) => (
          <li key={followUp.id} className="follow-up-queue-item">
            <div className="follow-up-queue-item-main">
              <span className="follow-up-queue-priority">
                {followUp.priority === "escalated" ? "立即" : "排队"}
              </span>
              <span className="follow-up-queue-preview">{formatThreadFollowUpPreview(followUp)}</span>
            </div>
            <div className="follow-up-queue-actions">
              {followUp.priority !== "escalated" ? (
                <button
                  type="button"
                  className="follow-up-queue-action"
                  onClick={() => onEscalate(followUp)}
                  disabled={Boolean(escalateBusyId)}
                  title="立即处理"
                  aria-label="立即处理"
                >
                  {escalateBusyId === followUp.id ? <Activity size={14} /> : <Zap size={14} />}
                </button>
              ) : null}
              <button
                type="button"
                className="follow-up-queue-action"
                onClick={() => onCancel(followUp)}
                disabled={cancelBusyId === followUp.id || escalateBusyId === followUp.id}
                title="取消后续消息"
                aria-label="取消后续消息"
              >
                {cancelBusyId === followUp.id ? <Activity size={14} /> : <X size={14} />}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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
    type === "thread.retry" ||
    type === "thread.auto_retry"
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
