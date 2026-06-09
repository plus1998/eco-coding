import { Check, ChevronRight, Save, Settings2, SlidersHorizontal } from "lucide-react";
import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ModelSettingsSnapshot, ThreadRuntimeConfig } from "../shared/ipc";
import { type AgentProfileSummary, listSelectableAgentProfileSummaries } from "./agent-profile-summary";

const POPOVER_WIDTH = 420;
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
  runtimeConfig?: ThreadRuntimeConfig | undefined;
  busy?: boolean | undefined;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelectProfile: (profileId: string) => void | Promise<void>;
  onSaveCurrentProfile?: (() => void | Promise<void>) | undefined;
  onOpenFullSettings: () => void;
}

export function ComposerRoutePopover({
  open,
  settings,
  selectedProfileId,
  runtimeConfig,
  busy,
  anchorRef,
  onClose,
  onSelectProfile,
  onSaveCurrentProfile,
  onOpenFullSettings,
}: ComposerRoutePopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const profileSummaries = listSelectableAgentProfileSummaries(settings, runtimeConfig);

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
  }, [open, updatePanelPosition]);

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
      aria-label="切换 Agent Profile"
      style={panelStyle}
    >
      <p className="composer-route-popover-title">Agent Profile</p>
      <ul className="composer-route-popover-list">
        {profileSummaries.map((summary) => (
          <AgentProfileOption
            key={summary.selectionId}
            summary={summary}
            selected={summary.selectionId === selectedProfileId}
            disabled={busy}
            onSelect={() => {
              if (summary.selectionId) {
                void onSelectProfile(summary.selectionId);
              }
            }}
          />
        ))}
      </ul>
      {profileSummaries.length === 0 ? (
        <p className="composer-route-popover-empty">尚未配置可运行的 Agent Profile</p>
      ) : null}
      {onSaveCurrentProfile ? (
        <button
          type="button"
          className="composer-route-popover-settings"
          disabled={busy}
          onClick={() => {
            void onSaveCurrentProfile();
          }}
        >
          <Save size={14} />
          保存当前为 Profile
          <ChevronRight size={14} />
        </button>
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
        打开 Agent Builder
        <ChevronRight size={14} />
      </button>
    </div>,
    document.body,
  );
}

function AgentProfileOption({
  summary,
  selected,
  disabled,
  onSelect,
}: {
  summary: AgentProfileSummary;
  selected: boolean;
  disabled?: boolean | undefined;
  onSelect: () => void;
}) {
  const visibleAgents = summary.enabledAgents.slice(0, 3);
  const extraAgentCount = Math.max(0, summary.enabledAgents.length - visibleAgents.length);
  return (
    <li>
      <button
        type="button"
        className={selected ? "composer-route-popover-item active" : "composer-route-popover-item"}
        disabled={disabled || selected}
        onClick={onSelect}
      >
        <span className="composer-agent-profile-main">
          <span className="composer-route-popover-item-name">{summary.name}</span>
          <span className="composer-agent-profile-meta">
            {summary.presetLabel} · {summary.enabledAgents.length} 个子代理
          </span>
          <span className="composer-agent-profile-model">主 Agent：{summary.main.modelLabel}</span>
          {summary.highRiskLabels.length > 0 ? (
            <span className="composer-agent-profile-risks">
              {summary.highRiskLabels.map((label) => (
                <span key={label} className="composer-agent-profile-risk">
                  {label}
                </span>
              ))}
            </span>
          ) : null}
          {visibleAgents.length > 0 ? (
            <span className="composer-agent-profile-agents">
              {visibleAgents.map((agent) => (
                <span key={agent.agentKey} className="composer-agent-profile-agent">
                  <span>{agent.name}</span>
                  <small>{agent.modelLabel}</small>
                </span>
              ))}
              {extraAgentCount > 0 ? (
                <span className="composer-agent-profile-agent is-extra">+{extraAgentCount}</span>
              ) : null}
            </span>
          ) : null}
        </span>
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
  const label = profileName?.trim() || "选择 Agent Profile";

  return (
    <button
      ref={buttonRef}
      type="button"
      className={
        open ? "composer-meta-pill composer-route-pill is-active" : "composer-meta-pill composer-route-pill"
      }
      onClick={onToggle}
      disabled={disabled}
      title={profileName ? `当前 Agent Profile：${profileName}` : "切换 Agent Profile"}
      aria-label={profileName ? `当前 Agent Profile：${profileName}，点击切换` : "切换 Agent Profile"}
      aria-expanded={open}
    >
      <SlidersHorizontal size={14} aria-hidden className="composer-route-pill-icon" />
      <span className={profileName ? "composer-route-pill-name" : "composer-route-pill-name is-placeholder"}>
        {label}
      </span>
    </button>
  );
}
