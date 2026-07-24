import type { SkillInfo } from "../shared/skills";
import { useTranslation } from "react-i18next";

interface SkillUninstallConfirmDialogProps {
  skill: SkillInfo;
  busy: boolean;
  error?: string | undefined;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function SkillUninstallConfirmDialog({
  skill,
  busy,
  error,
  onConfirm,
  onDismiss,
}: SkillUninstallConfirmDialogProps) {
  const { t } = useTranslation();
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
        className="settings-modal skill-uninstall-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-uninstall-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <h2 id="skill-uninstall-title" className="settings-modal-title">
            {t("settings.skills.uninstallTitle", { name: skill.name })}
          </h2>
        </header>
        <div className="settings-modal-body">
          <p className="skill-uninstall-lead">{t("settings.skills.uninstallDescription")}</p>
          <code className="skill-uninstall-path">{skill.directory}</code>
          {error ? <p className="settings-form-error">{error}</p> : null}
        </div>
        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onDismiss} disabled={busy}>
            {t("common.cancel")}
          </button>
          <div className="settings-modal-footer-actions">
            <button type="button" className="settings-danger-button" onClick={onConfirm} disabled={busy}>
              {busy ? t("settings.skills.uninstalling") : t("settings.mcp.uninstall")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
