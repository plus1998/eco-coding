import { Check, ChevronRight, Settings2, SlidersHorizontal } from "lucide-react";
import { type RefObject, useEffect, useRef } from "react";
import type { ModelSettingsSnapshot, RouteProfileView } from "../shared/ipc";

interface ComposerRoutePopoverProps {
  open: boolean;
  settings: ModelSettingsSnapshot;
  busy?: boolean | undefined;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectProfile: (profileId: string) => void | Promise<void>;
  onOpenFullSettings: () => void;
}

export function ComposerRoutePopover({
  open,
  settings,
  busy,
  anchorRef,
  onClose,
  onSelectProfile,
  onOpenFullSettings,
}: ComposerRoutePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={panelRef} className="composer-route-popover" role="dialog" aria-label="切换路由方案">
      <p className="composer-route-popover-title">路由方案</p>
      <ul className="composer-route-popover-list">
        {settings.routeProfiles.map((profile) => (
          <RouteProfileOption
            key={profile.id}
            profile={profile}
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
    </div>
  );
}

function RouteProfileOption({
  profile,
  disabled,
  onSelect,
}: {
  profile: RouteProfileView;
  disabled?: boolean | undefined;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={
          profile.isActive
            ? "composer-route-popover-item active"
            : "composer-route-popover-item"
        }
        disabled={disabled || profile.isActive}
        onClick={onSelect}
      >
        <span className="composer-route-popover-item-name">{profile.name}</span>
        {profile.isActive ? (
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
