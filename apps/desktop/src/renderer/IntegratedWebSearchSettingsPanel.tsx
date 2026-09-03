import { useTranslation } from "react-i18next";
import type { CenterServerSyncDomain, CenterServerSyncDomainResult } from "../shared/center-server";
import type {
  IntegratedWebSearchSettingsSaveInput,
  IntegratedWebSearchSettingsSnapshot,
} from "../shared/ipc";
import { IntegratedWebSearchSettingsSection } from "./IntegratedWebSearchSettingsSection";
import { SettingsSyncControl } from "./SettingsSyncControl";

interface IntegratedWebSearchSettingsPanelProps {
  settings: IntegratedWebSearchSettingsSnapshot;
  busy?: boolean | undefined;
  onSave: (input: IntegratedWebSearchSettingsSaveInput) => void;
  centerServerSyncVisible?: boolean;
  onSyncDomain?: (
    domain: CenterServerSyncDomain,
    mode: "pull" | "push",
  ) => Promise<CenterServerSyncDomainResult>;
}

export function IntegratedWebSearchSettingsPanel({
  settings,
  busy,
  onSave,
  centerServerSyncVisible = false,
  onSyncDomain,
}: IntegratedWebSearchSettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <header className="settings-page-header settings-page-header-with-action">
        <div>
          <h1>{t("settings.integratedWebSearch.title")}</h1>
        </div>
        {onSyncDomain ? (
          <SettingsSyncControl
            domain="proxyBridge"
            visible={centerServerSyncVisible}
            disabled={busy}
            onSync={onSyncDomain}
          />
        ) : null}
      </header>

      <IntegratedWebSearchSettingsSection settings={settings} disabled={busy} onSave={onSave} />
    </>
  );
}
