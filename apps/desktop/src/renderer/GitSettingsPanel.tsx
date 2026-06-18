import { useEffect, useState } from "react";
import type { GitSettingsSnapshot } from "../shared/ipc";

interface GitSettingsPanelProps {
  settings: GitSettingsSnapshot;
  busy?: boolean;
  onSave: (settings: GitSettingsSnapshot) => Promise<void>;
}

export function GitSettingsPanel({ settings, busy, onSave }: GitSettingsPanelProps) {
  const savedInstructions = settings.commitMessageInstructions ?? "";
  const [draft, setDraft] = useState(savedInstructions);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== savedInstructions;

  useEffect(() => {
    setDraft(savedInstructions);
  }, [savedInstructions]);

  async function handleSave() {
    if (!dirty || saving || busy) {
      return;
    }
    setSaving(true);
    try {
      const trimmed = draft.trim();
      await onSave({
        commitMessageRoleByProfileId: settings.commitMessageRoleByProfileId,
        ...(trimmed ? { commitMessageInstructions: trimmed } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="settings-page-header">
        <h1>Git</h1>
      </header>

      <section className="settings-section git-settings-section">
        <div className="settings-section-head git-settings-section-head">
          <div>
            <span className="settings-section-label">提交指令</span>
            <p className="settings-section-subtitle">已添加到提交信息生成提示中</p>
          </div>
          <button
            type="button"
            className={dirty ? "settings-primary-button" : "settings-secondary-button"}
            disabled={!dirty || saving || busy}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>

        <textarea
          className="git-settings-instructions-input"
          value={draft}
          placeholder="使用中文"
          rows={6}
          disabled={saving || busy}
          onChange={(event) => setDraft(event.target.value)}
        />
      </section>
    </>
  );
}
