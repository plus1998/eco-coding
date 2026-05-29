import { Folder, GitBranch, ListTodo, Package } from "lucide-react";
import type { CoderTodoItem, ThreadStatus, WorkspaceInfo } from "../shared/ipc";
import { CoderTodoPanel } from "./CoderTodoPanel";

interface ThreadInfoPanelProps {
  workspace?: WorkspaceInfo;
  workspacePath?: string;
  gitBranch?: string;
  dirtyFileCount?: number;
  todos: CoderTodoItem[];
  pendingWorktreeApply?: { changedFiles: string[] };
  threadStatus?: ThreadStatus;
  onApplyWorktree?: () => void;
  worktreeApplyBusy?: boolean;
}

export function ThreadInfoPanel({
  workspace,
  workspacePath,
  gitBranch,
  dirtyFileCount,
  todos,
  pendingWorktreeApply,
  threadStatus,
  onApplyWorktree,
  worktreeApplyBusy,
}: ThreadInfoPanelProps) {
  const projectLabel = workspacePath?.split("/").filter(Boolean).pop() ?? workspace?.name ?? "未打开项目";

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
            <p className="thread-info-muted thread-info-todos-empty">等待 Planner 通过 TodoWrite 更新进度…</p>
          )}
        </section>
      ) : null}
    </aside>
  );
}
