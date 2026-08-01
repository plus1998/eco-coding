import {
  GLOBAL_CONTEXT_WINDOW_LIMIT_PRESETS,
  type GlobalContextWindowLimit,
} from "@eco/runtime/models-dev-limits";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const presetLabels = new Map<number, string>([
  [131_072, "128K"],
  [204_800, "200K"],
  [262_144, "262K"],
  [524_288, "512K"],
  [1_048_576, "1M"],
]);

interface ContextWindowSettingsPanelProps {
  value: number;
  onChange: (value: GlobalContextWindowLimit) => Promise<void>;
}

export function ContextWindowSettingsPanel({ value, onChange }: ContextWindowSettingsPanelProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  async function select(next: GlobalContextWindowLimit) {
    if (saving || next === value) {
      return;
    }
    setSaving(true);
    try {
      await onChange(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <header className="settings-page-header">
        <h1>{t("settings.contextWindow")}</h1>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.contextWindow.limit")}</span>
            <p className="settings-section-subtitle">{t("settings.contextWindow.subtitle")}</p>
          </div>
        </div>

        <div
          className="default-agent-options context-window-limit-options"
          role="radiogroup"
          aria-label={t("settings.contextWindow.limit")}
        >
          {GLOBAL_CONTEXT_WINDOW_LIMIT_PRESETS.map((tokens) => {
            const selected = tokens === value;
            return (
              <label
                key={tokens}
                className={selected ? "default-agent-option is-selected" : "default-agent-option"}
              >
                <input
                  type="radio"
                  name="context-window-limit"
                  value={tokens}
                  checked={selected}
                  disabled={saving}
                  onChange={() => void select(tokens)}
                />
                <span className="default-agent-option-icon" aria-hidden>
                  {presetLabels.get(tokens)}
                </span>
                <span className="default-agent-option-body">
                  <strong>{presetLabels.get(tokens)}</strong>
                  <small>
                    {t("settings.contextWindow.tokens", {
                      tokens: tokens.toLocaleString(),
                    })}
                  </small>
                </span>
                <span className="default-agent-option-state" aria-hidden>
                  {selected ? <Check size={15} /> : null}
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </>
  );
}
