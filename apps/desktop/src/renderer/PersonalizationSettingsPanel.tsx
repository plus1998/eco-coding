import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PersonalizationSettingsSnapshot } from "../shared/ipc";

interface PersonalizationSettingsPanelProps {
  settings: PersonalizationSettingsSnapshot;
  busy?: boolean;
  onSave: (settings: PersonalizationSettingsSnapshot) => Promise<void>;
}

export function PersonalizationSettingsPanel({ settings, busy, onSave }: PersonalizationSettingsPanelProps) {
  const { t } = useTranslation();
  const savedRules = settings.globalRules ?? "";
  const [draft, setDraft] = useState(savedRules);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== savedRules;

  useEffect(() => {
    setDraft(savedRules);
  }, [savedRules]);

  async function handleSave() {
    if (!dirty || saving || busy) {
      return;
    }
    setSaving(true);
    try {
      const trimmed = draft.trim();
      await onSave({
        ...(trimmed ? { globalRules: trimmed } : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="settings-page-header">
        <h1>{t("settings.personalization")}</h1>
      </header>

      <section className="settings-section git-settings-section">
        <div className="settings-section-head git-settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.personalization.rules")}</span>
            <p className="settings-section-subtitle">{t("settings.personalization.rulesSubtitle")}</p>
          </div>
          <button
            type="button"
            className={dirty ? "settings-primary-button" : "settings-secondary-button"}
            disabled={!dirty || saving || busy}
            onClick={() => void handleSave()}
          >
            {saving ? t("settings.personalization.saving") : t("common.save")}
          </button>
        </div>

        <textarea
          className="git-settings-instructions-input"
          value={draft}
          placeholder={t("settings.personalization.placeholder")}
          rows={12}
          disabled={saving || busy}
          onChange={(event) => setDraft(event.target.value)}
        />
      </section>
    </>
  );
}
