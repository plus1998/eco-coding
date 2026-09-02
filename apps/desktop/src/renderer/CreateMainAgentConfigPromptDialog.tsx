import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface CreateMainAgentConfigPromptDialogProps {
  onConfirm: () => void;
  onDismiss: () => void;
}

export function CreateMainAgentConfigPromptDialog({
  onConfirm,
  onDismiss,
}: CreateMainAgentConfigPromptDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="settings-modal-backdrop create-main-config-prompt-backdrop"
      onClick={onDismiss}
    >
      <div
        className="settings-modal create-main-config-prompt-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="create-main-config-prompt-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-modal-body create-main-config-prompt-body">
          <div className="create-main-config-prompt-icon-wrap" aria-hidden>
            <CheckCircle2 size={28} strokeWidth={1.75} className="create-main-config-prompt-icon" />
          </div>
          <p id="create-main-config-prompt-message" className="create-main-config-prompt-message">
            {t("settings.models.createMainConfigPrompt.message")}
          </p>
        </div>
        <footer className="settings-modal-footer create-main-config-prompt-footer">
          <button type="button" className="create-main-config-prompt-secondary" onClick={onDismiss}>
            {t("settings.models.createMainConfigPrompt.dismiss")}
          </button>
          <button type="button" className="create-main-config-prompt-primary" onClick={onConfirm}>
            {t("settings.models.createMainConfigPrompt.confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}
