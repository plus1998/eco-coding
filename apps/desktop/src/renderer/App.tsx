import {
  Activity,
  AlertCircle,
  ArrowUp,
  ChevronLeft,
  Database,
  FolderOpen,
  GitBranch,
  MessageSquarePlus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Plug,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
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
import {
  AGENT_ROLES,
  buildThreadRuntimeConfigFromDefaults,
  getDefaultRouteProfileId,
  getRoutesForProfile,
  type AgentRole,
  type ThreadRuntimeConfig,
  type McpServerConfigInput,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type RouteCapabilityHint,
  type LinkAgentsSkillsResult,
  type SkillsListResult,
  type SubagentEnabledSettings,
  type SubagentRole,
  type ProxyBridgeSettingsSnapshot,
  type WorkflowSettingsSnapshot,
  type ClarificationRequest,
  type CoderTodoItem,
  type SessionSyncSettingsInput,
  type SessionSyncSettingsSnapshot,
  type ThreadActivityLine,
  type ThreadLiveEvent,
  type ThreadSubagentSessionTiming,
  type ThreadSubagentMetricsSummary,
  type ThreadPendingPlan,
  type ThreadStatus,
  type ThreadBillingSnapshot,
  type ThreadContextSnapshot,
  type ThreadSummary,
  type ThreadUsageSnapshot,
  type WorkspaceInfo,
} from "../shared/ipc";
import { isContinuableThreadStatus, isUsageNoiseMessage } from "../shared/thread-continuation";
import { StopThreadConfirmDialog } from "./StopThreadConfirmDialog";
import {
  extractPlanFailureMessage,
  resolveRetryBannerDetail,
  resolveRetryBannerHint,
  retryBannerNoDetailHint,
  resolveThreadMessageFromLiveEvent,
  shouldUpdateThreadSummaryFromLiveEvent,
} from "../shared/thread-failure-message";
import {
  COMPOSER_MAX_IMAGES,
  type ComposerImageAttachment,
  readImageFileAsAttachment,
  toPromptImageAttachments,
} from "./composer-attachments";
import { buildThreadUsageSummary } from "../shared/thread-usage-summary";
import {
  isReconnectActivityMessage,
  shouldClearReconnectActivity,
} from "../shared/activity-display";
import {
  isActivityStatusNoise,
  shouldScrollMainActivityFeedForLine,
  stripActivityStatusNoise,
} from "./activity-log";
import { formatPlanExecutionSummary, formatRoleModelLabel, mergeStreamText } from "@eco/runtime";
import { ActivityLogView } from "./ActivityLogView";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { ComposerAgentModels } from "./ComposerAgentModels";
import { ComposerPlanModeToggle } from "./ComposerPlanModeToggle";
import { ComposerRoutePopover, ComposerRoutePopoverTrigger } from "./ComposerRoutePopover";
import { ComposerSkillsBar } from "./ComposerSkillsBar";
import { ComposerSkillsInput, type ComposerSkillsInputHandle } from "./ComposerSkillsInput";
import { ComposerSkillsSlashMenu } from "./ComposerSkillsSlashMenu";
import {
  applySlashSkillSelection,
  buildSkillMap,
  filterSkillsForSlash,
  parseSlashQuery,
} from "./composer-skills";
import {
  dedupeSkillsByName,
  listSdkReadyProjectSkills,
  parseExplicitSkillNames,
  promptIncludesSkillName,
  type SkillInfo,
} from "../shared/skills";
import { ModelsSettingsPanel, type ModelsSettingsTab } from "./ModelsSettingsPanel";
import { SessionSyncSettingsPanel } from "./SessionSyncSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";
import { ClarificationPanel } from "./ClarificationPanel";
import { PlanApprovalPanel } from "./PlanApprovalPanel";
import { ThreadInfoPanel } from "./ThreadInfoPanel";
import { ProjectSidebarTree } from "./ProjectSidebarTree";
import {
  buildInitialProjectOrder,
  prependProjectOrder,
  reorderProjectPaths,
  sortProjectsByOrder,
  type ProjectReorderPosition,
} from "./project-sidebar-order";
import "./styles.css";

const emptySettings: ModelSettingsSnapshot = { providers: [], routeProfiles: [] };
const recentProjectsStorageKey = "eco.recent-projects";
const projectOrderStorageKey = "eco.project-order";
const collapsedProjectsStorageKey = "eco.sidebar.collapsed-projects";
const sidebarThreadsCollapsed = 5;

interface RecentProject {
  path: string;
  name: string;
  /** Set once when the project is first opened in the app; used for stable sidebar order. */
  importedAt: string;
}

const settingsSections = [
  { id: "models", label: "模型与路由", icon: SlidersHorizontal },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "sessionSync", label: "会话同步", icon: Database },
  { id: "git", label: "Git", icon: GitBranch },
] as const;

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

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("models");
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [projectWorkspace, setProjectWorkspace] = useState<WorkspaceInfo>();
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>();
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<Set<string>>(() => new Set());
  const [expandedProjectThreadPaths, setExpandedProjectThreadPaths] = useState<Set<string>>(() => new Set());
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
  const [subagentSettings, setSubagentSettings] = useState<SubagentEnabledSettings | null>(null);
  const [workflowSettings, setWorkflowSettings] = useState<WorkflowSettingsSnapshot | null>(null);
  const [proxyBridgeSettings, setProxyBridgeSettings] = useState<ProxyBridgeSettingsSnapshot | null>(null);
  const [isSavingSubagentSettings, setIsSavingSubagentSettings] = useState(false);
  const [isSavingWorkflowSettings, setIsSavingWorkflowSettings] = useState(false);
  const [isSavingProxyBridgeSettings, setIsSavingProxyBridgeSettings] = useState(false);
  const [composerRoutePopoverOpen, setComposerRoutePopoverOpen] = useState(false);
  const [modelsSettingsTab, setModelsSettingsTab] = useState<ModelsSettingsTab>("providers");
  const composerRouteButtonRef = useRef<HTMLButtonElement>(null);
  const composerAnchorRef = useRef<HTMLDivElement>(null);
  const [composerCursor, setComposerCursor] = useState(0);
  const [composerSkillActiveIndex, setComposerSkillActiveIndex] = useState(0);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsLinking, setSkillsLinking] = useState(false);
  const [skillsLinkResult, setSkillsLinkResult] = useState<LinkAgentsSkillsResult>();
  const [prompt, setPrompt] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerImageAttachment[]>([]);
  const [plannerCapability, setPlannerCapability] = useState<RouteCapabilityHint>();
  const [composerImageNotice, setComposerImageNotice] = useState<string>();
  const [isOpening, setIsOpening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [planActionBusy, setPlanActionBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<ThreadPendingPlan>();
  const [pendingClarification, setPendingClarification] = useState<ClarificationRequest>();
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string>();
  const [activityByThread, setActivityByThread] = useState<Record<string, ActivityLine[]>>({});
  const [subagentTimingsByThread, setSubagentTimingsByThread] = useState<
    Record<string, ThreadSubagentSessionTiming[]>
  >({});
  const [subagentMetricsByThread, setSubagentMetricsByThread] = useState<
    Record<string, ThreadSubagentMetricsSummary[]>
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
      window.eco.getSubagentSettings(),
      window.eco.getWorkflowSettings(),
      window.eco.getProxyBridgeSettings(),
    ]).then(([currentWorkspace, currentThreads, modelSettings, mcp, sessionSync, subagents, workflow, proxyBridge]) => {
      setWorkspace(currentWorkspace);
      if (currentWorkspace) {
        setSelectedProjectPath(currentWorkspace.path);
        registerImportedProject(currentWorkspace.path, currentWorkspace.name);
      }
      setThreads(currentThreads);
      setSettings(modelSettings);
      setMcpSettings(mcp);
      setSessionSyncSettings(sessionSync);
      setSubagentSettings(subagents);
      setWorkflowSettings(workflow);
      setProxyBridgeSettings(proxyBridge);
    });

    return window.eco.onThreadEvent((event) => {
      if (!isThreadLiveEvent(event) || event.threadId === "settings") {
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

      if (event.type === "clarification.requested" && event.clarification) {
        setPendingClarification(event.clarification);
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
        if (modelId) {
          setModelByThread((current) => ({
            ...current,
            [event.threadId]: {
              ...(current[event.threadId] ?? {}),
              [roleKey]: modelId,
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

      if (event.type === "thread.user_prompt") {
        if (event.activityLine) {
          appendActivityLine(event.threadId, event.activityLine);
        }
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
      const parsed = JSON.parse(saved) as Array<
        RecentProject & { lastUsedAt?: string; importedAt?: string }
      >;
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
    return [...merged.values()];
  }, [recentProjects, threads, workspace]);

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
          project,
          projectThreads,
          collapsed: collapsedProjectPaths.has(project.path),
          visibleThreads: projectThreads.slice(0, visibleCount),
          hasMore: !threadsExpanded && projectThreads.length > visibleCount,
        };
      }),
    [collapsedProjectPaths, expandedProjectThreadPaths, projects, threadsByProject],
  );

  const currentProjectPath = selectedProjectPath ?? workspace?.path ?? projects[0]?.path;
  const currentProjectName = currentProjectPath ? pathToName(currentProjectPath) : "项目";
  const activeThread = useMemo(
    () => (selectedThreadId ? threads.find((thread) => thread.id === selectedThreadId) : undefined),
    [selectedThreadId, threads],
  );
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
    () =>
      dedupeSkillsByName(
        (skillsSnapshot?.userSkills ?? []).filter((skill) => skill.sdkReady),
      ),
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
    () =>
      (skillsSnapshot?.agentsOnlySkills ?? []).filter((skill) => skill.source === "project"),
    [skillsSnapshot?.agentsOnlySkills],
  );
  const showProjectSkillsPanel =
    Boolean(currentProjectPath) &&
    (isLoadingSkills || projectSdkReadySkills.length > 0 || projectAgentsOnly.length > 0);
  const composerSkillSlash = useMemo(
    () => parseSlashQuery(prompt, composerCursor),
    [prompt, composerCursor],
  );
  const referencedSkillNames = useMemo(
    () => new Set(parseExplicitSkillNames(prompt)),
    [prompt],
  );
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

  const buildComposerDefaultConfig = useCallback((): ThreadRuntimeConfig | undefined => {
    if (!subagentSettings || !workflowSettings || settings.routeProfiles.length === 0) {
      return undefined;
    }
    try {
      return buildThreadRuntimeConfigFromDefaults({
        settings,
        subagentDefaults: subagentSettings,
        workflowDefaults: workflowSettings,
        routeProfileId: composerRuntimeConfig?.routeProfileId ?? getDefaultRouteProfileId(settings),
      });
    } catch {
      return undefined;
    }
  }, [settings, subagentSettings, workflowSettings, composerRuntimeConfig?.routeProfileId]);

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
    settings.routeProfiles,
    subagentSettings,
    workflowSettings,
  ]);

  const activeRoutes = useMemo(() => {
    const profileId = composerRuntimeConfig?.routeProfileId;
    if (!profileId) {
      return [];
    }
    return getRoutesForProfile(settings, profileId) ?? [];
  }, [settings, composerRuntimeConfig?.routeProfileId]);

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
  const routesReady = AGENT_ROLES.every((role) => {
    const route = activeRoutes.find((candidate) => candidate.role === role);
    const provider = route ? providerById.get(route.providerId) : undefined;
    return Boolean(route?.modelId.trim() && provider?.enabled);
  });
  const threadAcceptsInput = !activeThread || isContinuableThreadStatus(activeThread.status);
  const plannerSupportsImages =
    !plannerCapability?.capabilitiesResolved || plannerCapability.supportsImageInput;
  const canPasteComposerImages = plannerSupportsImages;

  const canSend = Boolean(
    currentProjectPath &&
      (prompt.trim() || composerAttachments.length > 0) &&
      routesReady &&
      !isStarting &&
      !planActionBusy &&
      !clarificationBusy &&
      !pendingClarification &&
      threadAcceptsInput,
  );
  const showPlanApproval = activeThread?.status === "awaiting_plan" && pendingPlan?.threadId === activeThread.id;
  const showClarification =
    pendingClarification && activeThread && pendingClarification.threadId === activeThread.id;
  const planFailureMessage = activeThread ? extractPlanFailureMessage(activeThread.message) : undefined;
  const retryBannerDetail = activeThread
    ? resolveRetryBannerDetail(activeThread.message, activeThread.status)
    : undefined;
  const retryBannerHint = retryBannerDetail ? resolveRetryBannerHint(retryBannerDetail) : undefined;
  const alternateRouteProfiles = useMemo(
    () =>
      settings.routeProfiles.filter(
        (profile) => profile.id !== composerRuntimeConfig?.routeProfileId,
      ),
    [settings.routeProfiles, composerRuntimeConfig?.routeProfileId],
  );
  const [retryRouteProfileId, setRetryRouteProfileId] = useState<string>("");

  useEffect(() => {
    setRetryRouteProfileId("");
  }, [activeThread?.id]);

  const canRetryThread = Boolean(
    activeThread &&
      routesReady &&
      !isStarting &&
      !planActionBusy &&
      !clarificationBusy &&
      !pendingClarification &&
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
  const subagentTimings = activeThread ? subagentTimingsByThread[activeThread.id] : undefined;
  const subagentMetrics = activeThread ? subagentMetricsByThread[activeThread.id] : undefined;
  const coderTodos = activeThread ? (todosByThread[activeThread.id] ?? []) : [];
  const threadUsageByRole = activeThread ? usageByThread[activeThread.id] : undefined;
  const threadModelByRole = activeThread ? modelByThread[activeThread.id] : undefined;
  const threadUsageSummary = useMemo(() => {
    if (!activeThread) {
      return undefined;
    }
    return buildThreadUsageSummary({
      ...(billingByThread[activeThread.id] && { billing: billingByThread[activeThread.id] }),
      ...(contextByThread[activeThread.id] && { context: contextByThread[activeThread.id] }),
      ...(threadUsageByRole && { usageByRole: threadUsageByRole }),
    });
  }, [activeThread, threadUsageByRole, billingByThread, contextByThread]);
  const selectedRouteProfile = useMemo(
    () =>
      settings.routeProfiles.find((profile) => profile.id === composerRuntimeConfig?.routeProfileId),
    [settings.routeProfiles, composerRuntimeConfig?.routeProfileId],
  );
  const canEditComposerConfig =
    !activeThread ||
    (threadAcceptsInput &&
      activeThread.status !== "running" &&
      activeThread.status !== "queued");
  const canSwitchRouteProfile = canEditComposerConfig;
  const agentModelLabels = useMemo(
    () =>
      AGENT_ROLES.map((role) => {
        const route = activeRoutes.find((candidate) => candidate.role === role);
        const configured = route?.modelId.trim() || undefined;
        const live = threadModelByRole?.[role];
        const modelId = live ?? configured;
        return {
          role,
          modelId,
          title: formatRoleModelLabel(role, modelId),
        };
      }),
    [activeRoutes, threadModelByRole],
  );
  const plannerModelLabel = useMemo(
    () => agentModelLabels.find((entry) => entry.role === "planner"),
    [agentModelLabels],
  );
  const activityModelByRole = useMemo(() => {
    const configured: Record<string, string> = {};
    for (const route of activeRoutes) {
      const modelId = route.modelId.trim();
      if (modelId) {
        configured[route.role] = modelId;
      }
    }
    return { ...configured, ...threadModelByRole };
  }, [activeRoutes, threadModelByRole]);
  const activityEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<ComposerSkillsInputHandle>(null);
  const COMPOSER_TEXTAREA_MAX_HEIGHT = 200;

  const composerSkillsByName = useMemo(
    () => buildSkillMap([...userSkills, ...projectSdkReadySkills]),
    [userSkills, projectSdkReadySkills],
  );

  const scrollActivityFeedToEnd = useCallback((force = false) => {
    const container = activityEndRef.current?.parentElement;
    if (!container) {
      return;
    }
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
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

  function restorePrompt(text: string) {
    setPrompt(text);
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
    setIsStarting(true);
    const attachments =
      composerAttachments.length > 0 ? toPromptImageAttachments(composerAttachments) : undefined;
    const messagePrompt =
      prompt.trim() || (attachments?.length ? "请查看并分析我附上的图片。" : "");
    if (!composerRuntimeConfig) {
      setError("请先配置角色路由方案。");
      setIsStarting(false);
      return;
    }
    try {
      if (activeThread && isContinuableThreadStatus(activeThread.status)) {
        const result = await window.eco.continueThread({
          threadId: activeThread.id,
          prompt: messagePrompt,
          runtimeConfig: composerRuntimeConfig,
          ...(attachments && { attachments }),
        });
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
        );
        setPendingPlan(undefined);
      } else {
        const result = await window.eco.startThread({
          workspacePath: currentProjectPath,
          prompt: messagePrompt,
          runtimeConfig: composerRuntimeConfig,
          ...(attachments && { attachments }),
        });
        setThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.thread.id)]);
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
      setComposerAttachments([]);
      setComposerImageNotice(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsStarting(false);
    }
  }

  async function retryActiveThread(routeProfileId?: string) {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    setRetryBusy(true);
    try {
      const result = await window.eco.retryThread({
        threadId: activeThread.id,
        ...(routeProfileId ? { routeProfileId } : {}),
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
    const userAgents =
      skillsSnapshot?.agentsOnlySkills.filter((skill) => skill.source === "user") ?? [];
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

  function openModelsSettings(tab: ModelsSettingsTab = "providers") {
    setModelsSettingsTab(tab);
    setSettingsSection("models");
    setSettingsOpen(true);
  }

  async function persistComposerRuntimeConfig(next: ThreadRuntimeConfig): Promise<void> {
    setComposerRuntimeConfig(next);
    if (!activeThread || !window.eco || !canEditComposerConfig) {
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
    const next: ThreadRuntimeConfig = { ...composerRuntimeConfig, routeProfileId: profileId };
    await persistComposerRuntimeConfig(next);
    setComposerRoutePopoverOpen(false);
  }

  async function toggleComposerSubagent(role: SubagentRole, enabled: boolean) {
    if (!composerRuntimeConfig || role === "coder") {
      return;
    }
    const next: ThreadRuntimeConfig = {
      ...composerRuntimeConfig,
      subagentEnabled: { ...composerRuntimeConfig.subagentEnabled, [role]: enabled },
    };
    await persistComposerRuntimeConfig(next);
  }

  async function toggleComposerPlanMode(enabled: boolean) {
    if (!composerRuntimeConfig || !canEditComposerConfig) {
      return;
    }
    const next: ThreadRuntimeConfig = { ...composerRuntimeConfig, planModeEnabled: enabled };
    await persistComposerRuntimeConfig(next);
  }

  async function saveWorkflowSettings(next: WorkflowSettingsSnapshot) {
    if (!window.eco) return;
    setIsSavingWorkflowSettings(true);
    setError(undefined);
    try {
      const saved = await window.eco.saveWorkflowSettings(next);
      setWorkflowSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingWorkflowSettings(false);
    }
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

  async function saveSubagentSettings(next: SubagentEnabledSettings) {
    if (!window.eco) return;
    setIsSavingSubagentSettings(true);
    setError(undefined);
    try {
      const saved = await window.eco.saveSubagentSettings(next);
      setSubagentSettings(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSubagentSettings(false);
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
    setActivityByThread({});
    setTodosByThread({});
  }

  function registerImportedProject(path: string, name: string) {
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
  }

  function selectThread(thread: ThreadSummary) {
    setSelectedThreadId(thread.id);
    setSelectedProjectPath(thread.workspacePath);
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
    setPrompt("");
    setComposerAttachments([]);
    setComposerImageNotice(undefined);
    setError(undefined);
  }

  async function addComposerImageFiles(files: FileList | File[]) {
    if (!canPasteComposerImages) {
      setComposerImageNotice("当前规划模型不支持图片输入。");
      return;
    }
    if (plannerCapability && !plannerCapability.capabilitiesResolved) {
      setComposerImageNotice("未匹配 models.dev，请自行确认规划模型是否支持图片。");
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
          composerSkillMatches.length === 0
            ? 0
            : (current + 1) % composerSkillMatches.length,
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

  const composer = (
    <div className="codex-composer-wrap">
      {composerImageNotice && (
        <p className="composer-image-notice">{composerImageNotice}</p>
      )}
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
          onPaste={canPasteComposerImages ? handleComposerPaste : undefined}
          onKeyDown={handleComposerKeyDown}
          maxHeight={COMPOSER_TEXTAREA_MAX_HEIGHT}
          placeholder={
            pendingClarification
              ? "请先在上方回答问题"
              : activeThread?.status === "awaiting_plan"
                ? "请先确认或忽略上方计划"
                : activeThread && isContinuableThreadStatus(activeThread.status)
                  ? "继续对话；若需改计划请说明，将重新生成完整计划…"
                  : activeThread
                    ? "当前对话不可发送"
                    : "尽管问"
          }
          disabled={Boolean(activeThread && !threadAcceptsInput)}
        />
        <div className="composer-footer">
          <div className="composer-route-control">
            <ComposerRoutePopoverTrigger
              buttonRef={composerRouteButtonRef}
              open={composerRoutePopoverOpen}
              disabled={!canSwitchRouteProfile || isSavingSettings}
              profileName={selectedRouteProfile?.name}
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
              onClose={() => setComposerRoutePopoverOpen(false)}
              onSelectProfile={selectComposerRouteProfile}
              selectedProfileId={composerRuntimeConfig?.routeProfileId}
              onOpenFullSettings={() => openModelsSettings("routes")}
            />
          </div>
          <div className="composer-agent-labels">
            {composerRuntimeConfig ? (
              <ComposerPlanModeToggle
                planModeEnabled={composerRuntimeConfig.planModeEnabled}
                plannerModelId={plannerModelLabel?.modelId}
                plannerTitle={plannerModelLabel?.title}
                canEdit={canEditComposerConfig}
                saving={isSavingSettings}
                onToggle={(enabled) => void toggleComposerPlanMode(enabled)}
              />
            ) : null}
            <ComposerAgentModels
              labels={agentModelLabels}
              subagentSettings={composerRuntimeConfig?.subagentEnabled ?? subagentSettings}
              canEditSubagents={canEditComposerConfig}
              subagentSaving={isSavingSettings}
              onToggleSubagent={(role, enabled) => void toggleComposerSubagent(role, enabled)}
            />
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
          ) : (
            <button
              type="button"
              className="send-button"
              onClick={sendComposerMessage}
              disabled={!canSend}
              aria-label="发送"
            >
              {isStarting ? <Activity size={18} /> : <ArrowUp size={18} />}
            </button>
          )}
        </div>
        {error && (
          <p className="composer-error">
            <AlertCircle size={14} /> {error}
          </p>
        )}
        {!routesReady && (
          <p className="composer-hint">
            请先在
            <button type="button" className="link-button" onClick={() => openModelsSettings("providers")}>
              设置
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
          <div className="sidebar-section-label">项目</div>
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
          />
        </div>

        <button
          type="button"
          className="sidebar-settings"
          onClick={() => openModelsSettings("providers")}
        >
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
                  onRestorePrompt={restorePrompt}
                  onPlannerLayoutChange={() => scrollActivityFeedToEnd(true)}
                  {...(Object.keys(activityModelByRole).length > 0 && { modelByRole: activityModelByRole })}
                  {...(threadUsageByRole && { usageByRole: threadUsageByRole })}
                  {...(subagentTimings && { subagentTimings })}
                  {...(subagentMetrics && { subagentMetrics })}
                  {...(activeThread &&
                    contextByThread[activeThread.id] && { context: contextByThread[activeThread.id] })}
                />
                {canRetryThread &&
                !showPlanApproval &&
                (planFailureMessage ||
                  activeThread?.status === "failed" ||
                  activeThread?.status === "blocked") ? (
                  <div className="thread-retry-banner" role="alert">
                    <div className="thread-retry-banner-body">
                      <strong>
                        {activeThread?.status === "blocked" ? "会话受阻" : "此次请求失败"}
                      </strong>
                      {retryBannerDetail ? (
                        <p>{retryBannerDetail}</p>
                      ) : (
                        <p className="thread-retry-banner-hint">{retryBannerNoDetailHint}</p>
                      )}
                      {retryBannerHint ? (
                        <p className="thread-retry-banner-hint">{retryBannerHint}</p>
                      ) : null}
                    </div>
                    <div className="thread-retry-banner-actions">
                      {alternateRouteProfiles.length > 0 ? (
                        <label className="thread-retry-banner-route-picker">
                          <span>路由方案</span>
                          <select
                            className="mcp-field-input"
                            value={retryRouteProfileId}
                            disabled={retryBusy}
                            onChange={(event) => setRetryRouteProfileId(event.target.value)}
                          >
                            <option value="">请选择…</option>
                            {alternateRouteProfiles.map((profile) => (
                              <option key={profile.id} value={profile.id}>
                                {profile.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <div className="thread-retry-banner-buttons">
                        {alternateRouteProfiles.length > 0 && retryRouteProfileId ? (
                          <button
                            type="button"
                            className="plan-button primary"
                            onClick={() => void retryActiveThread(retryRouteProfileId)}
                            disabled={retryBusy}
                          >
                            {retryBusy ? "正在重试…" : "用所选方案重试"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={
                            alternateRouteProfiles.length > 0 && retryRouteProfileId
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
                              : alternateRouteProfiles.length > 0
                                ? "仍用当前方案重试"
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
                {showPlanApproval && pendingPlan && (
                  <PlanApprovalPanel
                    plan={pendingPlan}
                    busy={planActionBusy}
                    {...(subagentSettings && {
                      executionSummary: formatPlanExecutionSummary(subagentSettings),
                    })}
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
          workspace={projectWorkspace}
          workspacePath={currentProjectPath}
          gitBranch={projectWorkspace?.branch}
          dirtyFileCount={projectWorkspace?.dirtyFileCount}
          todos={coderTodos}
          threadStatus={activeThread.status}
          usageSummary={threadUsageSummary}
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
            <button type="button" className="settings-nav-back" onClick={() => setSettingsOpen(false)}>
              <ChevronLeft size={18} />
              返回应用
            </button>
            {settingsSections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={settingsSection === section.id ? "settings-nav-item active" : "settings-nav-item"}
                  onClick={() => setSettingsSection(section.id)}
                >
                  <Icon size={16} />
                  {section.label}
                </button>
              );
            })}
          </aside>

          <div className="settings-content">
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

            {settingsSection === "models" &&
              (subagentSettings && workflowSettings && proxyBridgeSettings ? (
                <ModelsSettingsPanel
                  settings={settings}
                  subagentSettings={subagentSettings}
                  workflowSettings={workflowSettings}
                  proxyBridgeSettings={proxyBridgeSettings}
                  subagentSettingsSaving={isSavingSubagentSettings}
                  workflowSettingsSaving={isSavingWorkflowSettings}
                  proxyBridgeSettingsSaving={isSavingProxyBridgeSettings}
                  initialTab={modelsSettingsTab}
                  busy={isSavingSettings}
                  onSettingsChange={setSettings}
                  onSavingChange={setIsSavingSettings}
                  onSubagentSettingsChange={(next) => void saveSubagentSettings(next)}
                  onWorkflowSettingsChange={(next) => void saveWorkflowSettings(next)}
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

function pathToName(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
