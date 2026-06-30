import { Loader2 } from "lucide-react";
import type { ThreadPendingPlan } from "../shared/ipc";
import { MarkdownContent } from "./MarkdownContent";

interface PlanApprovalPanelProps {
  plan: ThreadPendingPlan;
  busy?: boolean | undefined;
  failureMessage?: string | undefined;
  variant?: "feed" | "dock";
  onApprove: () => void;
  onDismiss: () => void;
}

export function PlanApprovalPanel({
  plan,
  busy,
  failureMessage,
  variant = "feed",
  onApprove,
  onDismiss,
}: PlanApprovalPanelProps) {
  const planTrimmed = plan.plan.trim();
  const docked = variant === "dock";

  const body = (
    <>
      <header className="plan-approval-header">
        <h3 className={docked ? "plan-approval-dock-title" : undefined}>实施计划</h3>
      </header>
      {failureMessage ? (
        <div className="plan-approval-error" role="alert">
          <strong>上次执行失败</strong>
          <p>{failureMessage}</p>
        </div>
      ) : null}
      <div
        className={[
          "plan-approval-markdown",
          docked ? "plan-approval-dock-markdown" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <MarkdownContent text={plan.plan} />
      </div>
      <footer className={docked ? "bash-approval-footer plan-approval-dock-footer" : "plan-approval-actions"}>
        <button
          type="button"
          className={docked ? "bash-approval-dismiss" : "plan-button secondary"}
          onClick={onDismiss}
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="spinning" aria-hidden />
              处理中…
            </>
          ) : (
            "忽略"
          )}
        </button>
        {!failureMessage ? (
          <button
            type="button"
            className={docked ? "bash-approval-submit" : "plan-button primary"}
            onClick={onApprove}
            disabled={busy || !planTrimmed}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="spinning" aria-hidden />
                处理中…
              </>
            ) : docked ? (
              <>
                执行计划 <kbd aria-hidden>↵</kbd>
              </>
            ) : (
              "执行计划"
            )}
          </button>
        ) : null}
      </footer>
    </>
  );

  if (docked) {
    return (
      <div className="codex-composer is-compact plan-approval-dock-shell">
        <div className="composer-primary plan-approval-dock-inner">{body}</div>
      </div>
    );
  }

  return (
    <section className="plan-approval" aria-label="实施计划">
      {body}
    </section>
  );
}
