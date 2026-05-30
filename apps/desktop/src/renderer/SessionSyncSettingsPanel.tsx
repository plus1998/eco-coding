import { Database, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  SessionSyncSettingsInput,
  SessionSyncSettingsView,
} from "../shared/session-sync";

interface SessionSyncSettingsPanelProps {
  settings: SessionSyncSettingsView;
  busy?: boolean;
  onSave: (input: SessionSyncSettingsInput) => Promise<void>;
  onTestConnection: (input: { redisUrl: string; redisPassword?: string }) => Promise<{ ok: boolean; error?: string }>;
}

export function SessionSyncSettingsPanel({
  settings,
  busy,
  onSave,
  onTestConnection,
}: SessionSyncSettingsPanelProps) {
  const [form, setForm] = useState<SessionSyncSettingsInput>(() => viewToInput(settings));
  const [error, setError] = useState<string>();
  const [testMessage, setTestMessage] = useState<string>();
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setForm(viewToInput(settings));
  }, [settings]);

  async function handleSave() {
    setError(undefined);
    setTestMessage(undefined);
    try {
      await onSave(form);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleTestConnection() {
    setError(undefined);
    setTestMessage(undefined);
    setTesting(true);
    try {
      const result = await onTestConnection({
        redisUrl: form.redisUrl,
        ...(form.redisPassword ? { redisPassword: form.redisPassword } : {}),
      });
      if (result.ok) {
        setTestMessage("连接成功，Redis 可用。");
      } else {
        setError(result.error ?? "连接失败。");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <header className="settings-page-header">
        <h1>会话同步</h1>
        <p className="settings-page-desc">
          将会话 transcript 镜像到 Redis，便于多设备 resume 同一 SDK session。启用后 SDK 会关闭本地 file
          checkpointing，改由 SessionStore 持久化。
        </p>
      </header>

      {error && <p className="settings-form-error">{error}</p>}
      {testMessage && <p className="settings-form-success">{testMessage}</p>}

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-label">Redis 远程同步</span>
        </div>

        <div className="settings-editor-card provider-form">
          <label className="settings-toggle-row">
            <span>启用 Redis 同步</span>
            <input
              type="checkbox"
              checked={form.redisEnabled}
              disabled={busy}
              onChange={(event) => setForm((current) => ({ ...current, redisEnabled: event.target.checked }))}
            />
          </label>

          <label>
            <span>Redis URL</span>
            <input
              type="text"
              value={form.redisUrl}
              disabled={busy || !form.redisEnabled}
              placeholder="redis://127.0.0.1:6379"
              onChange={(event) => setForm((current) => ({ ...current, redisUrl: event.target.value }))}
            />
          </label>

          <label>
            <span>密码（可选）</span>
            <input
              type="password"
              value={form.redisPassword ?? ""}
              disabled={busy || !form.redisEnabled}
              placeholder={settings.hasRedisPassword ? "留空则保留已保存的密码" : "无密码可留空"}
              onChange={(event) => setForm((current) => ({ ...current, redisPassword: event.target.value }))}
            />
            {settings.redisPasswordPreview && (
              <small className="settings-field-hint">已保存：{settings.redisPasswordPreview}</small>
            )}
          </label>

          <label>
            <span>Key 前缀</span>
            <input
              type="text"
              value={form.keyPrefix}
              disabled={busy || !form.redisEnabled}
              placeholder="eco-sessions"
              onChange={(event) => setForm((current) => ({ ...current, keyPrefix: event.target.value }))}
            />
          </label>

          <div className="settings-editor-actions">
            <button
              type="button"
              className="settings-secondary-button"
              disabled={busy || testing || !form.redisEnabled || !form.redisUrl.trim()}
              onClick={() => void handleTestConnection()}
            >
              <RefreshCw size={16} />
              测试连接
            </button>
            <button type="button" className="settings-primary-button" disabled={busy} onClick={() => void handleSave()}>
              <Database size={16} />
              保存
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function viewToInput(settings: SessionSyncSettingsView): SessionSyncSettingsInput {
  return {
    redisEnabled: settings.redisEnabled,
    redisUrl: settings.redisUrl,
    keyPrefix: settings.keyPrefix,
    redisPassword: "",
  };
}
