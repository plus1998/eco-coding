import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CenterServerSyncDomain,
  CenterServerSyncDomainResult,
} from "../shared/center-server";
import type { ProxyBridgeSettingsSnapshot } from "../shared/ipc";
import { SettingsSyncControl } from "./SettingsSyncControl";

interface ProxySettingsPanelProps {
  settings: ProxyBridgeSettingsSnapshot;
  busy?: boolean;
  onSave: (settings: ProxyBridgeSettingsSnapshot) => void;
  centerServerSyncVisible?: boolean;
  onSyncDomain?: (
    domain: CenterServerSyncDomain,
    mode: "pull" | "push",
  ) => Promise<CenterServerSyncDomainResult>;
}

export function ProxySettingsPanel({
  settings,
  busy,
  onSave,
  centerServerSyncVisible = false,
  onSyncDomain,
}: ProxySettingsPanelProps) {
  const { t } = useTranslation();
  const enabledId = useId();
  // enabled 缺省视为开启（兼容旧数据）
  const [enabledDraft, setEnabledDraft] = useState(settings.enabled !== false);
  const [proxyDraft, setProxyDraft] = useState(settings.upstreamProxyUrl ?? "");

  useEffect(() => {
    setEnabledDraft(settings.enabled !== false);
  }, [settings.enabled]);

  useEffect(() => {
    setProxyDraft(settings.upstreamProxyUrl ?? "");
  }, [settings.upstreamProxyUrl]);

  const currentEnabled = settings.enabled !== false;
  const dirty =
    enabledDraft !== currentEnabled || proxyDraft.trim() !== (settings.upstreamProxyUrl ?? "");

  function commit() {
    const proxy = proxyDraft.trim();
    if (enabledDraft) {
      // 显式携带 URL（可为空串）：清空输入 = 清除已保存的代理。
      onSave({ enabled: true, upstreamProxyUrl: proxy });
    } else {
      // 关闭开关时保留已保存的 URL，方便重新开启。
      onSave({ enabled: false });
    }
  }

  const syncControl = onSyncDomain ? (
    <SettingsSyncControl
      domain="proxyBridge"
      visible={centerServerSyncVisible}
      disabled={busy === true}
      onSync={onSyncDomain}
    />
  ) : null;

  return (
    <>
      <header className="settings-page-header settings-page-header-with-action">
        <h1>{t("settings.proxy")}</h1>
        {syncControl}
      </header>

      <section className="settings-section proxy-settings-section">
        <ul className="settings-rows">
          <li>
            <div className="notification-settings-row">
              <span className="settings-row-main" id={enabledId}>
                <strong>{t("settings.proxy.enabled")}</strong>
              </span>
              <label
                className="composer-switch notification-settings-switch"
                title={t(enabledDraft ? "composer.enabledNamed" : "composer.disabledNamed", {
                  name: t("settings.proxy.enabled"),
                })}
              >
                <input
                  type="checkbox"
                  checked={enabledDraft}
                  disabled={busy}
                  aria-labelledby={enabledId}
                  onChange={(event) => setEnabledDraft(event.target.checked)}
                />
                <span className="composer-switch-track" aria-hidden />
              </label>
            </div>
          </li>
        </ul>

        <label className="mcp-field">
          <span className="mcp-field-label">{t("settings.proxy.url")}</span>
          <input
            className="mcp-field-input"
            value={proxyDraft}
            placeholder={t("settings.proxy.urlPlaceholder")}
            disabled={busy || !enabledDraft}
            onChange={(event) => setProxyDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </label>

        <div className="git-settings-section-actions">
          <button
            type="button"
            className="mcp-save-button"
            disabled={busy || !dirty}
            onClick={() => void commit()}
          >
            {t("common.save")}
          </button>
        </div>
      </section>
    </>
  );
}
