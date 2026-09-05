import { Monitor, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ComputerUseActionApprovalMode,
  ComputerUseSettingsSnapshot,
} from "../shared/computer-use";

interface ComputerUseSettingsPanelProps {
  settings: ComputerUseSettingsSnapshot;
  availability?: { available: boolean; reason?: string };
  onSave: (settings: ComputerUseSettingsSnapshot) => Promise<void>;
  onRunDoctor?: () => Promise<{ ok: boolean; reason?: string; output?: string }>;
}

const ACTION_APPROVAL_OPTIONS: ComputerUseActionApprovalMode[] = ["always_ask", "always_allow"];

export function ComputerUseSettingsPanel({
  settings,
  availability,
  onSave,
  onRunDoctor,
}: ComputerUseSettingsPanelProps) {
  const { t } = useTranslation();
  const switchId = useId();
  const approvalId = useId();
  const [busy, setBusy] = useState(false);
  const [doctorBusy, setDoctorBusy] = useState(false);
  const [doctorMessage, setDoctorMessage] = useState<string | undefined>();

  const unavailable = settings.agentIntegrationEnabled && availability?.available === false;
  const unavailableReason = availability?.reason ?? t("settings.computerUse.agentUnknownReason");

  async function save(next: ComputerUseSettingsSnapshot) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setDoctorMessage(undefined);
    } finally {
      setBusy(false);
    }
  }

  async function runDoctor() {
    if (!onRunDoctor || doctorBusy) {
      return;
    }
    setDoctorBusy(true);
    try {
      const result = await onRunDoctor();
      if (result.ok) {
        setDoctorMessage(t("settings.computerUse.doctorOk"));
      } else {
        setDoctorMessage(result.reason ?? result.output ?? t("settings.computerUse.agentUnknownReason"));
      }
    } catch (error) {
      setDoctorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDoctorBusy(false);
    }
  }

  return (
    <div className="browser-settings">
      <header className="settings-page-header browser-settings-header">
        <h1>{t("settings.computerUse")}</h1>
        <p className="settings-page-desc">{t("settings.computerUse.pageDesc")}</p>
      </header>

      <p className="browser-settings-error" role="note">
        {t("settings.computerUse.sharedDesktopWarning")}
      </p>

      <section className="browser-settings-card browser-settings-master" aria-labelledby={switchId}>
        <div className="browser-settings-master-glyph" aria-hidden>
          <Monitor size={20} strokeWidth={1.75} />
        </div>
        <div className="browser-settings-master-copy" id={switchId}>
          <strong>{t("settings.computerUse.masterTitle")}</strong>
          <small>{t("settings.computerUse.masterHint")}</small>
        </div>
        <label
          className="composer-switch browser-settings-switch"
          title={t(settings.agentIntegrationEnabled ? "composer.enabledNamed" : "composer.disabledNamed", {
            name: t("settings.computerUse.masterTitle"),
          })}
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
          {t("settings.computerUse.statusUnavailable", { reason: unavailableReason })}
        </p>
      ) : null}

      {doctorMessage ? (
        <p className="browser-settings-error" role="status">
          {doctorMessage}
        </p>
      ) : null}

      {onRunDoctor ? (
        <div className="browser-settings-section">
          <button
            type="button"
            className="settings-secondary-button"
            disabled={doctorBusy || busy}
            onClick={() => void runDoctor()}
          >
            {doctorBusy ? t("settings.computerUse.doctorBusy") : t("settings.computerUse.runDoctor")}
          </button>
        </div>
      ) : null}

      {settings.agentIntegrationEnabled ? (
        <section className="browser-settings-section" aria-labelledby={`${approvalId}-heading`}>
          <h2 className="browser-settings-section-title" id={`${approvalId}-heading`}>
            {t("settings.computerUse.permissions")}
          </h2>
          <ul className="browser-settings-group">
            <li className="browser-settings-group-row">
              <span className="browser-settings-group-copy">
                <strong id={approvalId}>{t("settings.computerUse.actionApproval")}</strong>
                <small>{t("settings.computerUse.actionApprovalHint")}</small>
              </span>
              <label className="browser-settings-select">
                <span className="sr-only">{t("settings.computerUse.actionApproval")}</span>
                <select
                  value={settings.actionApprovalMode}
                  disabled={busy}
                  aria-labelledby={approvalId}
                  onChange={(event) =>
                    void save({
                      ...settings,
                      actionApprovalMode: event.target.value as ComputerUseActionApprovalMode,
                    })
                  }
                >
                  {ACTION_APPROVAL_OPTIONS.map((mode) => (
                    <option key={mode} value={mode}>
                      {t(`settings.computerUse.actionApproval.${mode}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="browser-settings-select-chevron"
                />
              </label>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
