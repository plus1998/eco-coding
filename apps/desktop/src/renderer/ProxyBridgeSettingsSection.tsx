import { useEffect, useState } from "react";
import type { ProxyBridgeSettingsSnapshot } from "../shared/ipc";

interface ProxyBridgeSettingsSectionProps {
  settings: ProxyBridgeSettingsSnapshot;
  disabled?: boolean | undefined;
  onSave: (settings: ProxyBridgeSettingsSnapshot) => void;
}

export function ProxyBridgeSettingsSection({ settings, disabled, onSave }: ProxyBridgeSettingsSectionProps) {
  const [draft, setDraft] = useState(settings.upstreamUserAgent ?? "");

  useEffect(() => {
    setDraft(settings.upstreamUserAgent ?? "");
  }, [settings.upstreamUserAgent]);

  function commitDraft() {
    const trimmed = draft.trim();
    const next: ProxyBridgeSettingsSnapshot = trimmed ? { upstreamUserAgent: trimmed } : {};
    if (next.upstreamUserAgent === settings.upstreamUserAgent) {
      return;
    }
    if (!trimmed && !settings.upstreamUserAgent) {
      return;
    }
    onSave(next);
  }

  return (
    <section className="mcp-list-section models-proxy-bridge-section">
      <header className="models-section-header">
        <div className="models-section-intro">
          <h2 className="models-section-title">代理桥</h2>
          <p className="models-section-desc">
            控制本地模型代理转发到上游 API 时使用的请求头标识。留空时默认透传 Claude SDK
            请求头；填写后所有代理桥上游请求将固定使用该值。
          </p>
        </div>
      </header>
      <label className="mcp-field">
        <span className="mcp-field-label">上游请求头标识</span>
        <input
          className="mcp-field-input"
          value={draft}
          placeholder="留空以透传 SDK"
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commitDraft()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="mcp-field-hint">失焦后自动保存。Provider 连通性测试仅在填写此项时附带该标识。</span>
      </label>
    </section>
  );
}
