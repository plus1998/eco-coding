import { ChevronDown, Plug } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sanitizeMcpServerName } from "../shared/mcp";
import type { McpServerConfigView } from "../shared/ipc";
import type { McpServersEnabledSettings } from "../shared/thread-runtime-config";
import { countEnabledMcpServers } from "../shared/composer-mcp";
import { composerFloatingStyleForAnchor } from "./composer-floating";
import { COMPOSER_TOOLBAR_ICON_PX, COMPOSER_TOOLBAR_ICON_STROKE } from "./composer-icon-metrics";

interface ComposerMcpServersProps {
  servers: readonly McpServerConfigView[];
  enabledSettings: McpServersEnabledSettings;
  canEdit: boolean;
  saving?: boolean | undefined;
  compact?: boolean | undefined;
  onToggleServer?: (serverKey: string, enabled: boolean) => void;
}

export function ComposerMcpServers({
  servers,
  enabledSettings,
  canEdit,
  saving,
  compact,
  onToggleServer,
}: ComposerMcpServersProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const enabledServers = servers.filter((server) => server.enabled && server.name.trim());
  const enabledCount = countEnabledMcpServers(enabledSettings);
  const summary =
    enabledServers.length > 0 ? `${enabledCount}/${enabledServers.length}` : "0";

  const updatePanelPosition = useCallback(() => {
    const anchor = triggerRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(
      composerFloatingStyleForAnchor(anchor, {
        width: 320,
        minHeight: 120,
        prefer: "above",
      }),
    );
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      closePanel();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePanel();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePanel, open]);

  if (enabledServers.length === 0) {
    return null;
  }

  const popover =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className="composer-codex-popover composer-agents-popover"
        role="dialog"
        aria-label="MCP 服务器"
        style={panelStyle}
      >
        <div className="composer-agents-popover-header">
          <span>MCP 服务器</span>
          <span>{summary}</span>
        </div>
        <div className="composer-agents-list">
          {enabledServers.map((server) => {
            const serverKey = sanitizeMcpServerName(server.name);
            const enabled = enabledSettings[serverKey] ?? false;
            const clickable = Boolean(canEdit && onToggleServer);
            const className = [
              "composer-agent-row",
              enabled ? "is-active" : "is-disabled",
              clickable ? "is-clickable" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const content = (
              <>
                <span className="composer-agent-row-main">
                  <span className="composer-agent-row-role">{server.name}</span>
                  <span className="composer-agent-row-model">{server.transport}</span>
                </span>
                <span
                  className={
                    clickable ? "composer-agent-row-meta is-actionable" : "composer-agent-row-meta"
                  }
                >
                  <span className="composer-agent-row-status">{enabled ? "启用" : "停用"}</span>
                  {clickable ? (
                    <span className="composer-agent-row-action">{enabled ? "点击停用" : "点击启用"}</span>
                  ) : null}
                </span>
              </>
            );
            if (clickable) {
              return (
                <button
                  key={server.id}
                  type="button"
                  className={className}
                  title={enabled ? `${server.name} · 点击停用` : `${server.name} · 点击启用`}
                  disabled={saving}
                  aria-pressed={enabled}
                  onClick={() => onToggleServer?.(serverKey, !enabled)}
                >
                  {content}
                </button>
              );
            }
            return (
              <span key={server.id} className={className} title={server.name}>
                {content}
              </span>
            );
          })}
        </div>
      </div>,
      document.body,
    );

  return (
    <span className="composer-agents-control">
      <button
        ref={triggerRef}
        type="button"
        className={[
          "composer-context-trigger",
          "composer-agents-trigger",
          compact ? "is-compact" : "",
          open ? "is-active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={`配置 MCP 服务器，已启用 ${summary}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closePanel();
            return;
          }
          updatePanelPosition();
          setOpen(true);
        }}
      >
        <Plug size={COMPOSER_TOOLBAR_ICON_PX} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} aria-hidden className="composer-context-trigger-icon" />
        <span className="composer-context-trigger-label">{compact ? summary : "MCP"}</span>
        <ChevronDown size={14} aria-hidden className="composer-trigger-chevron" />
      </button>
      {popover}
    </span>
  );
}
