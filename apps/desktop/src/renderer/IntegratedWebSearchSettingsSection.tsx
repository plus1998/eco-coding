import { LinkIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
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

const PROVIDERS: readonly {
  id: IntegratedWebSearchProvider;
  apiKeyUrl: string;
}[] = [
  { id: "tavily", apiKeyUrl: "https://app.tavily.com/home" },
  { id: "doubao", apiKeyUrl: "https://console.volcengine.com/search-infinity" },
  { id: "brave", apiKeyUrl: "https://api-dashboard.search.brave.com/" },
];

export function IntegratedWebSearchSettingsSection({
  settings,
  disabled,
  onSave,
}: IntegratedWebSearchSettingsSectionProps) {
  const { t } = useTranslation();
  const enableId = useId();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [provider, setProvider] = useState(settings.provider);
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  useEffect(() => {
    setEnabled(settings.enabled);
  }, [settings.enabled]);

  useEffect(() => {
    setProvider(settings.provider);
  }, [settings.provider]);

  const selectedProvider = PROVIDERS.find((entry) => entry.id === provider) ?? PROVIDERS[0]!;
  const fieldsDisabled = disabled || !enabled;

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
    <section className="provider-form-section models-integrated-web-search-section">
      <div className="mcp-field models-toggle-field provider-enable-row">
        <span className="integrated-web-search-enable-copy" id={enableId}>
          <span className="mcp-field-label">{t("settings.integratedWebSearch.enabled")}</span>
          <span className="mcp-field-hint">{t("settings.integratedWebSearch.hint")}</span>
        </span>
        <label
          className="mcp-toggle mcp-toggle-sm"
          title={enabled ? t("common.enabled") : t("common.disabled")}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={disabled}
            aria-labelledby={enableId}
            onChange={(event) => commitEnabled(event.target.checked)}
          />
          <span className="mcp-toggle-track" aria-hidden />
        </label>
      </div>

      <div className="mcp-field models-provider-preset-field">
        <span className="mcp-field-label">{t("settings.integratedWebSearch.provider")}</span>
        <div
          className="provider-preset-tabs"
          role="radiogroup"
          aria-label={t("settings.integratedWebSearch.provider")}
        >
          {PROVIDERS.map((entry) => {
            const selected = provider === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                className={`provider-preset-tab${selected ? " is-active" : ""}`}
                aria-checked={selected}
                disabled={fieldsDisabled}
                onClick={() => commitProvider(entry.id)}
              >
                <span className="provider-preset-tab-label">
                  {t(`settings.integratedWebSearch.providers.${entry.id}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <label className="mcp-field">
        <span className="models-provider-label-row">
          <span className="mcp-field-label">{t(`settings.integratedWebSearch.apiKey.${provider}`)}</span>
          <span className="integrated-web-search-api-key-actions">
            <a
              className="models-provider-inline-link"
              href={selectedProvider.apiKeyUrl}
              target="_blank"
              rel="noreferrer"
            >
              <LinkIcon size={12} />
              {t("settings.integratedWebSearch.createKey")}
            </a>
            {settings.hasApiKey ? (
              <button
                type="button"
                className="models-provider-inline-link integrated-web-search-clear-key"
                disabled={fieldsDisabled}
                onClick={() => clearApiKey()}
              >
                {t("settings.integratedWebSearch.clearApiKey")}
              </button>
            ) : null}
          </span>
        </span>
        <input
          className="mcp-field-input"
          type="password"
          value={apiKeyDraft}
          placeholder={
            settings.hasApiKey
              ? t("settings.integratedWebSearch.apiKeyConfigured")
              : t(`settings.integratedWebSearch.apiKeyPlaceholder.${provider}`)
          }
          disabled={fieldsDisabled}
          onChange={(event) => setApiKeyDraft(event.target.value)}
          onBlur={() => commitApiKey()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </label>
    </section>
  );
}
