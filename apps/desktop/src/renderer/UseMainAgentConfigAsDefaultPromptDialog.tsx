import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface UseMainAgentConfigAsDefaultPromptDialogProps {
  onConfirm: () => void;
  onDismiss: () => void;
}

export function UseMainAgentConfigAsDefaultPromptDialog({
  onConfirm,
  onDismiss,
}: UseMainAgentConfigAsDefaultPromptDialogProps) {
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
        aria-labelledby="use-main-config-as-default-prompt-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-modal-body create-main-config-prompt-body">
          <div className="create-main-config-prompt-icon-wrap" aria-hidden>
            <CheckCircle2 size={28} strokeWidth={1.75} className="create-main-config-prompt-icon" />
          </div>
          <p
            id="use-main-config-as-default-prompt-message"
            className="create-main-config-prompt-message"
          >
            {t("settings.models.useMainConfigAsDefaultPrompt.message")}
          </p>
        </div>
        <footer className="settings-modal-footer create-main-config-prompt-footer">
          <button type="button" className="create-main-config-prompt-secondary" onClick={onDismiss}>
            {t("settings.models.useMainConfigAsDefaultPrompt.dismiss")}
          </button>
          <button type="button" className="create-main-config-prompt-primary" onClick={onConfirm}>
            {t("settings.models.useMainConfigAsDefaultPrompt.confirm")}
          </button>
        </footer>
      </div>
    </div>
  );
}
