import { useEffect, useState } from "react";
import type { ThreadPendingPlan } from "../shared/ipc";

export interface PlanApprovalEdits {
  plan: string;
  analysis: string;
}

interface PlanApprovalPanelProps {
  plan: ThreadPendingPlan;
  busy?: boolean | undefined;
  failureMessage?: string | undefined;
  onApprove: (edits: PlanApprovalEdits) => void;
  onDismiss: () => void;
}

export function PlanApprovalPanel({
  plan,
  busy,
  failureMessage,
  onApprove,
  onDismiss,
}: PlanApprovalPanelProps) {
  const [planText, setPlanText] = useState(plan.plan);
  const [analysisText, setAnalysisText] = useState(plan.analysis);

  useEffect(() => {
    setPlanText(plan.plan);
    setAnalysisText(plan.analysis);
  }, [plan.threadId, plan.plan, plan.analysis]);

  const planTrimmed = planText.trim();
  const planEdited = planText !== plan.plan;
  const analysisEdited = analysisText !== plan.analysis;

  return (
    <section className="plan-approval" aria-label="实施计划">
      <header className="plan-approval-header">
        <h3>实施计划</h3>
        <p>
          可直接编辑下方计划后再执行。确认后 Planner 将按流程执行：复杂需求先由 Architect 拆分任务，再并行
          Coder 实现，最后 Reviewer 审查与 Tester 测试；简单需求将跳过 Architect。
        </p>
      </header>
      {failureMessage && (
        <div className="plan-approval-error" role="alert">
          <strong>上次执行失败</strong>
          <p>{failureMessage}</p>
          <p className="plan-approval-error-hint">工作树已回退，可修改计划后重试，或选择忽略。</p>
        </div>
      )}
      {(planEdited || analysisEdited) && (
        <p className="plan-approval-edited-hint" role="status">
          已修改{planEdited && analysisEdited ? "计划与分析摘要" : planEdited ? "计划" : "分析摘要"}
          ，执行时将采用编辑后的内容。
        </p>
      )}
      <label className="plan-approval-field">
        <span className="plan-approval-field-label">实现计划（可编辑）</span>
        <textarea
          className="plan-approval-editor"
          value={planText}
          onChange={(event) => setPlanText(event.target.value)}
          disabled={busy}
          rows={16}
          spellCheck={false}
          aria-label="实现计划"
        />
      </label>
      <details className="plan-approval-analysis">
        <summary>分析摘要（可编辑）</summary>
        <textarea
          className="plan-approval-editor plan-approval-editor-compact"
          value={analysisText}
          onChange={(event) => setAnalysisText(event.target.value)}
          disabled={busy}
          rows={6}
          spellCheck={false}
          aria-label="分析摘要"
          placeholder="（可选）"
        />
      </details>
      <div className="plan-approval-actions">
        <button type="button" className="plan-button secondary" onClick={onDismiss} disabled={busy}>
          忽略
        </button>
        <button
          type="button"
          className="plan-button primary"
          onClick={() => onApprove({ plan: planText, analysis: analysisText })}
          disabled={busy || !planTrimmed}
        >
          {failureMessage ? "重试执行" : "执行计划"}
        </button>
      </div>
    </section>
  );
}
