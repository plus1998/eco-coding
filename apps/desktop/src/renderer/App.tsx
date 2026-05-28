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
import type { ThreadSummary, WorkspaceInfo } from "../shared/ipc";
import "./styles.css";

const agents = [
  ["planner", "Claude Agent SDK", "ready"],
  ["architect", "subagent", "idle"],
  ["coder", "isolated worktree", "idle"],
  ["reviewer", "diff approval", "idle"],
];

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo>();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isOpening, setIsOpening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [events, setEvents] = useState<Array<{ id: string; message: string }>>([]);

  useEffect(() => {
    if (!window.eco) {
      setError("Electron preload API is unavailable. Run the desktop app with bun run dev:electron.");
      return undefined;
    }

    void Promise.all([window.eco.getCurrentWorkspace(), window.eco.listThreads()]).then(
      ([currentWorkspace, currentThreads]) => {
        setWorkspace(currentWorkspace);
        setThreads(currentThreads);
      },
    );

    return window.eco.onThreadEvent((event) => {
      if (isThreadEvent(event)) {
        setEvents((current) => [{ id: `${Date.now()}`, message: event.message }, ...current].slice(0, 6));
      }
    });
  }, []);

  const activeThread = threads[0];
  const canStart = Boolean(workspace?.isGitRepository && prompt.trim() && !isStarting);

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
            {agents.map(([name, model, state]) => (
              <div className="agent-row" key={name}>
                <div>
                  <strong>{name}</strong>
                  <small>{model}</small>
                </div>
                <span>{state}</span>
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

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
