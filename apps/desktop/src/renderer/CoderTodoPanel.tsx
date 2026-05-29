import { Ban, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";

interface CoderTodoPanelProps {
  todos: CoderTodoItem[];
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

export function CoderTodoPanel({ todos }: CoderTodoPanelProps) {
  if (todos.length === 0) {
    return null;
  }

  return (
    <section className="coder-todo-panel" aria-label="Coder TODO">
      <header className="coder-todo-header">
        <h3>Coder TODO</h3>
        <span>{todos.length} 项</span>
      </header>
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
    </section>
  );
}
