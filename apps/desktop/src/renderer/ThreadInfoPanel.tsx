import { DollarSign, Folder, GitBranch, Layers, ListTodo, Package } from "lucide-react";
import { formatCostUsd, formatUsageBadge } from "@eco/runtime";
import type { CoderTodoItem, ThreadStatus, ThreadUsageSnapshot, WorkspaceInfo } from "../shared/ipc";
import { CoderTodoPanel } from "./CoderTodoPanel";

export interface ThreadUsageSummary {
  totalCostUsd?: number;
  contextTokens?: number;
  plannerUsage?: ThreadUsageSnapshot;
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
  const contextLabel =
    usageSummary?.contextTokens !== undefined ? formatContextLabel(usageSummary.contextTokens) : null;
  const tokenBadge = usageSummary?.plannerUsage
    ? formatUsageBadge({
        inputTokens: usageSummary.plannerUsage.inputTokens,
        outputTokens: usageSummary.plannerUsage.outputTokens,
        cacheReadTokens: usageSummary.plannerUsage.cacheReadTokens,
        cacheCreationTokens: usageSummary.plannerUsage.cacheCreationTokens,
      })
    : null;

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
          {usageSummary?.totalCostUsd !== undefined && usageSummary.totalCostUsd > 0 ? (
            <li className="thread-info-cost">
              <DollarSign size={14} aria-hidden />
              <span
                className="thread-info-value"
                title="Claude Agent SDK 客户端估算，非权威账单。多轮 query() 累计。"
              >
                累计 {formatCostUsd(usageSummary.totalCostUsd)}
              </span>
            </li>
          ) : null}
          {contextLabel ? (
            <li className="thread-info-usage">
              <Layers size={14} aria-hidden />
              <span
                className="thread-info-value"
                title="Planner 最近一次请求的输入 token（含缓存读/写），非整段对话累计"
              >
                已用上下文 {contextLabel}
                {tokenBadge ? (
                  <span className="thread-info-token-badge" title="输入↑ 输出↓ 缓存⊙">
                    {" "}
                    · {tokenBadge}
                  </span>
                ) : null}
              </span>
            </li>
          ) : null}
        </ul>
      </section>

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
