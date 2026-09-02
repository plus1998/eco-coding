import { useEffect, useState } from "react";
import type { ProxyBridgeSettingsSnapshot } from "../shared/ipc";

interface ProxyBridgeSettingsSectionProps {
  settings: ProxyBridgeSettingsSnapshot;
  disabled?: boolean | undefined;
  onSave: (settings: ProxyBridgeSettingsSnapshot) => void;
}

export function ProxyBridgeSettingsSection({ settings, disabled, onSave }: ProxyBridgeSettingsSectionProps) {
  const [uaDraft, setUaDraft] = useState(settings.upstreamUserAgent ?? "");
  const [proxyDraft, setProxyDraft] = useState(settings.upstreamProxyUrl ?? "");

  useEffect(() => {
    setUaDraft(settings.upstreamUserAgent ?? "");
  }, [settings.upstreamUserAgent]);

  useEffect(() => {
    setProxyDraft(settings.upstreamProxyUrl ?? "");
  }, [settings.upstreamProxyUrl]);

  function commit() {
    const ua = uaDraft.trim();
    const proxy = proxyDraft.trim();
    const next: ProxyBridgeSettingsSnapshot = {
      ...(ua ? { upstreamUserAgent: ua } : {}),
      ...(proxy ? { upstreamProxyUrl: proxy } : {}),
    };
    if (
      next.upstreamUserAgent === settings.upstreamUserAgent &&
      next.upstreamProxyUrl === settings.upstreamProxyUrl
    ) {
      return;
    }
    if (
      !next.upstreamUserAgent &&
      !next.upstreamProxyUrl &&
      !settings.upstreamUserAgent &&
      !settings.upstreamProxyUrl
    ) {
      return;
    }
    onSave(next);
  }

  return (
    <section className="mcp-list-section models-proxy-bridge-section">
      <label className="mcp-field">
        <span className="mcp-field-label">上游请求头标识</span>
        <input
          className="mcp-field-input"
          value={uaDraft}
          placeholder="留空以透传 SDK"
          disabled={disabled}
          onChange={(event) => setUaDraft(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="mcp-field-hint">
          失焦后自动保存。作用于 Codex / Claude 经 Bridge → Gateway 的上游请求。
        </span>
      </label>
      <label className="mcp-field">
        <span className="mcp-field-label">上游出站代理</span>
        <input
          className="mcp-field-input"
          value={proxyDraft}
          placeholder="例如 socks5://127.0.0.1:7890 或 http://127.0.0.1:8080"
          disabled={disabled}
          onChange={(event) => setProxyDraft(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="mcp-field-hint">
          仅作用于 Gateway 访问上游（http/https/socks5）。留空直连。Codex 不直打上游。
        </span>
      </label>
    </section>
  );
}
