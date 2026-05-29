import {
  Activity,
  AlertCircle,
  ArrowUp,
  ChevronLeft,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquarePlus,
  RotateCcw,
  Settings2,
  Plug,
  SlidersHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AGENT_ROLES,
  type AgentRole,
  type McpServerConfigInput,
  type McpSettingsSnapshot,
  type ModelSettingsSnapshot,
  type SkillsListResult,
  type AgentSkillAssignments,
  type ClarificationRequest,
  type CoderTodoItem,
  type ThreadActivityLine,
  type ThreadLiveEvent,
  type ThreadPendingPlan,
  type ThreadStatus,
  type ThreadSummary,
  type WorkspaceInfo,
} from "../shared/ipc";
import { formatSubagentLabel, mergeStreamText } from "@eco/runtime";
import { ActivityLogView } from "./ActivityLogView";
import { resolveActiveSubagent } from "./activity-log";
import { McpSettingsPanel } from "./McpSettingsPanel";
import { ModelsSettingsPanel } from "./ModelsSettingsPanel";
import { SkillsSettingsPanel } from "./SkillsSettingsPanel";
import { ClarificationPanel } from "./ClarificationPanel";
import { PlanApprovalPanel } from "./PlanApprovalPanel";
import { CoderTodoPanel } from "./CoderTodoPanel";
import "./styles.css";

const emptySettings: ModelSettingsSnapshot = { providers: [], routes: [] };
const recentProjectsStorageKey = "eco.recent-projects";

interface RecentProject {
  path: string;
  name: string;
  lastUsedAt: string;
}

const settingsSections = [
  { id: "models", label: "模型与路由", icon: SlidersHorizontal },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "skills", label: "Skills", icon: Sparkles },
  { id: "git", label: "Git", icon: GitBranch },
] as const;

const emptyMcpSettings: McpSettingsSnapshot = { servers: [] };

type SettingsSectionId = (typeof settingsSections)[number]["id"];

