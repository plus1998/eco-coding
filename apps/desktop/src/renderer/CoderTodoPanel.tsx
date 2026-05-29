import { Ban, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";

interface CoderTodoPanelProps {
  todos: CoderTodoItem[];
  /** Render inside sidebar without outer panel chrome */
  embedded?: boolean;
}

const statusLabel: Record<CoderTodoStatus, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  blocked: "受阻",
  cancelled: "已停止",
};

const statusIcon = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  blocked: XCircle,
  cancelled: Ban,
} satisfies Record<CoderTodoStatus, typeof Circle>;

export function CoderTodoPanel({ todos, embedded }: CoderTodoPanelProps) {
  if (todos.length === 0) {
    return null;
  }

  const list = (
      <ol className="coder-todo-list">
        {todos.map((todo) => {
          const Icon = statusIcon[todo.status];
          return (
            <li key={todo.id} className={`coder-todo-item ${todo.status}`}>
              <span className="coder-todo-icon" aria-hidden>
                <Icon size={16} className={todo.status === "running" ? "spinning" : undefined} />
              </span>
              <div className="coder-todo-body">
                <div className="coder-todo-title-row">
                  <strong>{todo.title}</strong>
                  <span className={`coder-todo-status ${todo.status}`}>{statusLabel[todo.status]}</span>
                </div>
                {todo.detail && todo.detail !== todo.title ? (
                  <details className="coder-todo-detail">
                    <summary>详情</summary>
                    <pre>{todo.detail}</pre>
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
  );

  if (embedded) {
    return <div className="coder-todo-embedded">{list}</div>;
  }

  return (
    <section className="coder-todo-panel" aria-label="Coder TODO">
      <header className="coder-todo-header">
        <h3>Coder TODO</h3>
        <span>{todos.length} 项</span>
      </header>
      {list}
    </section>
  );
}
