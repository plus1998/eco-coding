import type { CoreKind } from "@eco/runtime/core-runtime";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DefaultAgentSettingsPanelProps {
  defaultCoreKind: CoreKind;
  codexAvailable: boolean;
  codexUnavailableReason?: string;
  piAvailable?: boolean;
  piUnavailableReason?: string;
  busy?: boolean;
  onChange: (coreKind: CoreKind) => void;
}

export function DefaultAgentSettingsPanel({
  defaultCoreKind,
  codexAvailable,
  codexUnavailableReason,
  piAvailable = true,
  piUnavailableReason,
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
    {
      kind: "pi" as const,
      label: "π",
      description: t("settings.defaultAgent.piDescription"),
      iconSrc: "./agent-icons/pi.svg",
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
            const unavailable =
              (option.kind === "codex" && !codexAvailable) ||
              (option.kind === "pi" && !piAvailable);
            const unavailableReason =
              option.kind === "codex"
                ? codexUnavailableReason
                : option.kind === "pi"
                  ? piUnavailableReason
                  : undefined;
            return (
              <label
                key={option.kind}
                className={selected ? "default-agent-option is-selected" : "default-agent-option"}
                title={unavailable ? unavailableReason : undefined}
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
                      ? unavailableReason || t("settings.defaultAgent.unavailable")
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
