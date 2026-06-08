import { CheckCircle2, ShieldAlert, Terminal, XCircle } from "lucide-react";
import type { BashApprovalRequest } from "../shared/ipc";

interface BashApprovalPanelProps {
  request: BashApprovalRequest;
  busy?: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

export function BashApprovalPanel({ request, busy, onApprove, onDeny }: BashApprovalPanelProps) {
  const actor = request.agentType || request.agentId || "planner";
  return (
    <section className="bash-approval-panel codex-style" aria-label="Bash 执行确认">
      <div className="bash-approval-running" aria-hidden>
        <span className="bash-approval-mini-icon">
          <Terminal size={18} />
        </span>
        <span>正在运行</span>
        <code>{request.command}</code>
      </div>

      <div className="bash-approval-card">
        <header className="bash-approval-header">
          <div>
            <h3>需要确认后才能执行 Bash 命令。</h3>
            <p>批准仅对本次调用生效，不会记住这条命令。</p>
          </div>
          <span className={`bash-approval-risk bash-approval-risk-${request.riskLevel}`}>
            {formatRiskLevel(request.riskLevel)}
          </span>
        </header>

        <pre className="bash-approval-command">{request.command}</pre>

        <fieldset className="bash-approval-options" aria-label="Bash 执行选项">
          <button type="button" className="bash-approval-option primary" disabled={busy} onClick={onApprove}>
            <span className="bash-approval-option-index">1.</span>
            <span className="bash-approval-option-main">
              <strong>允许本次</strong>
              <span>执行这条 Bash 命令</span>
            </span>
            <CheckCircle2 size={18} aria-hidden />
          </button>
          <button type="button" className="bash-approval-option" disabled={busy} onClick={onDeny}>
            <span className="bash-approval-option-index">2.</span>
            <span className="bash-approval-option-main">
              <strong>拒绝</strong>
              <span>请 Agent 调整方案</span>
            </span>
            <XCircle size={18} aria-hidden />
          </button>
        </fieldset>

        <div className="bash-approval-meta">
          <span>
            <ShieldAlert size={15} aria-hidden />
            {request.reason}
          </span>
          <span title={request.cwd}>cwd {request.cwd}</span>
          <span>agent {actor}</span>
          {request.description ? <span>{request.description}</span> : null}
        </div>
      </div>
    </section>
  );
}

function formatRiskLevel(level: BashApprovalRequest["riskLevel"]): string {
  switch (level) {
    case "critical":
      return "严重";
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    case "low":
      return "低风险";
  }
  return level;
}
