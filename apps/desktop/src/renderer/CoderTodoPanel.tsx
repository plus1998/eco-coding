import { useTranslation } from "react-i18next";
import type { CoderTodoItem, CoderTodoStatus } from "../shared/ipc";

interface CoderTodoPanelProps {
  todos: CoderTodoItem[];
  /** Render inside sidebar without outer panel chrome */
  embedded?: boolean;
  /** Compact list: fused status+index marker, single-line title, no status pills */
  compact?: boolean;
}

const statusKey: Record<CoderTodoStatus, string> = {
  pending: "todo.status.pending",
  running: "todo.status.running",
  completed: "todo.status.completed",
  blocked: "todo.status.blocked",
  cancelled: "todo.status.cancelled",
};

function displayLabel(todo: CoderTodoItem, compact: boolean): string {
  if (compact && todo.status === "running" && todo.detail.trim() && todo.detail !== todo.title) {
    return todo.detail;
  }
  return todo.title;
}

/** Circular marker: step index + status color/weight fused into one glyph. */
function TodoStatusIndex({
  position,
  status,
  statusLabel,
}: {
  position: number;
  status: CoderTodoStatus;
  statusLabel: string;
}) {
  const step = position + 1;
  return (
    <span
      className={`coder-todo-status-index is-${status}`}
      aria-label={`${statusLabel} · ${step}`}
      title={`${statusLabel} · ${step}`}
    >
      <span className="coder-todo-status-index-value" aria-hidden>
        {step}
      </span>
    </span>
  );
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
        const label = displayLabel(todo, compact);
        const statusLabel = t(statusKey[todo.status]);
        return (
          <li key={todo.id} className={`coder-todo-item ${todo.status}`}>
            <TodoStatusIndex
              position={todo.position}
              status={todo.status}
              statusLabel={statusLabel}
            />
            <div className="coder-todo-body">
              <div className="coder-todo-title-row">
                <strong title={label}>{label}</strong>
                {!compact ? (
                  <span className={`coder-todo-status ${todo.status}`}>{statusLabel}</span>
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
