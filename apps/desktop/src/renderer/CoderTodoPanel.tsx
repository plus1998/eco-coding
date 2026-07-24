import { Ban, CheckCircle2, Circle, CircleDot, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";

interface CoderTodoPanelProps {
  todos: CoderTodoItem[];
  /** Render inside sidebar without outer panel chrome */
  embedded?: boolean;
  /** Codex-style compact list (icons only, no status pills) */
  compact?: boolean;
}

const statusKey: Record<CoderTodoStatus, string> = {
  pending: "todo.status.pending",
  running: "todo.status.running",
  completed: "todo.status.completed",
  blocked: "todo.status.blocked",
  cancelled: "todo.status.cancelled",
};

const statusIcon = {
  pending: Circle,
  running: CircleDot,
  completed: CheckCircle2,
  blocked: XCircle,
  cancelled: Ban,
} satisfies Record<CoderTodoStatus, typeof Circle>;

function displayLabel(todo: CoderTodoItem, compact: boolean): string {
  if (compact && todo.status === "running" && todo.detail.trim() && todo.detail !== todo.title) {
    return todo.detail;
  }
  return todo.title;
}

export function CoderTodoPanel({ todos, embedded, compact = false }: CoderTodoPanelProps) {
  const { t } = useTranslation();
  if (todos.length === 0) {
    return null;
  }

  const orderedTodos = [...todos].sort((left, right) => left.position - right.position);

  const list = (
    <ol className={`coder-todo-list${compact ? " coder-todo-list-compact" : ""}`}>
      {orderedTodos.map((todo) => {
        const Icon = statusIcon[todo.status];
        const label = displayLabel(todo, compact);
        return (
          <li key={todo.id} className={`coder-todo-item ${todo.status}`}>
            <span className="coder-todo-icon" aria-hidden>
              <Icon
                size={compact ? 18 : 16}
                className={todo.status === "running" && !compact ? "spinning" : undefined}
                strokeWidth={todo.status === "running" ? 2.25 : 2}
              />
            </span>
            <div className="coder-todo-body">
              <div className="coder-todo-title-row">
                <strong title={todo.title}>
                  <span className="coder-todo-index">#{todo.position + 1}</span>
                  {label}
                </strong>
                {!compact ? (
                  <span className={`coder-todo-status ${todo.status}`}>{t(statusKey[todo.status])}</span>
                ) : null}
              </div>
              {!compact && todo.detail && todo.detail !== todo.title ? (
                <details className="coder-todo-detail">
                  <summary>{t("todo.details")}</summary>
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
    <section className="coder-todo-panel" aria-label={t("todo.progress")}>
      <header className="coder-todo-header">
        <h3>{t("todo.progress")}</h3>
        <span>{t("todo.count", { count: todos.length })}</span>
      </header>
      {list}
    </section>
  );
}
