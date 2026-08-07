import { Globe } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BrowserSettingsSnapshot, BrowserViewState } from "../shared/browser";

interface BrowserSettingsPanelProps {
  settings: BrowserSettingsSnapshot;
  browserState?: BrowserViewState;
  onSave: (settings: BrowserSettingsSnapshot) => Promise<void>;
}

export function BrowserSettingsPanel({
  settings,
  browserState,
  onSave,
}: BrowserSettingsPanelProps) {
  const { t } = useTranslation();
  const switchId = useId();
  const [busy, setBusy] = useState(false);

  async function toggleAgentIntegration(enabled: boolean) {
    setBusy(true);
    try {
      await onSave({ agentIntegrationEnabled: enabled });
    } finally {
      setBusy(false);
    }
  }

  const unavailable =
    settings.agentIntegrationEnabled && browserState?.agentBrowserAvailable === false;

  return (
    <div className="settings-panel browser-settings-panel">
      <header className="settings-panel-header">
        <Globe size={20} aria-hidden />
        <div>
          <h2>{t("settings.browser")}</h2>
          <p>{t("settings.browser.subtitle")}</p>
        </div>
      </header>

      <section className="settings-section-block">
        <div className="settings-row browser-settings-row">
          <span className="settings-row-main">
            <strong id={`${switchId}-label`}>{t("settings.browser.agentIntegration")}</strong>
            <small>{t("settings.browser.agentIntegrationHint")}</small>
          </span>
          <label className="composer-switch">
            <input
              id={switchId}
              type="checkbox"
              checked={settings.agentIntegrationEnabled}
              disabled={busy}
              aria-labelledby={`${switchId}-label`}
              onChange={(event) => void toggleAgentIntegration(event.target.checked)}
            />
            <span className="composer-switch-track" />
          </label>
        </div>
        {settings.agentIntegrationEnabled ? (
          <p className="settings-hint">
            {browserState?.agentBrowserAvailable
              ? t("settings.browser.agentReady")
              : t("settings.browser.agentUnavailable", {
                  reason:
                    browserState?.agentBrowserUnavailableReason ??
                    t("settings.browser.agentUnknownReason"),
                })}
          </p>
        ) : (
          <p className="settings-hint">{t("settings.browser.userOnlyHint")}</p>
        )}
        {unavailable ? (
          <p className="settings-hint settings-hint-warning" role="status">
            {t("settings.browser.agentUnavailable", {
              reason:
                browserState?.agentBrowserUnavailableReason ??
                t("settings.browser.agentUnknownReason"),
            })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
