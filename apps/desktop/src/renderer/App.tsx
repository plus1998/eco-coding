import {
  Activity,
  AlertCircle,
  ArrowUp,
  ChevronLeft,
  Folder,
  FolderOpen,
  GitBranch,
  MessageSquarePlus,
  Settings2,
  SlidersHorizontal,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AGENT_ROLES,
  type AgentRole,
  type ModelSettingsSnapshot,
  type ProviderConfigInput,
  type ProviderConfigView,
  type RoleRouteConfig,
  type ThreadSummary,
  type WorkspaceInfo,
} from "../shared/ipc";
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
  { id: "git", label: "Git", icon: GitBranch },
] as const;

type SettingsSectionId = (typeof settingsSections)[number]["id"];

function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("models");
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>();
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [settings, setSettings] = useState<ModelSettingsSnapshot>(emptySettings);
  const [providerForm, setProviderForm] = useState<ProviderConfigInput>({
    name: "Anthropic compatible",
    baseUrl: "https://api.anthropic.com",
    apiKey: "",
    defaultModel: "sonnet",
    enabled: true,
  });
  const [prompt, setPrompt] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState<string>();
  const [events, setEvents] = useState<Array<{ id: string; message: string }>>([]);

  useEffect(() => {
    if (!window.eco) {
      setError("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
      return undefined;
    }

    void Promise.all([
      window.eco.getCurrentWorkspace(),
      window.eco.listThreads(),
      window.eco.getModelSettings(),
    ]).then(([currentWorkspace, currentThreads, modelSettings]) => {
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
      setProviderForm(providerToForm(modelSettings.providers[0]));
    });

    return window.eco.onThreadEvent((event) => {
      if (isThreadEvent(event)) {
        setEvents((current) => [{ id: `${Date.now()}`, message: event.message }, ...current].slice(0, 20));
      }
    });
  }, []);

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

  const providerById = useMemo(
    () => new Map(settings.providers.map((provider) => [provider.id, provider])),
    [settings.providers],
  );
  const routesReady = AGENT_ROLES.every((role) => {
    const route = settings.routes.find((candidate) => candidate.role === role);
    const provider = route ? providerById.get(route.providerId) : undefined;
    return Boolean(route?.modelId.trim() && provider?.enabled && provider.hasApiKey);
  });
  const canStart = Boolean(currentProjectPath && prompt.trim() && routesReady && !isStarting);

  const plannerModelLabel = useMemo(() => {
    const route = settings.routes.find((candidate) => candidate.role === "planner");
    if (route?.modelId.trim()) return route.modelId;
    return settings.providers[0]?.defaultModel ?? "model";
  }, [settings.providers, settings.routes]);

  const timeline = useMemo(() => {
    if (activeThread) {
      const rows: Array<[string, string]> = [["Thread", activeThread.message]];
      for (const event of events) {
        rows.push(["System", event.message]);
      }
      return rows;
    }
    if (events.length > 0) {
      return events.map((event) => ["System", event.message] as [string, string]);
    }
    return [];
  }, [activeThread, events]);

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
        setEvents([{ id: `${Date.now()}`, message: `Opened ${result.workspace.path}` }]);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsOpening(false);
    }
  }

  async function startThread() {
    if (!currentProjectPath || !window.eco) return;
    setError(undefined);
    setIsStarting(true);
    try {
      const result = await window.eco.startThread({
        workspacePath: currentProjectPath,
        prompt,
      });
      setThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.thread.id)]);
      setSelectedThreadId(result.thread.id);
      rememberProject({
        path: result.thread.workspacePath,
        name: pathToName(result.thread.workspacePath),
        lastUsedAt: new Date().toISOString(),
      });
      setPrompt("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsStarting(false);
    }
  }

  async function saveProvider() {
    if (!window.eco) return;
    setError(undefined);
    setIsSavingSettings(true);
    try {
      const provider = await window.eco.saveProvider(providerForm);
      const modelSettings = await window.eco.getModelSettings();
      setSettings(modelSettings);
      setProviderForm(providerToForm(provider));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function saveRoutes() {
    if (!window.eco) return;
    setError(undefined);
    setIsSavingSettings(true);
    try {
      const routes = await window.eco.saveRoleRoutes(settings.routes);
      setSettings((current) => ({ ...current, routes }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSavingSettings(false);
    }
  }

  function updateRoute(role: AgentRole, patch: Partial<RoleRouteConfig>) {
    setSettings((current) => {
      const existingRoute = current.routes.find((route) => route.role === role);
      const nextRoute: RoleRouteConfig = {
        role,
        providerId: patch.providerId ?? existingRoute?.providerId ?? current.providers[0]?.id ?? "",
        modelId: patch.modelId ?? existingRoute?.modelId ?? current.providers[0]?.defaultModel ?? "",
      };
      return {
        ...current,
        routes: [...current.routes.filter((route) => route.role !== role), nextRoute],
      };
    });
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
      if (canStart) void startThread();
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
          {!activeThread && timeline.length === 0 ? (
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
                  <span className={`status-chip ${activeThread.status}`}>{activeThread.status}</span>
                </header>
              )}
              {timeline.map(([role, message]) => (
                <article className="activity-item" key={`${role}-${message.slice(0, 40)}`}>
                  <span className="activity-role">{role}</span>
                  <p>{message}</p>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="codex-composer-wrap">
          <div className="codex-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="尽管问"
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
                onClick={startThread}
                disabled={!canStart}
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
            {settingsSection === "models" && (
              <section className="settings-block">
                <div className="settings-block-header">
                  <div>
                    <h3>模型与路由</h3>
                    <p className="settings-desc">Provider 与各 Agent 角色模型，保存在本地 SQLite。</p>
                  </div>
                  <button type="button" className="small-action" onClick={() => setProviderForm(providerToForm())}>
                    新建 Provider
                  </button>
                </div>
                <div className="settings-grid">
                  <div className="provider-form">
                    <label>
                      Provider
                      <input
                        value={providerForm.name}
                        onChange={(event) =>
                          setProviderForm((current) => ({ ...current, name: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      baseURL
                      <input
                        value={providerForm.baseUrl}
                        onChange={(event) =>
                          setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))
                        }
                      />
                    </label>
                    <label>
                      API key
                      <input
                        value={providerForm.apiKey ?? ""}
                        onChange={(event) =>
                          setProviderForm((current) => ({ ...current, apiKey: event.target.value }))
                        }
                        type="password"
                      />
                    </label>
                    <label>
                      默认模型
                      <input
                        value={providerForm.defaultModel}
                        onChange={(event) =>
                          setProviderForm((current) => ({ ...current, defaultModel: event.target.value }))
                        }
                      />
                    </label>
                    <label className="toggle-line">
                      <input
                        checked={providerForm.enabled}
                        onChange={(event) =>
                          setProviderForm((current) => ({ ...current, enabled: event.target.checked }))
                        }
                        type="checkbox"
                      />
                      启用
                    </label>
                    <button type="button" className="primary" onClick={saveProvider} disabled={isSavingSettings}>
                      保存 Provider
                    </button>
                  </div>

                  <div className="provider-list">
                    {settings.providers.map((provider) => (
                      <button
                        type="button"
                        key={provider.id}
                        className={
                          providerForm.id === provider.id ? "provider-item active-provider" : "provider-item"
                        }
                        onClick={() => setProviderForm(providerToForm(provider))}
                      >
                        <strong>{provider.name}</strong>
                        <span>{provider.baseUrl}</span>
                        <small>
                          {provider.defaultModel} · {provider.hasApiKey ? "已配置 Key" : "无 Key"}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>

                <h4 className="settings-subtitle">角色路由</h4>
                <div className="route-grid">
                  {AGENT_ROLES.map((role) => {
                    const route = settings.routes.find((candidate) => candidate.role === role);
                    return (
                      <div className="route-row" key={role}>
                        <strong>{role}</strong>
                        <select
                          value={route?.providerId ?? ""}
                          onChange={(event) => updateRoute(role, { providerId: event.target.value })}
                        >
                          {settings.providers.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}
                            </option>
                          ))}
                        </select>
                        <input
                          value={route?.modelId ?? ""}
                          onChange={(event) => updateRoute(role, { modelId: event.target.value })}
                          placeholder="model id"
                        />
                      </div>
                    );
                  })}
                  <button type="button" className="save-routes" onClick={saveRoutes} disabled={isSavingSettings}>
                    保存角色路由
                  </button>
                </div>
              </section>
            )}

            {settingsSection === "git" && (
              <section className="settings-block">
                <h3>Git</h3>
                <p className="settings-desc">当前工作区 Git 状态（需先打开项目）。</p>
                <div className="settings-card">
                  {workspaceMatchesProject && workspace ? (
                    <>
                      <div className="info-row">
                        <strong>路径</strong>
                        <span>{workspace.path}</span>
                      </div>
                      <div className="info-row">
                        <strong>分支</strong>
                        <span>{workspace.isGitRepository ? (workspace.branch ?? "detached") : "非 Git 仓库"}</span>
                      </div>
                      <div className="info-row">
                        <strong>未提交变更</strong>
                        <span>{workspace.dirtyFileCount} 个文件</span>
                      </div>
                      {workspace.packageManager && (
                        <div className="info-row">
                          <strong>包管理器</strong>
                          <span>{workspace.packageManager}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="settings-empty">请先在主界面打开一个 Git 项目。</p>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function isThreadEvent(event: unknown): event is { message: string } {
  return typeof event === "object" && event !== null && "message" in event;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerToForm(provider?: ProviderConfigView): ProviderConfigInput {
  const form: ProviderConfigInput = {
    name: provider?.name ?? "Anthropic compatible",
    baseUrl: provider?.baseUrl ?? "https://api.anthropic.com",
    apiKey: "",
    defaultModel: provider?.defaultModel ?? "sonnet",
    enabled: provider?.enabled ?? true,
  };
  if (provider) form.id = provider.id;
  return form;
}

function pathToName(projectPath: string): string {
  const segments = projectPath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? projectPath;
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
