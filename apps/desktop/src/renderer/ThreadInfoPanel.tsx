import { DollarSign, Folder, GitBranch, HelpCircle, Layers, ListTodo, Package } from "lucide-react";
import { formatCostUsd, formatSavingsLine, formatUsageBadge } from "@eco/runtime";
import type { CoderTodoItem, ThreadBillingSnapshot, ThreadStatus, WorkspaceInfo } from "../shared/ipc";
import { CoderTodoPanel } from "./CoderTodoPanel";

export interface ThreadUsageSummary {
  billing?: ThreadBillingSnapshot;
  contextTokens?: number;
}

interface ThreadInfoPanelProps {
  workspace?: WorkspaceInfo;
  workspacePath?: string;
  gitBranch?: string;
  dirtyFileCount?: number;
  todos: CoderTodoItem[];
  pendingWorktreeApply?: { changedFiles: string[] };
  threadStatus?: ThreadStatus;
  usageSummary?: ThreadUsageSummary;
  onApplyWorktree?: () => void;
  worktreeApplyBusy?: boolean;
}

function formatContextLabel(contextTokens: number): string | null {
  if (contextTokens <= 0) {
    return null;
  }
  if (contextTokens < 1000) {
    return "<1K";
  }
  return `~${Math.round(contextTokens / 1000)}K`;
}

function hasBillingData(billing?: ThreadBillingSnapshot): billing is ThreadBillingSnapshot {
  if (!billing) {
    return false;
  }
  const total =
    billing.totalTokens.input +
    billing.totalTokens.output +
    billing.totalTokens.cacheRead +
    billing.totalTokens.cacheCreation;
  return (
    total > 0 ||
    billing.otelCostUsd > 0 ||
    billing.plannerTokenCostUsd > 0 ||
    billing.ecoCostUsd > 0
  );
}

export function ThreadInfoPanel({
  workspace,
  workspacePath,
  gitBranch,
  dirtyFileCount,
  todos,
  pendingWorktreeApply,
  threadStatus,
  usageSummary,
  onApplyWorktree,
  worktreeApplyBusy,
}: ThreadInfoPanelProps) {
  const projectLabel = workspacePath?.split("/").filter(Boolean).pop() ?? workspace?.name ?? "未打开项目";
  const billing = usageSummary?.billing;
  const contextLabel =
    usageSummary?.contextTokens !== undefined ? formatContextLabel(usageSummary.contextTokens) : null;
  const tokenBadge = billing
    ? formatUsageBadge({
        inputTokens: billing.totalTokens.input,
        outputTokens: billing.totalTokens.output,
        cacheReadTokens: billing.totalTokens.cacheRead,
        cacheCreationTokens: billing.totalTokens.cacheCreation,
      })
    : null;
  const plannerLabel = billing?.plannerModelLabel?.split(" · ")[0] ?? "主模型";

  return (
    <aside className="thread-info-panel" aria-label="会话信息">
      <section className="thread-info-section">
        <h3 className="thread-info-heading">工作区</h3>
        <ul className="thread-info-list">
          <li>
            <Folder size={14} aria-hidden />
            <span className="thread-info-value" title={workspacePath}>
              {projectLabel}
            </span>
          </li>
          {workspace === undefined ? (
            <li className="thread-info-muted">正在检测 Git…</li>
          ) : workspace.isGitRepository ? (
            <li>
              <GitBranch size={14} aria-hidden />
              <span className="thread-info-value">
                {gitBranch ?? workspace.branch ?? "detached"}
                {typeof dirtyFileCount === "number" && dirtyFileCount > 0
                  ? ` · ${dirtyFileCount} 处未提交`
                  : ""}
              </span>
            </li>
          ) : (
            <li className="thread-info-muted">非 Git 仓库</li>
          )}
          {threadStatus ? (
            <li>
              <Package size={14} aria-hidden />
              <span className="thread-info-value">状态：{threadStatus}</span>
            </li>
          ) : null}
        </ul>
      </section>

      {hasBillingData(billing) ? (
        <section className="thread-info-section thread-info-billing">
          <h3 className="thread-info-heading">
            计费对比
            <span
              className="thread-info-help"
              title="① SDK（OTel cost_usd 累计）② OTel token × 主模型 models.dev 单价 ③ OTel token × 各 role 实际 models.dev 单价 ④ ②−③"
            >
              <HelpCircle size={13} aria-hidden />
            </span>
          </h3>
          {tokenBadge ? (
            <p className="thread-info-billing-tokens" title="线程累计 token（非单次请求）">
              编排 token · {tokenBadge}
            </p>
          ) : null}
          <ul className="thread-info-billing-list">
            <li title="Claude Code 内置价目估算，非权威账单">
              <span>① SDK（OTel）</span>
              <span>{formatCostUsd(billing.otelCostUsd)}</span>
            </li>
            <li title={`OTel token × Planner models.dev 单价（${plannerLabel}）`}>
              <span>② 全主模型（{plannerLabel}）</span>
              <span>{formatCostUsd(billing.plannerTokenCostUsd)}</span>
            </li>
            <li className="thread-info-billing-eco" title="OTel token × 各 role 实际 models.dev 单价">
              <span>③ 经济编程</span>
              <strong>{formatCostUsd(billing.ecoCostUsd)}</strong>
            </li>
            <li
              className={
                billing.savedUsd >= 0 ? "thread-info-billing-saved" : "thread-info-billing-over"
              }
              title="② − ③"
            >
              <span>
                <DollarSign size={13} aria-hidden />
                ④ {formatSavingsLine(billing.savedUsd, billing.savedPct).replace(/^eco-coding /, "")}
              </span>
            </li>
          </ul>
          {!billing.pricingResolved ? (
            <p className="thread-info-billing-warning">部分模型未匹配 models.dev 单价，②③ 可能不完整。</p>
          ) : null}
        </section>
      ) : contextLabel ? (
        <section className="thread-info-section">
          <ul className="thread-info-list">
            <li className="thread-info-usage">
              <Layers size={14} aria-hidden />
              <span
                className="thread-info-value"
                title="Planner 最近一次请求的输入 token（含缓存读/写），非整段对话累计"
              >
                已用上下文 {contextLabel}
              </span>
            </li>
          </ul>
        </section>
      ) : null}

      {pendingWorktreeApply && pendingWorktreeApply.changedFiles.length > 0 ? (
        <section className="thread-info-section">
          <h3 className="thread-info-heading">文件改动</h3>
          <ul className="thread-info-file-list">
            {pendingWorktreeApply.changedFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          {onApplyWorktree ? (
            <button
              type="button"
              className="plan-button primary thread-info-apply"
              onClick={onApplyWorktree}
              disabled={worktreeApplyBusy}
            >
              {worktreeApplyBusy ? "正在合并…" : "应用到工作区"}
            </button>
          ) : null}
        </section>
      ) : null}

      {todos.length > 0 || threadStatus === "running" || threadStatus === "queued" ? (
        <section className="thread-info-section thread-info-todos">
          <h3 className="thread-info-heading">
            <ListTodo size={14} aria-hidden />
            进度
          </h3>
          {todos.length > 0 ? (
            <CoderTodoPanel todos={todos} embedded compact />
          ) : (
            <p className="thread-info-muted thread-info-todos-empty">等待 Planner 通过 SDK Task 工具更新进度…</p>
          )}
        </section>
      ) : null}
    </aside>
  );
}
