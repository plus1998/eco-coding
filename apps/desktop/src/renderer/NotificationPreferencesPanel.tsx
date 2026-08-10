import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppLocalePreference } from "../shared/locale";
import {
  type NotificationSettingsSnapshot,
  type TurnCompletionNotifyMode,
  TURN_COMPLETION_NOTIFY_MODES,
} from "../shared/notification-settings";

interface NotificationPreferencesPanelProps {
  settings: NotificationSettingsSnapshot;
  onSave: (settings: NotificationSettingsSnapshot) => Promise<void>;
  localePreference: AppLocalePreference;
  onLocalePreferenceChange: (preference: AppLocalePreference) => void;
  cacheBreakTipsEnabled: boolean;
  onCacheBreakTipsEnabledChange: (enabled: boolean) => void;
}

const LOCALE_OPTIONS: readonly AppLocalePreference[] = ["system", "zh-CN", "en-US"];

export function NotificationPreferencesPanel({
  settings,
  onSave,
  localePreference,
  onLocalePreferenceChange,
  cacheBreakTipsEnabled,
  onCacheBreakTipsEnabledChange,
}: NotificationPreferencesPanelProps) {
  const { t } = useTranslation();
  const turnSelectId = useId();
  const languageSelectId = useId();
  const cacheBreakTipsId = useId();
  const permissionId = useId();
  const questionId = useId();
  const [busy, setBusy] = useState(false);

  async function save(next: NotificationSettingsSnapshot) {
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

  function localeLabel(id: AppLocalePreference): string {
    switch (id) {
      case "system":
        return t("settings.language.system");
      case "zh-CN":
        return t("settings.language.zh");
      case "en-US":
        return t("settings.language.en");
    }
  }

  return (
    <div className="notification-preferences">
      <header className="settings-page-header">
        <h1>{t("settings.preferences")}</h1>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.preferences.general")}</span>
          </div>
        </div>

        <ul className="settings-rows">
          <li>
            <label className="notification-settings-row" htmlFor={languageSelectId}>
              <span className="settings-row-main">
                <strong>{t("settings.language")}</strong>
                <small>{t("settings.languageSubtitle")}</small>
              </span>
              <span className="notification-settings-select">
                <select
                  id={languageSelectId}
                  value={localePreference}
                  onChange={(event) => {
                    const next = event.target.value as AppLocalePreference;
                    if (!LOCALE_OPTIONS.includes(next)) {
                      return;
                    }
                    onLocalePreferenceChange(next);
                  }}
                >
                  {LOCALE_OPTIONS.map((id) => (
                    <option key={id} value={id}>
                      {localeLabel(id)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden />
              </span>
            </label>
          </li>

          <li>
            <div className="notification-settings-row">
              <span className="settings-row-main" id={cacheBreakTipsId}>
                <strong>{t("settings.cacheBreakTips")}</strong>
                <small>{t("settings.cacheBreakTipsHint")}</small>
              </span>
              <label
                className="composer-switch notification-settings-switch"
                title={t(
                  cacheBreakTipsEnabled ? "composer.enabledNamed" : "composer.disabledNamed",
                  { name: t("settings.cacheBreakTips") },
                )}
              >
                <input
                  type="checkbox"
                  checked={cacheBreakTipsEnabled}
                  aria-labelledby={cacheBreakTipsId}
                  onChange={(event) => onCacheBreakTipsEnabledChange(event.target.checked)}
                />
                <span className="composer-switch-track" aria-hidden />
              </label>
            </div>
          </li>
        </ul>
      </section>

      <section className="settings-section">
        <div className="settings-section-head">
          <div>
            <span className="settings-section-label">{t("settings.notifications")}</span>
          </div>
        </div>

        <ul className="settings-rows">
          <li>
            <label className="notification-settings-row" htmlFor={turnSelectId}>
              <span className="settings-row-main">
                <strong>{t("settings.notifications.turnCompletion")}</strong>
                <small>{t("settings.notifications.turnCompletionHint")}</small>
              </span>
              <span className="notification-settings-select">
                <select
                  id={turnSelectId}
                  value={settings.turnCompletion}
                  disabled={busy}
                  onChange={(event) => {
                    const turnCompletion = event.target.value as TurnCompletionNotifyMode;
                    if (!TURN_COMPLETION_NOTIFY_MODES.includes(turnCompletion)) {
                      return;
                    }
                    void save({ ...settings, turnCompletion });
                  }}
                >
                  {TURN_COMPLETION_NOTIFY_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`settings.notifications.turnCompletion.${mode}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} aria-hidden />
              </span>
            </label>
          </li>

          <li>
            <div className="notification-settings-row">
              <span className="settings-row-main" id={permissionId}>
                <strong>{t("settings.notifications.permission")}</strong>
                <small>{t("settings.notifications.permissionHint")}</small>
              </span>
              <label
                className="composer-switch notification-settings-switch"
                title={t(
                  settings.permissionEnabled
                    ? "composer.enabledNamed"
                    : "composer.disabledNamed",
                  { name: t("settings.notifications.permission") },
                )}
              >
                <input
                  type="checkbox"
                  checked={settings.permissionEnabled}
                  disabled={busy}
                  aria-labelledby={permissionId}
                  onChange={(event) =>
                    void save({ ...settings, permissionEnabled: event.target.checked })
                  }
                />
                <span className="composer-switch-track" aria-hidden />
              </label>
            </div>
          </li>

          <li>
            <div className="notification-settings-row">
              <span className="settings-row-main" id={questionId}>
                <strong>{t("settings.notifications.question")}</strong>
                <small>{t("settings.notifications.questionHint")}</small>
              </span>
              <label
                className="composer-switch notification-settings-switch"
                title={t(
                  settings.questionEnabled
                    ? "composer.enabledNamed"
                    : "composer.disabledNamed",
                  { name: t("settings.notifications.question") },
                )}
              >
                <input
                  type="checkbox"
                  checked={settings.questionEnabled}
                  disabled={busy}
                  aria-labelledby={questionId}
                  onChange={(event) =>
                    void save({ ...settings, questionEnabled: event.target.checked })
                  }
                />
                <span className="composer-switch-track" aria-hidden />
              </label>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
