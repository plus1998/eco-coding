import { AppWindow, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  BrowserOpenApprovalMode,
  BrowserSettingsSnapshot,
  BrowserViewState,
} from "../shared/browser";

interface BrowserSettingsPanelProps {
  settings: BrowserSettingsSnapshot;
  browserState?: BrowserViewState;
  onSave: (settings: BrowserSettingsSnapshot) => Promise<void>;
}

const OPEN_APPROVAL_OPTIONS: BrowserOpenApprovalMode[] = ["always_allow", "always_ask"];

export function BrowserSettingsPanel({
  settings,
  browserState,
  onSave,
}: BrowserSettingsPanelProps) {
  const { t } = useTranslation();
  const switchId = useId();
  const approvalId = useId();
  const [busy, setBusy] = useState(false);

  const unavailable =
    settings.agentIntegrationEnabled && browserState?.agentBrowserAvailable === false;
  const unavailableReason =
    browserState?.agentBrowserUnavailableReason ?? t("settings.browser.agentUnknownReason");

  async function save(next: BrowserSettingsSnapshot) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="browser-settings">
      <header className="settings-page-header browser-settings-header">
        <h1>{t("settings.browser")}</h1>
        <p className="settings-page-desc">{t("settings.browser.pageDesc")}</p>
      </header>

      <section className="browser-settings-card browser-settings-master" aria-labelledby={switchId}>
        <div className="browser-settings-master-glyph" aria-hidden>
          <AppWindow size={20} strokeWidth={1.75} />
        </div>
        <div className="browser-settings-master-copy" id={switchId}>
          <strong>{t("settings.browser.masterTitle")}</strong>
          <small>{t("settings.browser.masterHint")}</small>
        </div>
        <label
          className="composer-switch browser-settings-switch"
          title={t(
            settings.agentIntegrationEnabled
              ? "composer.enabledNamed"
              : "composer.disabledNamed",
            { name: t("settings.browser.masterTitle") },
          )}
        >
          <input
            type="checkbox"
            checked={settings.agentIntegrationEnabled}
            disabled={busy}
            aria-labelledby={switchId}
            onChange={(event) =>
              void save({
                ...settings,
                agentIntegrationEnabled: event.target.checked,
              })
            }
          />
          <span className="composer-switch-track" aria-hidden />
        </label>
      </section>

      {unavailable ? (
        <p className="browser-settings-error" role="status">
          {t("settings.browser.statusUnavailable", { reason: unavailableReason })}
        </p>
      ) : null}

      {settings.agentIntegrationEnabled ? (
        <section className="browser-settings-section" aria-labelledby={`${approvalId}-heading`}>
          <h2 className="browser-settings-section-title" id={`${approvalId}-heading`}>
            {t("settings.browser.permissions")}
          </h2>
          <ul className="browser-settings-group">
            <li className="browser-settings-group-row">
              <span className="browser-settings-group-copy">
                <strong id={approvalId}>{t("settings.browser.openApproval")}</strong>
                <small>{t("settings.browser.openApprovalHint")}</small>
              </span>
              <label className="browser-settings-select">
                <span className="sr-only">{t("settings.browser.openApproval")}</span>
                <select
                  value={settings.openApprovalMode}
                  disabled={busy}
                  aria-labelledby={approvalId}
                  onChange={(event) =>
                    void save({
                      ...settings,
                      openApprovalMode: event.target.value as BrowserOpenApprovalMode,
                    })
                  }
                >
                  {OPEN_APPROVAL_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`settings.browser.openApproval.${mode}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} strokeWidth={2} aria-hidden className="browser-settings-select-chevron" />
              </label>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
