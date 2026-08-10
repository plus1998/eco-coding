import { Blocks, Globe, Image } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type {
  IntegrationAvailabilitySnapshot,
  IntegrationId,
  IntegrationsEnabledSettings,
} from "../shared/integrations";
import { composerFloatingStyleForAnchor } from "./composer-floating";
import { ComposerHoverTooltip } from "./ComposerHoverTooltip";
import { COMPOSER_TOOLBAR_ICON_PX } from "./composer-icon-metrics";

interface Props {
  availability: IntegrationAvailabilitySnapshot;
  enabledSettings: IntegrationsEnabledSettings;
  canEdit: boolean;
  saving?: boolean;
  compact?: boolean;
  onToggle: (id: IntegrationId, enabled: boolean) => void;
}

function IntegrationRows({
  availability,
  enabledSettings,
  canEdit,
  saving,
  onToggle,
}: Props) {
  const { t } = useTranslation();

  return (
    <>
      {availability.integrations.map((item) => {
        const enabled = enabledSettings[item.id] === true;
        const Icon = item.id === "browser" ? Globe : Image;
        const label = t(item.id === "browser" ? "settings.browser" : "settings.imageGeneration.title");
        return (
          <div key={item.id} className="composer-mcp-row">
            <div className="composer-mcp-row-main">
              <span className="composer-mcp-row-leading-icon" aria-hidden>
                <Icon size={16} strokeWidth={1.75} />
              </span>
              <span className="composer-mcp-row-name">{label}</span>
              <span
                className="composer-mcp-row-transport"
                title={
                  item.available
                    ? (item.activeProfileName ?? t("common.enabled"))
                    : (item.reason ?? t("common.disabled"))
                }
              >
                {item.available
                  ? (item.activeProfileName ?? t("common.enabled"))
                  : (item.reason ?? t("common.disabled"))}
              </span>
            </div>
            <label className="composer-switch" title={label}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={!canEdit || saving || !item.available}
                aria-label={label}
                onChange={() => onToggle(item.id, !enabled)}
              />
              <span className="composer-switch-track" aria-hidden />
            </label>
          </div>
        );
      })}
    </>
  );
}

export function ComposerIntegrationsCardBody(props: Props) {
  const { t } = useTranslation();

  if (props.availability.integrations.length === 0) {
    return <p className="floating-workspace-card-empty">{t("composer.integrations.empty")}</p>;
  }

  return (
    <div className="composer-mcp-card-body is-embedded">
      <div className="composer-agents-list">
        <IntegrationRows {...props} />
      </div>
    </div>
  );
}

export function ComposerIntegrations({
  availability,
  enabledSettings,
  canEdit,
  saving,
  compact,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  const enabledCount = availability.integrations.filter((item) => enabledSettings[item.id]).length;

  const position = useCallback(() => {
    if (triggerRef.current) {
      setStyle(composerFloatingStyleForAnchor(triggerRef.current, { width: 300, minHeight: 120, prefer: "above" }));
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const down = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const popover = open
    ? createPortal(
        <div ref={panelRef} className="composer-codex-popover composer-agents-popover" role="dialog" style={style}>
          <div className="composer-agents-popover-header">
            <span>{t("settings.integrations")}</span>
            <span>
              {enabledCount}/{availability.integrations.length}
            </span>
          </div>
          <div className="composer-agents-list">
            <IntegrationRows
              availability={availability}
              enabledSettings={enabledSettings}
              canEdit={canEdit}
              {...(saving !== undefined && { saving })}
              onToggle={onToggle}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <span className="composer-agents-control">
      <ComposerHoverTooltip content={t("settings.integrations")} disabled={open}>
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
          aria-label={t("composer.integrations.configure")}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            position();
            setOpen((value) => !value);
          }}
        >
          <Blocks size={COMPOSER_TOOLBAR_ICON_PX} aria-hidden />
          <span className="composer-context-trigger-label">{enabledCount}</span>
        </button>
      </ComposerHoverTooltip>
      {popover}
    </span>
  );
}
