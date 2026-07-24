import type { CoreKind } from "@eco/runtime/core-runtime";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DefaultAgentSettingsPanelProps {
  defaultCoreKind: CoreKind;
  codexAvailable: boolean;
  codexUnavailableReason?: string;
  busy?: boolean;
  onChange: (coreKind: CoreKind) => void;
}

export function DefaultAgentSettingsPanel({
  defaultCoreKind,
  codexAvailable,
  codexUnavailableReason,
  busy,
  onChange,
}: DefaultAgentSettingsPanelProps) {
  const { t } = useTranslation();
  const agentOptions = [
    {
      kind: "claude" as const,
      label: "Claude Code",
      description: t("settings.defaultAgent.claudeDescription"),
      iconSrc: "./agent-icons/claude-code.ico",
    },
    {
      kind: "codex" as const,
      label: "Codex",
      description: t("settings.defaultAgent.codexDescription"),
      iconSrc: "./agent-icons/codex.ico",
    },
  ];
  return (
    <>
      <header className="settings-page-header">
        <h1>{t("settings.defaultAgent")}</h1>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.defaultAgent.new")}</span>
            <p className="settings-section-subtitle">{t("settings.defaultAgent.subtitle")}</p>
          </div>
        </div>

        <div className="default-agent-options" role="radiogroup" aria-label={t("settings.defaultAgent")}>
          {agentOptions.map((option) => {
            const selected = option.kind === defaultCoreKind;
            const unavailable = option.kind === "codex" && !codexAvailable;
            return (
              <label
                key={option.kind}
                className={selected ? "default-agent-option is-selected" : "default-agent-option"}
                title={unavailable ? codexUnavailableReason : undefined}
              >
                <input
                  type="radio"
                  name="default-agent"
                  value={option.kind}
                  checked={selected}
                  disabled={busy || unavailable}
                  onChange={() => onChange(option.kind)}
                />
                <span className="default-agent-option-icon" aria-hidden>
                  <img src={option.iconSrc} alt="" />
                </span>
                <span className="default-agent-option-body">
                  <strong>{option.label}</strong>
                  <small>
                    {unavailable
                      ? codexUnavailableReason || t("settings.defaultAgent.unavailable")
                      : option.description}
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
