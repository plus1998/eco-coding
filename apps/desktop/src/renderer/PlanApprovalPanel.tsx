import type { ThreadPendingPlan } from "../shared/ipc";

interface PlanApprovalPanelProps {
  plan: ThreadPendingPlan;
  busy?: boolean;
  failureMessage?: string;
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
  return (
    <section className="plan-approval" aria-label="实施计划">
      <header className="plan-approval-header">
        <h3>实施计划</h3>
        <p>
          确认后 Planner 将按流程执行：复杂需求先由 Architect 拆分任务，再并行 Coder 实现，最后 Reviewer
          审查与 Tester 测试；简单需求将跳过 Architect。
        </p>
      </header>
      {failureMessage && (
        <div className="plan-approval-error" role="alert">
          <strong>上次执行失败</strong>
          <p>{failureMessage}</p>
          <p className="plan-approval-error-hint">工作树已回退，可修改计划后重试，或选择忽略。</p>
        </div>
      )}
      <pre className="plan-approval-body">{plan.plan.trim() || "（计划为空）"}</pre>
      {plan.analysis.trim() && (
        <details className="plan-approval-analysis">
          <summary>分析摘要</summary>
          <pre>{plan.analysis.trim()}</pre>
        </details>
      )}
      <div className="plan-approval-actions">
        <button type="button" className="plan-button secondary" onClick={onDismiss} disabled={busy}>
          忽略
        </button>
        <button type="button" className="plan-button primary" onClick={onApprove} disabled={busy}>
          {failureMessage ? "重试执行" : "执行计划"}
        </button>
      </div>
    </section>
  );
}
