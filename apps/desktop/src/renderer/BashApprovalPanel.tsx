import { ShieldAlert, Terminal, XCircle } from "lucide-react";
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
    <section className="bash-approval-panel" aria-label="Bash 执行确认">
      <header className="bash-approval-header">
        <span className="bash-approval-icon" aria-hidden>
          <Terminal size={18} />
        </span>
        <div>
          <h3>Bash 执行确认</h3>
          <p>Agent 请求运行一条 shell 命令。批准仅对本次调用生效。</p>
        </div>
        <span className={`bash-approval-risk bash-approval-risk-${request.riskLevel}`}>
          {formatRiskLevel(request.riskLevel)}
        </span>
      </header>

      <div className="bash-approval-body">
        <div className="bash-approval-field">
          <span>命令</span>
          <pre>{request.command}</pre>
        </div>
        <div className="bash-approval-meta">
          <div>
            <span>目录</span>
            <code>{request.cwd}</code>
          </div>
          <div>
            <span>触发方</span>
            <code>{actor}</code>
          </div>
        </div>
        {request.description ? <p className="bash-approval-description">{request.description}</p> : null}
        <p className="bash-approval-reason">
          <ShieldAlert size={15} aria-hidden />
          {request.reason}
        </p>
      </div>

      <footer className="bash-approval-actions">
        <button type="button" className="bash-approval-deny" disabled={busy} onClick={onDeny}>
          <XCircle size={16} aria-hidden />
          拒绝
        </button>
        <button type="button" className="bash-approval-approve" disabled={busy} onClick={onApprove}>
          <Terminal size={16} aria-hidden />
          允许本次
        </button>
      </footer>
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
