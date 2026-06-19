import { AlertTriangle, Shield, ShieldAlert, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { BashApprovalRequest } from "../shared/ipc";
import { ExpandablePreBlock } from "./ExpandablePreBlock";

interface BashApprovalPanelProps {
  request: BashApprovalRequest;
  busy?: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

type BashApprovalChoice = "approve" | "deny";

interface BashApprovalOption {
  choice: BashApprovalChoice;
  label: string;
}

export function BashApprovalPanel({ request, busy, onApprove, onDeny }: BashApprovalPanelProps) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const options = useMemo<BashApprovalOption[]>(
    () => [
      { choice: "approve", label: "是" },
      { choice: "deny", label: "否，请告知 Agent 如何调整" },
    ],
    [],
  );

  function submitHighlightedChoice() {
    const option = options[highlightIndex];
    if (!option || busy) {
      return;
    }
    if (option.choice === "approve") {
      onApprove();
      return;
    }
    onDeny();
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onDeny();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightIndex((index) => (index + 1) % options.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightIndex((index) => (index - 1 + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submitHighlightedChoice();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, highlightIndex, onApprove, onDeny, options]);

  const title =
    request.description?.trim() ||
    request.reason ||
    (request.filesystemTool
      ? `允许在工作区外执行 ${request.filesystemTool}？`
      : "需要确认工具权限");
  const runningLabel = request.filesystemTool
    ? `正在请求 ${request.filesystemTool}`
    : `正在运行 ${request.command}`;
  const panelLabel = request.filesystemTool ? "工具读取确认" : "Bash 执行确认";
  const detail = request.filesystemPath ?? request.command;

  return (
    <div className="bash-approval-shell">
      <div className="bash-approval-running" aria-hidden>
        <span className="bash-approval-mini-icon">
          <Terminal size={16} />
        </span>
        <span className="bash-approval-running-label">{runningLabel}</span>
      </div>

      <section className="bash-approval-panel codex-style" aria-label={panelLabel}>
        <header className="bash-approval-top">
          <p className="bash-approval-title">{title}</p>
          {!request.filesystemTool ? (
            <span className={`bash-approval-risk bash-approval-risk-${request.riskLevel}`}>
              <span className="bash-approval-risk-icon" aria-hidden>
                <RiskLevelIcon level={request.riskLevel} />
              </span>
              <span className="bash-approval-risk-label">{formatRiskLevel(request.riskLevel)}</span>
              <span className="bash-approval-risk-score">{request.riskScore}</span>
            </span>
          ) : null}
        </header>

        <ExpandablePreBlock
          text={detail}
          className="bash-approval-command-wrap"
          wrapClassName="bash-approval-command-body-wrap"
          preClassName="bash-approval-command"
          fadeClassName="bash-approval-command-fade"
          hintClassName="bash-approval-command-hint"
          maxCollapsedHeight={160}
        />

        <ul className="bash-approval-option-list" role="listbox" aria-label="Bash 执行选项">
          {options.map((option, optionIndex) => {
            const highlighted = highlightIndex === optionIndex;
            return (
              <li key={option.choice}>
                <button
                  type="button"
                  role="option"
                  aria-selected={highlighted}
                  className={["bash-approval-option-row", highlighted ? "is-highlighted" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  disabled={busy}
                  onMouseEnter={() => setHighlightIndex(optionIndex)}
                  onClick={() => {
                    setHighlightIndex(optionIndex);
                    if (option.choice === "approve") {
                      onApprove();
                      return;
                    }
                    onDeny();
                  }}
                >
                  <span className="bash-approval-option-index">{optionIndex + 1}.</span>
                  <span className="bash-approval-option-label">{option.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <footer className="bash-approval-footer">
          <button type="button" className="bash-approval-dismiss" disabled={busy} onClick={onDeny}>
            跳过
          </button>
          <button
            type="button"
            className="bash-approval-submit"
            disabled={busy}
            onClick={submitHighlightedChoice}
          >
            提交 <kbd>↵</kbd>
          </button>
        </footer>
      </section>
    </div>
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

function RiskLevelIcon({ level }: { level: BashApprovalRequest["riskLevel"] }) {
  const size = 13;
  switch (level) {
    case "critical":
      return <ShieldAlert size={size} />;
    case "high":
      return <AlertTriangle size={size} />;
    case "medium":
      return <Shield size={size} />;
    case "low":
      return <ShieldCheck size={size} />;
  }
  return null;
}
