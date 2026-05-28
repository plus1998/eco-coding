import {
  Activity,
  AlertCircle,
  Bot,
  FolderOpen,
  GitBranch,
  KeyRound,
  Send,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
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
      setThreads(currentThreads);
      setSettings(modelSettings);
      setProviderForm(providerToForm(modelSettings.providers[0]));
    });

    return window.eco.onThreadEvent((event) => {
      if (isThreadEvent(event)) {
        setEvents((current) => [{ id: `${Date.now()}`, message: event.message }, ...current].slice(0, 6));
      }
    });
  }, []);

  const activeThread = threads[0];
  const providerById = useMemo(
    () => new Map(settings.providers.map((provider) => [provider.id, provider])),
    [settings.providers],
  );
  const routesReady = AGENT_ROLES.every((role) => {
    const route = settings.routes.find((candidate) => candidate.role === role);
    const provider = route ? providerById.get(route.providerId) : undefined;
    return Boolean(route?.modelId.trim() && provider?.enabled && provider.hasApiKey);
  });
  const canStart = Boolean(workspace?.isGitRepository && prompt.trim() && routesReady && !isStarting);
  const agentRows = useMemo(
    () =>
      AGENT_ROLES.map((role) => {
        const route = settings.routes.find((candidate) => candidate.role === role);
        const provider = route ? providerById.get(route.providerId) : undefined;
        const state = getRouteState(route, provider);
        return {
          role,
          providerName: provider?.name ?? "No provider",
          modelId: route?.modelId ?? "No model",
          state,
        };
      }),
    [providerById, settings.routes],
  );

  const timeline = useMemo(() => {
    if (events.length > 0) {
      return events.map((event) => ["System", event.message]);
    }

    if (!workspace) {
      return [["Workspace", "Open a project folder to start a coding thread."]];
    }

    if (!workspace.isGitRepository) {
      return [["Workspace", "Selected folder is not a Git repository. Open a Git project before coding."]];
    }

    if (!activeThread) {
      return [
        ["Workspace", `${workspace.name} is ready on ${workspace.branch ?? "unknown branch"}.`],
        ["Agent", "Write a task and start a coding thread."],
      ];
    }

    return [
      ["Thread", activeThread.message],
      ["Workspace", `Target project: ${workspace.name}`],
    ];
  }, [activeThread, events, workspace]);

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
        setEvents([{ id: `${Date.now()}`, message: `Opened ${result.workspace.path}` }]);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsOpening(false);
    }
  }

  async function startThread() {
    if (!workspace || !window.eco) return;
    setError(undefined);
    setIsStarting(true);
    try {
      const result = await window.eco.startThread({
        workspacePath: workspace.path,
        prompt,
      });
      setThreads((current) => [result.thread, ...current.filter((thread) => thread.id !== result.thread.id)]);
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

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EC</div>
          <div>
            <strong>Eco Coding</strong>
            <span>Agent Command Center</span>
          </div>
        </div>
        <nav>
          <button type="button" className="active">
            <Activity size={16} /> Threads
          </button>
          <button type="button">
            <Bot size={16} /> Agents
          </button>
          <button type="button">
            <GitBranch size={16} /> Git
          </button>
          <button type="button">
            <TerminalSquare size={16} /> Terminal
          </button>
          <button type="button">
            <KeyRound size={16} /> Models
          </button>
          <button type="button">
            <ShieldCheck size={16} /> Approvals
          </button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Local project</span>
            <h1>{workspace ? workspace.name : "Open a project to start coding"}</h1>
          </div>
          <button type="button" className="primary" onClick={openWorkspace} disabled={isOpening}>
            <FolderOpen size={16} /> {workspace ? "Switch project" : "Open project"}
          </button>
        </header>

        <section className="launch-panel">
          <div className="project-block">
            <div className="section-heading">
              <span>Project</span>
              <small>{workspace?.isGitRepository ? "Git ready" : "required"}</small>
            </div>
            {workspace ? (
              <div className="project-meta">
                <strong>{workspace.path}</strong>
                <span>
                  {workspace.isGitRepository
                    ? `${workspace.branch ?? "detached"} · ${workspace.dirtyFileCount} changed files`
                    : "Not a Git repository"}
                </span>
                {workspace.packageManager && <small>{workspace.packageManager} workspace detected</small>}
              </div>
            ) : (
              <button type="button" className="open-large" onClick={openWorkspace} disabled={isOpening}>
                <FolderOpen size={18} /> Choose a local repository
              </button>
            )}
          </div>

          <div className="task-block">
            <div className="section-heading">
              <span>New Coding Thread</span>
              <small>planner to coder to review</small>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：修复登录页表单校验问题，并补充测试"
            />
            <div className="composer-actions">
              {error && (
                <p className="error-line">
                  <AlertCircle size={15} /> {error}
                </p>
              )}
              <button type="button" className="primary" onClick={startThread} disabled={!canStart}>
                {isStarting ? <Activity size={16} /> : <Send size={16} />}
                Start coding
              </button>
            </div>
          </div>
        </section>

        <section className="settings-panel">
          <div className="section-heading">
            <div>
              <span>Model Providers</span>
              <small>saved in local SQLite</small>
            </div>
            <button type="button" className="small-action" onClick={() => setProviderForm(providerToForm())}>
              New provider
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
                  placeholder="OpenRouter / LiteLLM / Local gateway"
                />
              </label>
              <label>
                Anthropic baseURL
                <input
                  value={providerForm.baseUrl}
                  onChange={(event) =>
                    setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                  placeholder="https://api.anthropic.com"
                />
              </label>
              <label>
                API key
                <input
                  value={providerForm.apiKey ?? ""}
                  onChange={(event) =>
                    setProviderForm((current) => ({ ...current, apiKey: event.target.value }))
                  }
                  placeholder={providerForm.id ? "Leave blank to keep saved key" : "sk-..."}
                  type="password"
                />
              </label>
              <label>
                Default model
                <input
                  value={providerForm.defaultModel}
                  onChange={(event) =>
                    setProviderForm((current) => ({ ...current, defaultModel: event.target.value }))
                  }
                  placeholder="sonnet / provider model id"
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
                Enabled
              </label>
              <button type="button" className="primary" onClick={saveProvider} disabled={isSavingSettings}>
                Save provider
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
                    {provider.defaultModel} ·{" "}
                    {provider.hasApiKey ? `key ${provider.apiKeyPreview}` : "no key"}
                  </small>
                </button>
              ))}
            </div>
          </div>

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
              Save role routes
            </button>
          </div>
        </section>

        <section className="thread-strip">
          {threads.length > 0 ? (
            threads.slice(0, 3).map((thread) => (
              <article key={thread.id} className="thread-card">
                <span>{thread.status}</span>
                <strong>{thread.title}</strong>
                <small>{thread.message}</small>
              </article>
            ))
          ) : (
            <article className="thread-card empty-thread">
              <span>Ready</span>
              <strong>No threads yet</strong>
              <small>Open a repository, describe the task, then start coding.</small>
            </article>
          )}
        </section>

        <section className="main-grid">
          <div className="timeline">
            <div className="section-heading">
              <span>Timeline</span>
              <small>runtime events</small>
            </div>
            {timeline.map(([role, message]) => (
              <article className="event-row" key={`${role}-${message}`}>
                <div className="event-dot" />
                <div>
                  <strong>{role}</strong>
                  <p>{message}</p>
                </div>
              </article>
            ))}
          </div>

          <aside className="right-panel">
            <div className="section-heading">
              <span>Agent Tree</span>
              <small>execution plan</small>
            </div>
            {agentRows.map((agent) => (
              <div className="agent-row" key={agent.role}>
                <div>
                  <strong>{agent.role}</strong>
                  <small>
                    {agent.providerName} / {agent.modelId}
                  </small>
                </div>
                <span>{agent.state}</span>
              </div>
            ))}

            <div className="diff-box">
              <div className="section-heading">
                <span>Diff Review</span>
                <small>after agent run</small>
              </div>
              <pre>
                {activeThread ? activeThread.message : "No changes yet. Start a coding thread first."}
              </pre>
              <div className="approval-actions">
                <button type="button" disabled={!activeThread}>
                  Reject
                </button>
                <button type="button" className="approve" disabled={!activeThread}>
                  Apply
                </button>
              </div>
            </div>
          </aside>
        </section>
      </section>
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

function getRouteState(route: RoleRouteConfig | undefined, provider: ProviderConfigView | undefined): string {
  if (!route) return "missing";
  if (!route.modelId.trim()) return "no model";
  if (!provider) return "missing provider";
  if (!provider.enabled) return "disabled";
  if (!provider.hasApiKey) return "needs key";
  return "ready";
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
