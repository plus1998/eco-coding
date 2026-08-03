import { Check, Infinity, List, MessageCircle } from "lucide-react";
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
import type { SessionMode } from "../shared/session-mode";
import { SESSION_MODE_UI, sessionModeUi } from "../shared/session-mode-ui";
import {
  COMPOSER_TOOLBAR_ICON_STROKE,
  sessionModeIconPx,
} from "./composer-icon-metrics";

const POPOVER_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;
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

interface ComposerPlanModeToggleProps {
  sessionMode: SessionMode;
  canEdit: boolean;
  saving?: boolean | undefined;
  onSelect: (sessionMode: SessionMode) => void;
}

export function ComposerPlanModeToggle({
  sessionMode,
  canEdit,
  saving,
  onSelect,
}: ComposerPlanModeToggleProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const clickable = canEdit && !saving;
  const current = sessionModeUi(sessionMode);
  const className = ["composer-toolbar-trigger", clickable ? "is-clickable" : "", open ? "is-active" : ""]
    .filter(Boolean)
    .join(" ");

  const updatePanelPosition = useCallback(() => {
    const anchor = buttonRef.current;
    if (!anchor) {
      return;
    }
    setPanelStyle(popoverStyleForAnchor(anchor));
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
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function selectMode(mode: SessionMode) {
    if (mode !== sessionMode) {
      onSelect(mode);
    }
    setOpen(false);
  }

  const control = clickable ? (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      disabled={saving}
      title={current.title}
      aria-label={current.title}
      aria-expanded={open}
      onClick={() => setOpen((currentOpen) => !currentOpen)}
    >
      <SessionModeIcon mode={sessionMode} className="composer-toolbar-trigger-icon" />
      <span className="composer-toolbar-trigger-label">{current.title}</span>
    </button>
  ) : (
    <span className={className} title="当前对话进行中，工作模式不可修改">
      <SessionModeIcon mode={sessionMode} className="composer-toolbar-trigger-icon" />
      <span className="composer-toolbar-trigger-label">{current.title}</span>
    </span>
  );

  return (
    <>
      <span className="composer-orchestration-wrap">{control}</span>
      {open && clickable ? (
        <ComposerSessionModePopover
          panelRef={panelRef}
          panelStyle={panelStyle}
          sessionMode={sessionMode}
          disabled={Boolean(saving)}
          onSelect={selectMode}
        />
      ) : null}
    </>
  );
}

function ComposerSessionModePopover({
  panelRef,
  panelStyle,
  sessionMode,
  disabled,
  onSelect,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  panelStyle: CSSProperties;
  sessionMode: SessionMode;
  disabled: boolean;
  onSelect: (mode: SessionMode) => void;
}) {
  return createPortal(
    <div
      ref={panelRef}
      className="composer-codex-popover composer-plan-mode-popover"
      role="dialog"
      aria-label="想以何种方式工作？"
      style={panelStyle}
    >
      <header className="composer-codex-popover-header">
        <p className="composer-codex-popover-title">想以何种方式工作？</p>
      </header>
      <ul className="composer-codex-popover-list">
        {SESSION_MODE_UI.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              className={
                option.value === sessionMode
                  ? "composer-codex-popover-item active"
                  : "composer-codex-popover-item"
              }
              disabled={disabled}
              aria-pressed={option.value === sessionMode}
              onClick={() => onSelect(option.value)}
            >
              <span className="composer-plan-mode-popover-icon" aria-hidden>
                <SessionModeIcon mode={option.value} />
              </span>
              <span className="composer-codex-popover-body">
                <span className="composer-codex-popover-item-title">{option.title}</span>
                <span className="composer-codex-popover-item-desc">{option.description}</span>
              </span>
              <span
                className={
                  option.value === sessionMode
                    ? "composer-codex-popover-check"
                    : "composer-codex-popover-check is-placeholder"
                }
                aria-hidden
              >
                <Check size={14} strokeWidth={2.25} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

export function SessionModeIcon({
  mode,
  className,
}: {
  mode: SessionMode;
  className?: string;
}) {
  const iconSize = sessionModeIconPx(mode);
  if (mode === "plan") {
    return <List size={iconSize} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} aria-hidden className={className} />;
  }
  if (mode === "ask") {
    return (
      <MessageCircle size={iconSize} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} aria-hidden className={className} />
    );
  }
  return <Infinity size={iconSize} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} aria-hidden className={className} />;
}
