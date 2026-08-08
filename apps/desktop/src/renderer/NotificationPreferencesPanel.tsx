import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type NotificationSettingsSnapshot,
  type TurnCompletionNotifyMode,
  TURN_COMPLETION_NOTIFY_MODES,
} from "../shared/notification-settings";

interface NotificationPreferencesPanelProps {
  settings: NotificationSettingsSnapshot;
  onSave: (settings: NotificationSettingsSnapshot) => Promise<void>;
}

export function NotificationPreferencesPanel({
  settings,
  onSave,
}: NotificationPreferencesPanelProps) {
  const { t } = useTranslation();
  const turnSelectId = useId();
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

  return (
    <div className="notification-preferences">
      <header className="settings-page-header">
        <h1>{t("settings.preferences")}</h1>
      </header>

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
