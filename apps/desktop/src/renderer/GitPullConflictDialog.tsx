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
  const { t } = useTranslation();
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
            {t("git.conflict.title")}
          </h2>
        </header>
        <div className="settings-modal-body">
          <p className="git-pull-conflict-lead">
            {t("git.conflict.description", { count: conflictFiles.length })}
          </p>
          <ul className="git-pull-conflict-files">
            {visibleFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
            {hiddenCount > 0 ? (
              <li className="git-pull-conflict-more">
                {t("git.conflict.more", { count: hiddenCount })}
              </li>
            ) : null}
          </ul>
        </div>
        <footer className="settings-modal-footer git-pull-conflict-footer">
          <button
            type="button"
            className="settings-modal-cancel"
            onClick={onDismiss}
            disabled={busy}
          >
            {t("git.conflict.manual")}
          </button>
          <div className="settings-modal-footer-actions git-pull-conflict-actions">
            <button
              type="button"
              className="plan-button primary"
              onClick={onConfirmAgent}
              disabled={busy}
            >
              {busy ? t("git.conflict.handingOff") : t("git.conflict.agent")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
import { useTranslation } from "react-i18next";
