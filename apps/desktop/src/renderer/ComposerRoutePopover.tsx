import { Check, ChevronDown, ChevronRight, LayoutTemplate, Save, Settings2 } from "lucide-react";
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
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));
  const [listMaxHeight, setListMaxHeight] = useState<number>();
  const profileSummaries = listSelectableAgentProfileSummaries(settings, runtimeConfig);

  const updateListMaxHeight = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      setListMaxHeight(undefined);
      return;
    }
    const items = Array.from(list.children) as HTMLElement[];
    if (items.length === 0) {
      setListMaxHeight(undefined);
      return;
    }
    const visibleCount = Math.min(2, items.length);
    let height = 0;
    for (let index = 0; index < visibleCount; index += 1) {
      height += items[index]!.getBoundingClientRect().height;
    }
    if (visibleCount > 1) {
      const styles = getComputedStyle(list);
      const gap = Number.parseFloat(styles.rowGap || styles.gap || "0") || 0;
      height += gap * (visibleCount - 1);
    }
    setListMaxHeight(Math.ceil(height));
  }, []);

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

  useLayoutEffect(() => {
    if (!open) {
      setListMaxHeight(undefined);
      return;
    }
    updateListMaxHeight();
  }, [open, profileSummaries, updateListMaxHeight]);

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
      className="composer-codex-popover composer-route-popover"
      role="dialog"
      aria-label="切换 Agent Profile"
      style={panelStyle}
    >
      <p className="composer-codex-popover-title">Agent Profile</p>
      <ul
        ref={listRef}
        className="composer-route-popover-list"
        style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
      >
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
  const subagentPreview = summary.enabledAgents.slice(0, 2);
  const hiddenSubagentCount = Math.max(0, summary.enabledAgents.length - subagentPreview.length);
  const riskPreview = summary.highRiskLabels.slice(0, 2);
  const hiddenRiskCount = Math.max(0, summary.highRiskLabels.length - riskPreview.length);
  const modelRows = [
    { key: "main", role: "主 Agent", model: summary.main.modelLabel },
    ...subagentPreview.map((agent) => ({
      key: agent.agentKey,
      role: agent.name,
      model: agent.modelLabel,
    })),
  ];

  return (
    <li>
      <button
        type="button"
        className={selected ? "composer-codex-popover-item active" : "composer-codex-popover-item"}
        disabled={disabled || selected}
        onClick={onSelect}
      >
        <span className="composer-route-profile-card">
          <span className="composer-route-profile-head">
            <span className="composer-route-popover-item-name">{summary.name}</span>
            <span className="composer-route-profile-meta">
              {summary.presetLabel} · {summary.enabledAgents.length} 个子代理
            </span>
          </span>

          <span className="composer-route-profile-models">
            {modelRows.map((row) => (
              <span key={row.key} className="composer-route-profile-model-row">
                <span className="composer-route-profile-model-role">{row.role}</span>
                <span className="composer-route-profile-model-name" title={row.model}>
                  {row.model}
                </span>
              </span>
            ))}
            {hiddenSubagentCount > 0 ? (
              <span className="composer-route-profile-model-row is-more">
                <span className="composer-route-profile-model-role" aria-hidden />
                <span className="composer-route-profile-model-name">
                  +{hiddenSubagentCount} 个子代理
                </span>
              </span>
            ) : null}
          </span>

          {riskPreview.length > 0 ? (
            <span className="composer-route-profile-risks">
              {riskPreview.map((label) => (
                <span key={label} className="composer-route-profile-risk">
                  {label}
                </span>
              ))}
              {hiddenRiskCount > 0 ? (
                <span className="composer-route-profile-risk is-more">+{hiddenRiskCount}</span>
              ) : null}
            </span>
          ) : null}
        </span>

        {selected ? (
          <span className="composer-codex-popover-check" aria-hidden>
            <Check size={14} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function ComposerRoutePopoverTrigger({
  disabled,
  open,
  profileName,
  buttonRef,
  compact,
  onToggle,
}: {
  disabled?: boolean | undefined;
  open: boolean;
  profileName?: string | undefined;
  buttonRef: RefObject<HTMLButtonElement | null>;
  compact?: boolean | undefined;
  onToggle: () => void;
}) {
  const label = profileName?.trim() || "选择方案";

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[
        "composer-context-trigger",
        "composer-route-trigger",
        compact ? "is-compact" : "",
        open ? "is-active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onToggle}
      disabled={disabled}
      title={profileName ? `当前方案：${profileName}` : "切换 Agent Profile"}
      aria-label={profileName ? `当前方案：${profileName}，点击切换` : "切换 Agent Profile"}
      aria-expanded={open}
    >
      <LayoutTemplate size={15} aria-hidden className="composer-context-trigger-icon" />
      <span
        className={
          profileName ? "composer-context-trigger-label" : "composer-context-trigger-label is-placeholder"
        }
      >
        {label}
      </span>
      <ChevronDown size={14} aria-hidden className="composer-trigger-chevron" />
    </button>
  );
}
