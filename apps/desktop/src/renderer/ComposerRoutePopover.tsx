import { Check, ChevronRight, Settings2, SlidersHorizontal } from "lucide-react";
import { type CSSProperties, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ModelSettingsSnapshot, RouteProfileView } from "../shared/ipc";

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;
const MIN_POPOVER_HEIGHT = 120;

function clampPopoverLeft(anchorLeft: number, width: number): number {
  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - width;
  return Math.max(VIEWPORT_MARGIN, Math.min(anchorLeft, maxLeft));
}

function popoverStyleForAnchor(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const spaceAbove = rect.top - VIEWPORT_MARGIN;
  const maxHeight = Math.max(MIN_POPOVER_HEIGHT, spaceAbove - ANCHOR_GAP);
  return {
    position: "fixed",
    left: clampPopoverLeft(rect.left, width),
    bottom: window.innerHeight - rect.top + ANCHOR_GAP,
    width,
    maxHeight,
    zIndex: 10000,
  };
}

interface ComposerRoutePopoverProps {
  open: boolean;
  settings: ModelSettingsSnapshot;
  selectedProfileId?: string | undefined;
  busy?: boolean | undefined;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectProfile: (profileId: string) => void | Promise<void>;
  onOpenFullSettings: () => void;
}

export function ComposerRoutePopover({
  open,
  settings,
  selectedProfileId,
  busy,
  anchorRef,
  onClose,
  onSelectProfile,
  onOpenFullSettings,
}: ComposerRoutePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const updatePanelPosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(popoverStyleForAnchor(anchor));
  }, [anchorRef]);

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
  }, [open, updatePanelPosition, settings.routeProfiles.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, anchorRef]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      ref={panelRef}
      className="composer-route-popover"
      role="dialog"
      aria-label="切换路由方案"
      style={panelStyle}
    >
      <p className="composer-route-popover-title">路由方案</p>
      <ul className="composer-route-popover-list">
        {settings.routeProfiles.map((profile) => (
          <RouteProfileOption
            key={profile.id}
            profile={profile}
            selected={profile.id === selectedProfileId}
            disabled={busy}
            onSelect={() => void onSelectProfile(profile.id)}
          />
        ))}
      </ul>
      {settings.routeProfiles.length === 0 ? (
        <p className="composer-route-popover-empty">尚未配置路由方案</p>
      ) : null}
      <button
        type="button"
        className="composer-route-popover-settings"
        disabled={busy}
        onClick={() => {
          onClose();
          onOpenFullSettings();
        }}
      >
        <Settings2 size={14} />
        打开完整模型设置
        <ChevronRight size={14} />
      </button>
    </div>,
    document.body,
  );
}

function RouteProfileOption({
  profile,
  selected,
  disabled,
  onSelect,
}: {
  profile: RouteProfileView;
  selected: boolean;
  disabled?: boolean | undefined;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={
          selected ? "composer-route-popover-item active" : "composer-route-popover-item"
        }
        disabled={disabled || selected}
        onClick={onSelect}
      >
        <span className="composer-route-popover-item-name">{profile.name}</span>
        {selected ? (
          <span className="composer-route-popover-item-check" aria-hidden>
            <Check size={14} />
            当前
          </span>
        ) : (
          <span className="composer-route-popover-item-hint">切换</span>
        )}
      </button>
    </li>
  );
}

export function ComposerRoutePopoverTrigger({
  disabled,
  open,
  profileName,
  buttonRef,
  onToggle,
}: {
  disabled?: boolean | undefined;
  open: boolean;
  profileName?: string | undefined;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={open ? "composer-settings-link active" : "composer-settings-link"}
      onClick={onToggle}
      disabled={disabled}
      title={profileName ? `当前方案：${profileName}` : "切换路由方案"}
      aria-label="切换路由方案"
      aria-expanded={open}
    >
      <SlidersHorizontal size={16} />
    </button>
  );
}
