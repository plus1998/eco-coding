import type { ThreadPendingPlan } from "../shared/ipc";
import { MarkdownContent } from "./MarkdownContent";

interface PlanApprovalPanelProps {
  plan: ThreadPendingPlan;
  busy?: boolean | undefined;
  failureMessage?: string | undefined;
  onApprove: () => void;
  onDismiss: () => void;
}

export function PlanApprovalPanel({
  plan,
  busy,
  failureMessage,
  onApprove,
  onDismiss,
}: PlanApprovalPanelProps) {
  const planTrimmed = plan.plan.trim();

  return (
    <section className="plan-approval" aria-label="实施计划">
      <header className="plan-approval-header">
        <h3>实施计划</h3>
      </header>
      {failureMessage && (
        <div className="plan-approval-error" role="alert">
          <strong>上次执行失败</strong>
          <p>{failureMessage}</p>
        </div>
      )}
      <div className="plan-approval-markdown">
        <MarkdownContent text={plan.plan} />
      </div>
      <footer className="plan-approval-actions">
        <button type="button" className="plan-button secondary" onClick={onDismiss} disabled={busy}>
          忽略
        </button>
        {!failureMessage ? (
          <button
            type="button"
            className="plan-button primary"
            onClick={onApprove}
            disabled={busy || !planTrimmed}
          >
            执行计划
          </button>
        ) : null}
      </footer>
    </section>
  );
}
