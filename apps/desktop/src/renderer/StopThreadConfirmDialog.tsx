import type { WorktreeCancelDisposition } from "../shared/ipc";

const MAX_VISIBLE_FILES = 8;

export interface StopThreadConfirmDialogProps {
  changedFiles: string[];
  busy: boolean;
  onConfirm: (disposition: WorktreeCancelDisposition) => void;
  onDismiss: () => void;
}

export function StopThreadConfirmDialog({
  changedFiles,
  busy,
  onConfirm,
  onDismiss,
}: StopThreadConfirmDialogProps) {
  const visibleFiles = changedFiles.slice(0, MAX_VISIBLE_FILES);
  const hiddenCount = changedFiles.length - visibleFiles.length;

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
        className="settings-modal stop-thread-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stop-thread-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <h2 id="stop-thread-confirm-title" className="settings-modal-title">
            停止前是否合并更改？
          </h2>
        </header>
        <div className="settings-modal-body">
          <p className="stop-thread-confirm-lead">
            隔离工作树中有 {changedFiles.length} 个文件相对基线有变更。停止后请选择如何处理：
          </p>
          <ul className="stop-thread-confirm-files">
            {visibleFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
            {hiddenCount > 0 ? <li className="stop-thread-confirm-more">…另有 {hiddenCount} 个文件</li> : null}
          </ul>
        </div>
        <footer className="settings-modal-footer stop-thread-confirm-footer">
          <button
            type="button"
            className="settings-modal-cancel"
            onClick={onDismiss}
            disabled={busy}
          >
            继续运行
          </button>
          <div className="settings-modal-footer-actions stop-thread-confirm-actions">
            <button
              type="button"
              className="plan-button"
              onClick={() => onConfirm("discard")}
              disabled={busy}
            >
              放弃更改并停止
            </button>
            <button
              type="button"
              className="plan-button"
              onClick={() => onConfirm("keep")}
              disabled={busy}
            >
              保留，稍后合并
            </button>
            <button
              type="button"
              className="plan-button primary"
              onClick={() => onConfirm("apply")}
              disabled={busy}
            >
              {busy ? "正在处理…" : "应用到工作区并停止"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
