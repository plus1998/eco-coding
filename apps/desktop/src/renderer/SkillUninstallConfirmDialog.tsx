import type { SkillInfo } from "../shared/skills";

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
            卸载 {skill.name}？
          </h2>
        </header>
        <div className="settings-modal-body">
          <p className="skill-uninstall-lead">将删除此来源中的 Skill 目录或链接，此操作无法撤销。</p>
          <code className="skill-uninstall-path">{skill.directory}</code>
          {error ? <p className="settings-form-error">{error}</p> : null}
        </div>
        <footer className="settings-modal-footer">
          <button type="button" className="settings-modal-cancel" onClick={onDismiss} disabled={busy}>
            取消
          </button>
          <div className="settings-modal-footer-actions">
            <button type="button" className="settings-danger-button" onClick={onConfirm} disabled={busy}>
              {busy ? "正在卸载…" : "卸载"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
