import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  IntegratedWebSearchProvider,
  IntegratedWebSearchSettingsSaveInput,
  IntegratedWebSearchSettingsSnapshot,
} from "../shared/ipc";

interface IntegratedWebSearchSettingsSectionProps {
  settings: IntegratedWebSearchSettingsSnapshot;
  disabled?: boolean | undefined;
  onSave: (input: IntegratedWebSearchSettingsSaveInput) => void;
}

const PROVIDERS: IntegratedWebSearchProvider[] = ["tavily", "doubao", "brave"];

export function IntegratedWebSearchSettingsSection({
  settings,
  disabled,
  onSave,
}: IntegratedWebSearchSettingsSectionProps) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [provider, setProvider] = useState(settings.provider);
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  useEffect(() => {
    setEnabled(settings.enabled);
  }, [settings.enabled]);

  useEffect(() => {
    setProvider(settings.provider);
  }, [settings.provider]);

  function commitEnabled(nextEnabled: boolean) {
    setEnabled(nextEnabled);
    if (nextEnabled === settings.enabled) {
      return;
    }
    onSave({ enabled: nextEnabled });
  }

  function commitProvider(nextProvider: IntegratedWebSearchProvider) {
    setProvider(nextProvider);
    if (nextProvider === settings.provider) {
      return;
    }
    onSave({ provider: nextProvider });
  }

  function commitApiKey() {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      return;
    }
    onSave({ apiKey: trimmed });
    setApiKeyDraft("");
  }

  function clearApiKey() {
    onSave({ apiKey: "" });
    setApiKeyDraft("");
  }

  return (
    <section className="mcp-list-section models-integrated-web-search-section">
      <label className="mcp-field mcp-field-checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => commitEnabled(event.target.checked)}
        />
        <span className="mcp-field-label">{t("settings.integratedWebSearch.enabled")}</span>
      </label>
      <p className="mcp-field-hint">{t("settings.integratedWebSearch.hint")}</p>
      <div className="mcp-list-toolbar">
        <span className="mcp-list-toolbar-label">{t("settings.integratedWebSearch.provider")}</span>
      </div>
      <ul
        className="mcp-server-list integrated-web-search-provider-list"
        role="radiogroup"
        aria-label={t("settings.integratedWebSearch.provider")}
      >
        {PROVIDERS.map((entry) => {
          const selected = provider === entry;
          return (
            <li
              key={entry}
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || !enabled}
              tabIndex={disabled || !enabled ? -1 : selected ? 0 : -1}
              className={`mcp-server-row integrated-web-search-provider-row${selected ? " is-selected" : ""}`}
              onClick={() => {
                if (disabled || !enabled) {
                  return;
                }
                commitProvider(entry);
              }}
              onKeyDown={(event) => {
                if (disabled || !enabled) {
                  return;
                }
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  commitProvider(entry);
                }
              }}
            >
              <div className="mcp-server-summary">
                <span className="mcp-server-name">{t(`settings.integratedWebSearch.providers.${entry}`)}</span>
                <span className="mcp-server-meta">{t(`settings.integratedWebSearch.providerHint.${entry}`)}</span>
              </div>
              <div className="mcp-server-actions">
                <span className="integrated-web-search-provider-check" aria-hidden="true">
                  {selected ? <Check size={18} strokeWidth={2.2} /> : null}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <label className="mcp-field">
        <span className="mcp-field-label">{t(`settings.integratedWebSearch.apiKey.${provider}`)}</span>
        <input
          className="mcp-field-input"
          type="password"
          value={apiKeyDraft}
          placeholder={
            settings.hasApiKey
              ? t("settings.integratedWebSearch.apiKeyConfigured")
              : t(`settings.integratedWebSearch.apiKeyPlaceholder.${provider}`)
          }
          disabled={disabled || !enabled}
          onChange={(event) => setApiKeyDraft(event.target.value)}
          onBlur={() => commitApiKey()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="mcp-field-hint">{t("settings.integratedWebSearch.apiKeyHint")}</span>
      </label>
      {settings.hasApiKey ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || !enabled}
          onClick={() => clearApiKey()}
        >
          {t("settings.integratedWebSearch.clearApiKey")}
        </button>
      ) : null}
    </section>
  );
}
