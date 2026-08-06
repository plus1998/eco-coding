import {
  GLOBAL_CONTEXT_WINDOW_LIMIT_PRESETS,
  GLOBAL_MAX_OUTPUT_TOKEN_PRESETS,
  type GlobalContextWindowLimit,
  type GlobalMaxOutputTokens,
} from "@eco/runtime/models-dev-limits";
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const contextPresetLabels = new Map<number, string>([
  [131_072, "128K"],
  [204_800, "200K"],
  [262_144, "262K"],
  [524_288, "512K"],
  [1_048_576, "1M"],
]);

const maxOutputPresetLabels = new Map<number, string>([
  [8_192, "8K"],
  [16_384, "16K"],
  [32_000, "32K"],
  [64_000, "64K"],
  [128_000, "128K"],
]);

interface ContextWindowSettingsPanelProps {
  contextWindowLimitTokens: number;
  maxOutputLimitTokens: number;
  onChangeContextWindow: (value: GlobalContextWindowLimit) => Promise<void>;
  onChangeMaxOutput: (value: GlobalMaxOutputTokens) => Promise<void>;
}

export function ContextWindowSettingsPanel({
  contextWindowLimitTokens,
  maxOutputLimitTokens,
  onChangeContextWindow,
  onChangeMaxOutput,
}: ContextWindowSettingsPanelProps) {
  const { t } = useTranslation();
  const [savingContext, setSavingContext] = useState(false);
  const [savingMaxOutput, setSavingMaxOutput] = useState(false);

  async function selectContext(next: GlobalContextWindowLimit) {
    if (savingContext || next === contextWindowLimitTokens) {
      return;
    }
    setSavingContext(true);
    try {
      await onChangeContextWindow(next);
    } finally {
      setSavingContext(false);
    }
  }

  async function selectMaxOutput(next: GlobalMaxOutputTokens) {
    if (savingMaxOutput || next === maxOutputLimitTokens) {
      return;
    }
    setSavingMaxOutput(true);
    try {
      await onChangeMaxOutput(next);
    } finally {
      setSavingMaxOutput(false);
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
            const selected = tokens === contextWindowLimitTokens;
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
                  disabled={savingContext}
                  onChange={() => void selectContext(tokens)}
                />
                <span className="default-agent-option-icon" aria-hidden>
                  {contextPresetLabels.get(tokens)}
                </span>
                <span className="default-agent-option-body">
                  <strong>{contextPresetLabels.get(tokens)}</strong>
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

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.maxOutput.limit")}</span>
            <p className="settings-section-subtitle">{t("settings.maxOutput.subtitle")}</p>
          </div>
        </div>

        <div
          className="default-agent-options context-window-limit-options"
          role="radiogroup"
          aria-label={t("settings.maxOutput.limit")}
        >
          {GLOBAL_MAX_OUTPUT_TOKEN_PRESETS.map((tokens) => {
            const selected = tokens === maxOutputLimitTokens;
            return (
              <label
                key={tokens}
                className={selected ? "default-agent-option is-selected" : "default-agent-option"}
              >
                <input
                  type="radio"
                  name="max-output-limit"
                  value={tokens}
                  checked={selected}
                  disabled={savingMaxOutput}
                  onChange={() => void selectMaxOutput(tokens)}
                />
                <span className="default-agent-option-icon" aria-hidden>
                  {maxOutputPresetLabels.get(tokens)}
                </span>
                <span className="default-agent-option-body">
                  <strong>{maxOutputPresetLabels.get(tokens)}</strong>
                  <small>
                    {t("settings.maxOutput.tokens", {
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
