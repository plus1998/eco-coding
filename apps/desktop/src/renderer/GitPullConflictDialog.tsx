export interface GitPullConflictDialogProps {
  conflictFiles: string[];
  busy: boolean;
  onConfirmAgent: () => void;
  onDismiss: () => void;
}

const MAX_VISIBLE_FILES = 8;

export function GitPullConflictDialog({
  conflictFiles,
  busy,
  onConfirmAgent,
  onDismiss,
}: GitPullConflictDialogProps) {
  const visibleFiles = conflictFiles.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = conflictFiles.length - visibleFiles.length;

  return (
    <div
      className="settings-modal-backdrop"
      onClick={() => {
        if (!busy) {
          onDismiss();
        }
      }}
    >
      <div
        className="settings-modal git-pull-conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-pull-conflict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <h2 id="git-pull-conflict-title" className="settings-modal-title">
            拉取产生合并冲突
          </h2>
        </header>
        <div className="settings-modal-body">
          <p className="git-pull-conflict-lead">
            远程变更与本地修改冲突，共 {conflictFiles.length} 个文件需要处理。是否让 Agent 自动解决冲突并完成合并？
          </p>
          <ul className="git-pull-conflict-files">
            {visibleFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
            {hiddenCount > 0 ? <li className="git-pull-conflict-more">…另有 {hiddenCount} 个文件</li> : null}
          </ul>
        </div>
        <footer className="settings-modal-footer git-pull-conflict-footer">
          <button
            type="button"
            className="settings-modal-cancel"
            onClick={onDismiss}
            disabled={busy}
          >
            我自己处理
          </button>
          <div className="settings-modal-footer-actions git-pull-conflict-actions">
            <button
              type="button"
              className="plan-button primary"
              onClick={onConfirmAgent}
              disabled={busy}
            >
              {busy ? "正在交给 Agent…" : "让 Agent 处理"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
