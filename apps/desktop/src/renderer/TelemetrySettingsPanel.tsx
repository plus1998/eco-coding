import { useEffect, useState } from "react";
import type { TelemetrySettingsInput, TelemetrySettingsSnapshot } from "../shared/ipc";

interface TelemetrySettingsPanelProps {
  settings: TelemetrySettingsSnapshot;
  busy?: boolean;
  onSave: (input: TelemetrySettingsInput) => Promise<void>;
}

export function TelemetrySettingsPanel({ settings, busy, onSave }: TelemetrySettingsPanelProps) {
  const [form, setForm] = useState<TelemetrySettingsInput>(settings);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  async function handleSave() {
    setError(undefined);
    setSaved(false);
    try {
      await onSave(form);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <>
      <header className="settings-page-header">
        <h1>Agent 监测</h1>
        <p className="settings-page-desc">
          使用 Claude Agent SDK 官方推荐的 OpenTelemetry 导出。数据由 Claude Code CLI 子进程直接发送到
          OTLP Collector（Jaeger、Grafana、Datadog 等），可在后端查看完整 trace、工具调用耗时与 token 指标。
        </p>
      </header>

      <section className="settings-section">
        <div className="settings-section-head">
          <span className="settings-section-label">OpenTelemetry</span>
        </div>

        <div className="settings-editor-card">
          <form
            className="provider-form telemetry-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <label className="settings-toggle-row">
              <span>启用 OTel 导出</span>
              <input
                type="checkbox"
                className="settings-toggle"
                checked={form.enabled}
                disabled={busy}
                onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
            </label>

            <label>
              OTLP Endpoint
              <input
                type="url"
                value={form.endpoint}
                disabled={busy || !form.enabled}
                placeholder="http://localhost:4318"
                onChange={(event) => setForm((current) => ({ ...current, endpoint: event.target.value }))}
              />
            </label>

            <label>
              Service Name
              <input
                type="text"
                value={form.serviceName}
                disabled={busy || !form.enabled}
                placeholder="eco-coding"
                onChange={(event) => setForm((current) => ({ ...current, serviceName: event.target.value }))}
              />
            </label>

            <label>
              OTLP Headers（可选）
              <input
                type="text"
                value={form.headers ?? ""}
                disabled={busy || !form.enabled}
                placeholder="Authorization=Bearer your-token"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    headers: event.target.value.trim() ? event.target.value : undefined,
                  }))
                }
              />
            </label>

            <label className="settings-toggle-row">
              <span>Traces</span>
              <input
                type="checkbox"
                className="settings-toggle"
                checked={form.traces}
                disabled={busy || !form.enabled}
                onChange={(event) => setForm((current) => ({ ...current, traces: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <span>Metrics</span>
              <input
                type="checkbox"
                className="settings-toggle"
                checked={form.metrics}
                disabled={busy || !form.enabled}
                onChange={(event) => setForm((current) => ({ ...current, metrics: event.target.checked }))}
              />
            </label>

            <label className="settings-toggle-row">
              <span>Log events</span>
              <input
                type="checkbox"
                className="settings-toggle"
                checked={form.logs}
                disabled={busy || !form.enabled}
                onChange={(event) => setForm((current) => ({ ...current, logs: event.target.checked }))}
              />
            </label>

            <label>
              导出间隔（毫秒）
              <input
                type="number"
                min={500}
                step={500}
                value={form.exportIntervalMs}
                disabled={busy || !form.enabled}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    exportIntervalMs: Number(event.target.value) || 1000,
                  }))
                }
              />
            </label>
          </form>

          {form.enabled ? (
            <p className="settings-empty telemetry-hint">
              本地调试：<code>docker run -d --name jaeger -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:latest</code>
              ，浏览器打开 http://localhost:16686 查看 trace。
            </p>
          ) : null}

          {error ? <p className="settings-form-error">{error}</p> : null}
          {saved ? <p className="settings-empty">已保存</p> : null}

          <button type="button" className="settings-primary-button" disabled={busy} onClick={() => void handleSave()}>
            保存
          </button>
        </div>
      </section>
    </>
  );
}