type ActivityLine = ThreadActivityLine;

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("models");
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>();
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [settings, setSettings] = useState<ModelSettingsSnapshot>(emptySettings);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsSnapshot>(emptyMcpSettings);
  const [skillsSnapshot, setSkillsSnapshot] = useState<SkillsListResult>();
  const [agentSkillsAssignments, setAgentSkillsAssignments] = useState<AgentSkillAssignments | null>(null);
  const [isSavingAgentSkills, setIsSavingAgentSkills] = useState(false);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [planActionBusy, setPlanActionBusy] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<ThreadPendingPlan>();
  const [pendingClarification, setPendingClarification] = useState<ClarificationRequest>();
  const [clarificationBusy, setClarificationBusy] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string>();
  const [activityByThread, setActivityByThread] = useState<Record<string, ActivityLine[]>>({});
  const [todosByThread, setTodosByThread] = useState<Record<string, CoderTodoItem[]>>({});
  const [pendingWorktreeApply, setPendingWorktreeApply] = useState<{
    worktreePath: string;
    changedFiles: string[];
  }>();
  const [worktreeApplyBusy, setWorktreeApplyBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [rollbackBusy, setRollbackBusy] = useState(false);

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
    ]).then(([currentWorkspace, currentThreads, modelSettings, mcp]) => {
      setWorkspace(currentWorkspace);
      if (currentWorkspace) {
        setSelectedProjectPath(currentWorkspace.path);
        rememberProject({
          path: currentWorkspace.path,
          name: currentWorkspace.name,
          lastUsedAt: new Date().toISOString(),
        });
      }
      setThreads(currentThreads);
      setSettings(modelSettings);
      setMcpSettings(mcp);
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

      setThreads((current) =>
        current.map((thread) =>
          thread.id === event.threadId
            ? {
                ...thread,
                message: event.message,
                status: statusFromLiveEvent(event.type, thread.status),
              }
            : thread,
        ),
      );

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

      appendActivityLine(event.threadId, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: event.role ?? "system",
        message: event.message,
        ...(event.stream !== undefined && { stream: event.stream }),
      });
    });
  }, []);

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
    }

    return () => {
      cancelled = true;
    };
  }, [selectedThreadId]);

  useEffect(() => {
    const saved = window.localStorage.getItem(recentProjectsStorageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as RecentProject[];
      if (Array.isArray(parsed)) {
        setRecentProjects(parsed);
      }
    } catch {
      window.localStorage.removeItem(recentProjectsStorageKey);
    }
  }, []);

  const projects = useMemo(() => {
    const merged = new Map<string, RecentProject>();
    for (const project of recentProjects) {
      merged.set(project.path, project);
    }
    if (workspace) {
      merged.set(workspace.path, {
        path: workspace.path,
        name: workspace.name,
        lastUsedAt: new Date().toISOString(),
      });
    }
    for (const thread of threads) {
      if (!merged.has(thread.workspacePath)) {
        merged.set(thread.workspacePath, {
          path: thread.workspacePath,
          name: pathToName(thread.workspacePath),
          lastUsedAt: thread.createdAt,
        });
      }
    }
    return [...merged.values()].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }, [recentProjects, threads, workspace]);

  const currentProjectPath = selectedProjectPath ?? workspace?.path ?? projects[0]?.path;
  const currentProjectName = currentProjectPath ? pathToName(currentProjectPath) : "项目";
  const projectThreads = useMemo(
    () => threads.filter((thread) => !currentProjectPath || thread.workspacePath === currentProjectPath),
    [currentProjectPath, threads],
  );
  const activeThread = projectThreads.find((thread) => thread.id === selectedThreadId);
  const workspaceMatchesProject = workspace?.path === currentProjectPath;

  useEffect(() => {
    if (!activeThread?.id || !window.eco) {
      setPendingWorktreeApply(undefined);
      return undefined;
    }

    let cancelled = false;
    void window.eco.getWorktreeStatus(activeThread.id).then((status) => {
      if (cancelled) {
        return;
      }
      if (status.exists && status.changedFiles.length > 0) {
        setPendingWorktreeApply({
          worktreePath: status.worktreePath,
          changedFiles: status.changedFiles,
        });
      } else {
        setPendingWorktreeApply(undefined);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeThread?.id, activeThread?.status, activeThread?.message]);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "skills" || !window.eco) {
      return;
    }
    void refreshSkillsList(currentProjectPath);
  }, [settingsOpen, settingsSection, currentProjectPath]);

  const providerById = useMemo(
    () => new Map(settings.providers.map((provider) => [provider.id, provider])),
    [settings.providers],
  );
  const routesReady = AGENT_ROLES.every((role) => {
    const route = settings.routes.find((candidate) => candidate.role === role);
    const provider = route ? providerById.get(route.providerId) : undefined;
    return Boolean(route?.modelId.trim() && provider?.enabled && provider.hasApiKey);
  });
  const threadAcceptsInput =
    !activeThread || activeThread.status === "idle" || activeThread.status === "completed";
  const canSend = Boolean(
    currentProjectPath &&
      prompt.trim() &&
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
  const canStopThread =
    activeThread?.status === "running" ||
    activeThread?.status === "queued" ||
    activeThread?.status === "awaiting_plan";
  const canRollbackThread = activeThread?.status === "completed" || activeThread?.status === "idle";

  const plannerModelLabel = useMemo(() => {
    const route = settings.routes.find((candidate) => candidate.role === "planner");
    if (route?.modelId.trim()) return route.modelId;
    return settings.providers[0]?.defaultModel ?? "model";
  }, [settings.providers, settings.routes]);

  const activityLines = activeThread ? (activityByThread[activeThread.id] ?? []) : [];
  const coderTodos = activeThread ? (todosByThread[activeThread.id] ?? []) : [];
  const activeSubagent = useMemo(
    () => resolveActiveSubagent(activityLines, activeThread?.status),
    [activityLines, activeThread?.status],
  );
  const activityEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const end = activityEndRef.current;
    if (!end) {
      return;
    }
    const isStreaming = activityLines.at(-1)?.stream === true;
    end.scrollIntoView({ block: "end", behavior: isStreaming ? "auto" : "smooth" });
  }, [activityLines, activeThread?.id]);

  function appendActivityLine(threadId: string, line: ActivityLine) {
    setActivityByThread((current) => {
      const previous = current[threadId] ?? [];
      const last = previous[previous.length - 1];
      if (
        last &&
        !line.stream &&
        last.role === line.role &&
        last.message === line.message &&
        last.stream !== true
      ) {
        return current;
      }
      if (line.stream && last?.stream) {
        return {
          ...current,
          [threadId]: [
            ...previous.slice(0, -1),
            {
              ...last,
              role: line.role,
              message: mergeStreamText(last.message, line.message),
            },
          ].slice(-300),
        };
      }
      return {
        ...current,
        [threadId]: [...previous, line].slice(-300),
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
        setWorkspace(result.workspace);
        setSelectedProjectPath(result.workspace.path);
        rememberProject({
          path: result.workspace.path,
          name: result.workspace.name,
          lastUsedAt: new Date().toISOString(),
        });
        setSelectedThreadId(undefined);
        setActivityByThread({});
        setTodosByThread({});
      }
    } catch (caught) {
      setError(errorMessage(caught));
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
    if (!currentProjectPath || !window.eco || !prompt.trim()) return;
    setError(undefined);
    setIsStarting(true);
    try {
      if (activeThread?.status === "idle") {
        const result = await window.eco.continueThread({
          threadId: activeThread.id,
          prompt,
        });
        setThreads((current) =>
          current.map((thread) => (thread.id === result.thread.id ? result.thread : thread)),
        );
        setPendingPlan(undefined);
        setTodosByThread((current) => ({
          ...current,
          [result.thread.id]: [],
        }));
      } else {
        const result = await window.eco.startThread({
          workspacePath: currentProjectPath,
          prompt,
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
      rememberProject({
        path: currentProjectPath,
        name: pathToName(currentProjectPath),
        lastUsedAt: new Date().toISOString(),
      });
      setPrompt("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsStarting(false);
    }
  }

  async function approvePendingPlan() {
    if (!activeThread || !window.eco) return;
    setError(undefined);
    setPlanActionBusy(true);
    try {
      const result = await window.eco.approvePlan(activeThread.id);
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

  async function applyPendingWorktree() {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    setWorktreeApplyBusy(true);
    try {
      await window.eco.applyWorktree(activeThread.id);
      setPendingWorktreeApply(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setWorktreeApplyBusy(false);
    }
  }

  async function cancelActiveThread() {
    if (!activeThread || !window.eco) {
      return;
    }
    setError(undefined);
    setCancelBusy(true);
    try {
      await window.eco.cancelThread(activeThread.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCancelBusy(false);
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
      setPendingWorktreeApply(undefined);
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
      const [snapshot, assignments] = await Promise.all([
        window.eco.listSkills(workspacePath),
        window.eco.getAgentSkillsAssignments(),
      ]);
      setSkillsSnapshot(snapshot);
      setAgentSkillsAssignments(assignments);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsLoadingSkills(false);
    }
  }

  async function saveAgentSkillsAssignments(assignments: AgentSkillAssignments) {
    if (!window.eco) return;
    setIsSavingAgentSkills(true);
    setError(undefined);
    try {
      const saved = await window.eco.saveAgentSkillsAssignments(assignments);
      setAgentSkillsAssignments(saved);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingAgentSkills(false);
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

  function rememberProject(project: RecentProject) {
    setRecentProjects((current) => {
      const next = [project, ...current.filter((item) => item.path !== project.path)].slice(0, 12);
      window.localStorage.setItem(recentProjectsStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function switchProject(nextPath: string) {
    setSelectedProjectPath(nextPath);
    setSelectedThreadId(undefined);
    const entry = projects.find((project) => project.path === nextPath);
    if (entry) {
      rememberProject({ ...entry, lastUsedAt: new Date().toISOString() });
    }
  }

  function startNewChat() {
    setSelectedThreadId(undefined);
    setPrompt("");
    setError(undefined);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) void sendComposerMessage();
    }
  }

  return (
    <main className="shell">
      <aside className="codex-sidebar">
        <button type="button" className="sidebar-action" onClick={startNewChat}>
          <MessageSquarePlus size={18} />
          新对话
        </button>

        <div className="sidebar-section">
          <div className="sidebar-section-label">项目</div>
          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project.path}
                type="button"
                className={
                  currentProjectPath === project.path ? "project-item active" : "project-item"
                }
                onClick={() => switchProject(project.path)}
              >
                <Folder size={16} />
                <span>{project.name}</span>
              </button>
            ))}
            <button type="button" className="project-item muted" onClick={openWorkspace} disabled={isOpening}>
              <FolderOpen size={16} />
              <span>打开项目…</span>
            </button>
          </div>
        </div>

        <div className="sidebar-section sidebar-section-grow">
          <div className="sidebar-section-label">对话</div>
          {projectThreads.length > 0 ? (
            <div className="chat-list">
              {projectThreads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={activeThread?.id === thread.id ? "chat-item active" : "chat-item"}
                  onClick={() => setSelectedThreadId(thread.id)}
                >
                  <span className="chat-item-title">{thread.title}</span>
                  <span className={`status-dot ${thread.status}`} title={thread.status} />
                </button>
              ))}
            </div>
          ) : (
            <p className="sidebar-empty">暂无对话</p>
          )}
        </div>

        <button
          type="button"
          className="sidebar-settings"
          onClick={() => {
            setSettingsSection("models");
            setSettingsOpen(true);
          }}
        >
          <Settings2 size={18} />
          设置
        </button>
      </aside>

      <section className="codex-main">
        <div className="codex-main-scroll">
          {!activeThread && activityLines.length === 0 ? (
            <h1 className="codex-hero">
              {currentProjectPath
                ? `我们应该在 ${currentProjectName} 中构建什么？`
                : "打开一个项目开始编码"}
            </h1>
          ) : (
            <div className="activity-feed">
              {activeThread && (
                <header className="activity-header">
                  <h2>{activeThread.title}</h2>
                  <div className="activity-header-badges">
                    {activeSubagent ? (
                      <span className="subagent-chip">{formatSubagentLabel(activeSubagent)}</span>
                    ) : null}
                    <span className={`status-chip ${activeThread.status}`}>{activeThread.status}</span>
                    <div className="activity-header-actions">
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
                      {canStopThread ? (
                        <button
                          type="button"
                          className="activity-icon-button danger"
                          onClick={() => void cancelActiveThread()}
                          disabled={cancelBusy}
                          title="停止当前运行"
                          aria-label="停止"
                        >
                          <Square size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </header>
              )}
              <div className="activity-messages">
                {pendingWorktreeApply ? (
                  <div className="worktree-apply-banner" role="status">
                    <p>
                      隔离工作树中仍有 {pendingWorktreeApply.changedFiles.length} 个文件未合并到主工作区：
                      <code>{pendingWorktreeApply.changedFiles.join(", ")}</code>
                    </p>
                    <button
                      type="button"
                      className="plan-button primary"
                      onClick={() => void applyPendingWorktree()}
                      disabled={worktreeApplyBusy}
                    >
                      {worktreeApplyBusy ? "正在合并…" : "应用到工作区"}
                    </button>
                  </div>
                ) : null}
                <CoderTodoPanel todos={coderTodos} />
                <ActivityLogView
                  lines={activityLines}
                  {...(activeThread && { thread: activeThread })}
                  onRestorePrompt={restorePrompt}
                />
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

        <div className="codex-composer-wrap">
          <div className="codex-composer">
            <textarea
              ref={composerRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={
                pendingClarification
                  ? "请先在上方回答问题"
                  : activeThread?.status === "awaiting_plan"
                    ? "请先确认或忽略上方计划"
                    : activeThread?.status === "idle"
                      ? "继续对话…"
                      : "尽管问"
              }
              disabled={Boolean(activeThread && !threadAcceptsInput)}
              rows={2}
            />
            <div className="composer-toolbar">
              <button
                type="button"
                className="model-pill"
                onClick={() => {
                  setSettingsSection("models");
                  setSettingsOpen(true);
                }}
                title="在设置中配置模型"
              >
                {plannerModelLabel}
              </button>
              <button
                type="button"
                className="send-button"
                onClick={sendComposerMessage}
                disabled={!canSend}
                aria-label="发送"
              >
                {isStarting ? <Activity size={18} /> : <ArrowUp size={18} />}
              </button>
            </div>
            <div className="composer-context">
              <span className="context-chip">
                <Folder size={14} />
                {currentProjectName}
              </span>
              {workspaceMatchesProject && workspace?.isGitRepository && (
                <span className="context-chip">
                  <GitBranch size={14} />
                  {workspace.branch ?? "detached"}
                </span>
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
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setSettingsSection("models");
                    setSettingsOpen(true);
                  }}
                >
                  设置
                </button>
                中配置模型与 API Key
              </p>
            )}
          </div>
        </div>
      </section>

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
            {settingsSection === "skills" &&
              (agentSkillsAssignments ? (
                <SkillsSettingsPanel
                  {...(skillsSnapshot && { snapshot: skillsSnapshot })}
                  assignments={agentSkillsAssignments}
                  loading={isLoadingSkills}
                  saving={isSavingAgentSkills}
                  {...(currentProjectPath && { workspaceLabel: currentProjectPath })}
                  onRefresh={() => void refreshSkillsList(currentProjectPath)}
                  onSaveAssignments={saveAgentSkillsAssignments}
                />
              ) : (
                <p className="settings-empty-hint">正在加载 Skills 配置…</p>
              ))}

            {settingsSection === "mcp" && (
              <McpSettingsPanel
                servers={mcpSettings.servers}
                busy={isSavingSettings}
                onSave={saveMcpServer}
                onDelete={deleteMcpServer}
              />
            )}

            {settingsSection === "models" && (
              <ModelsSettingsPanel
                settings={settings}
                busy={isSavingSettings}
                onSettingsChange={setSettings}
                onSavingChange={setIsSavingSettings}
              />
            )}

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
                    {workspaceMatchesProject && workspace ? (
                      <ul className="settings-kv-list">
                        <li>
                          <span>路径</span>
                          <strong>{workspace.path}</strong>
                        </li>
                        <li>
                          <span>分支</span>
                          <strong>
                            {workspace.isGitRepository ? (workspace.branch ?? "detached") : "非 Git 仓库"}
                          </strong>
                        </li>
                        <li>
                          <span>未提交变更</span>
                          <strong>{workspace.dirtyFileCount} 个文件</strong>
                        </li>
                        {workspace.packageManager && (
                          <li>
                            <span>包管理器</span>
                            <strong>{workspace.packageManager}</strong>
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="settings-empty">请先在主界面打开一个 Git 项目。</p>
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
  if (type === "thread.idle" || type === "thread.execution_done") return "idle";
  if (type === "thread.running" || type === "thread.started" || type === "thread.queued") {
    return "running";
  }
  return fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const planExecutionFailurePrefix = "执行失败，已回退更改。";

function extractPlanFailureMessage(threadMessage: string): string | undefined {
  if (!threadMessage.startsWith(planExecutionFailurePrefix)) {
    return undefined;
  }
  const detail = threadMessage.slice(planExecutionFailurePrefix.length).trim();
  return detail.length > 0 ? detail : undefined;
}

function pathToName(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
