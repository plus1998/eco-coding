import { useTranslation } from "react-i18next";

export interface StopThreadConfirmDialogProps {
  changedFiles: string[];
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

const MAX_VISIBLE_FILES = 8;

export function StopThreadConfirmDialog({
  changedFiles,
  busy,
  onConfirm,
  onDismiss,
}: StopThreadConfirmDialogProps) {
  const { t } = useTranslation();
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
            {t("dialog.stop.title")}
          </h2>
        </header>
        <div className="settings-modal-body">
          <p className="stop-thread-confirm-lead">
            {t("dialog.stop.changedFiles", { count: changedFiles.length })}
          </p>
          <ul className="stop-thread-confirm-files">
            {visibleFiles.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
            {hiddenCount > 0 ? (
              <li className="stop-thread-confirm-more">
                {t("dialog.stop.moreFiles", { count: hiddenCount })}
              </li>
            ) : null}
          </ul>
        </div>
        <footer className="settings-modal-footer stop-thread-confirm-footer">
          <button
            type="button"
            className="settings-modal-cancel"
            onClick={onDismiss}
            disabled={busy}
          >
            {t("dialog.stop.continue")}
          </button>
          <div className="settings-modal-footer-actions stop-thread-confirm-actions">
            <button
              type="button"
              className="plan-button primary"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? t("dialog.stop.stopping") : t("dialog.stop.confirm")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
