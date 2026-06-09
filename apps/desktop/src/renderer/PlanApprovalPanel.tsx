import type { ThreadPendingPlan } from "../shared/ipc";
import { MarkdownContent } from "./MarkdownContent";

interface PlanApprovalPanelProps {
  plan: ThreadPendingPlan;
  busy?: boolean | undefined;
  failureMessage?: string | undefined;
  executionSummary?: string | undefined;
  onApprove: () => void;
  onDismiss: () => void;
}

export function PlanApprovalPanel({
  plan,
  busy,
  failureMessage,
  executionSummary,
  onApprove,
  onDismiss,
}: PlanApprovalPanelProps) {
  const planTrimmed = plan.plan.trim();

  return (
    <section className="plan-approval" aria-label="实施计划">
      <header className="plan-approval-header">
        <h3>实施计划</h3>
        <p>
          {executionSummary ??
            "确认后将按你已启用的子代理执行。若要调整计划，请选择「忽略」后在下方对话中说明，主代理会重新输出完整计划。"}
        </p>
      </header>
      {failureMessage && (
        <div className="plan-approval-error" role="alert">
          <strong>上次执行失败</strong>
          <p>{failureMessage}</p>
          <p className="plan-approval-error-hint">工作树已回退，可忽略后在对话中修改计划，或确认后重试执行。</p>
        </div>
      )}
      <div className="plan-approval-field">
        <span className="plan-approval-field-label">实现计划</span>
        <div className="plan-approval-markdown">
          <MarkdownContent text={plan.plan} />
        </div>
      </div>
      {plan.analysis.trim() ? (
        <details className="plan-approval-analysis">
          <summary>分析摘要</summary>
          <div className="plan-approval-markdown plan-approval-markdown-compact">
            <MarkdownContent text={plan.analysis} />
          </div>
        </details>
      ) : null}
      <div className="plan-approval-actions">
        <button type="button" className="plan-button secondary" onClick={onDismiss} disabled={busy}>
          忽略
        </button>
        <button
          type="button"
          className="plan-button primary"
          onClick={onApprove}
          disabled={busy || !planTrimmed}
        >
          {failureMessage ? "重试执行" : "执行计划"}
        </button>
      </div>
    </section>
  );
}
