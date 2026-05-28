import { Activity, Bot, GitBranch, KeyRound, Play, ShieldCheck, TerminalSquare } from "lucide-react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const threads = [
  { title: "实现 Anthropic 路由", status: "Running", cost: "$0.18" },
  { title: "重构授权策略", status: "Review", cost: "$0.06" },
  { title: "验证 LiteLLM 端点", status: "Done", cost: "$0.11" },
];

const timeline = [
  ["Planner", "selected claude-sonnet for architecture pass"],
  ["Coder", "created isolated worktree eco/thread-router"],
  ["Tester", "running endpoint conformance smoke tests"],
  ["Reviewer", "waiting for diff approval"],
];

const agents = [
  ["planner", "claude-opus", "active"],
  ["architect", "claude-sonnet", "idle"],
  ["coder-1", "qwen-coder via anthropic endpoint", "working"],
  ["reviewer", "gemini via gateway", "queued"],
];

function App() {
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
            <span className="eyebrow">MVP runtime</span>
            <h1>Anthropic-compatible routing thread</h1>
          </div>
          <button type="button" className="primary">
            <Play size={16} /> Start thread
          </button>
        </header>

        <section className="thread-strip">
          {threads.map((thread) => (
            <article key={thread.title} className="thread-card">
              <span>{thread.status}</span>
              <strong>{thread.title}</strong>
              <small>{thread.cost}</small>
            </article>
          ))}
        </section>

        <section className="main-grid">
          <div className="timeline">
            <div className="section-heading">
              <span>Timeline</span>
              <small>append-only event stream</small>
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
              <small>role to model</small>
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
                <small>worktree isolated</small>
              </div>
              <pre>{`+ packages/model-router/src/index.ts\n+ endpoint conformance checks\n+ fallback capability gate`}</pre>
              <div className="approval-actions">
                <button type="button">Reject</button>
                <button type="button" className="approve">
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

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
