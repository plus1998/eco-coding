import { Check, ChevronDown, Hand, Shield, ShieldAlert, Terminal } from "lucide-react";
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
import type { BashReviewMode } from "../../../../packages/bash-policy/src";
import { BASH_REVIEW_UI, bashReviewUi } from "../shared/bash-review-ui";
import {
  COMPOSER_TOOLBAR_ICON_PX,
  COMPOSER_TOOLBAR_ICON_STROKE,
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

interface ComposerBashReviewToggleProps {
  bashReviewMode: BashReviewMode;
  canEdit: boolean;
  saving?: boolean | undefined;
  onToggle: (bashReviewMode: BashReviewMode) => void;
}

export function ComposerBashReviewToggle({
  bashReviewMode,
  canEdit,
  saving,
  onToggle,
}: ComposerBashReviewToggleProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const clickable = canEdit && !saving;
  const current = bashReviewUi(bashReviewMode);
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

  function selectMode(mode: BashReviewMode) {
    if (mode !== bashReviewMode) {
      onToggle(mode);
    }
    setOpen(false);
  }

  const control = clickable ? (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      disabled={saving}
      aria-pressed={bashReviewMode !== "allow_all"}
      aria-label={current.title}
      aria-expanded={open}
      onClick={() => setOpen((currentOpen) => !currentOpen)}
    >
      <span className="composer-toolbar-trigger-icon" aria-hidden>
        <BashReviewToolbarIcon mode={bashReviewMode} />
      </span>
      <span className="composer-toolbar-trigger-label">{current.title}</span>
      <ChevronDown size={14} aria-hidden className="composer-trigger-chevron" />
    </button>
  ) : (
    <span className={className} title="Bash 审批模式不可修改">
      <span className="composer-toolbar-trigger-icon" aria-hidden>
        <BashReviewToolbarIcon mode={bashReviewMode} />
      </span>
      <span className="composer-toolbar-trigger-label">{current.title}</span>
    </span>
  );

  return (
    <>
      <span className="composer-orchestration-wrap">{control}</span>
      {open && clickable ? (
        <ComposerBashReviewPopover
          panelRef={panelRef}
          panelStyle={panelStyle}
          bashReviewMode={bashReviewMode}
          disabled={Boolean(saving)}
          onSelect={selectMode}
        />
      ) : null}
    </>
  );
}

function ComposerBashReviewPopover({
  panelRef,
  panelStyle,
  bashReviewMode,
  disabled,
  onSelect,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  panelStyle: CSSProperties;
  bashReviewMode: BashReviewMode;
  disabled: boolean;
  onSelect: (mode: BashReviewMode) => void;
}) {
  return createPortal(
    <div
      ref={panelRef}
      className="composer-codex-popover composer-bash-review-popover"
      role="dialog"
      aria-label="Bash 审批模式"
      style={panelStyle}
    >
      <header className="composer-codex-popover-header">
        <p className="composer-codex-popover-title">应如何批准 Bash 操作？</p>
      </header>
      <ul className="composer-codex-popover-list">
        {BASH_REVIEW_UI.map((option) => (
          <li key={option.value}>
            <button
              type="button"
              className={
                option.value === bashReviewMode
                  ? "composer-codex-popover-item active"
                  : "composer-codex-popover-item"
              }
              disabled={disabled}
              onClick={() => onSelect(option.value)}
            >
              <span className="composer-bash-review-popover-icon" aria-hidden>
                <BashReviewModeIcon mode={option.value} />
              </span>
              <span className="composer-codex-popover-body">
                <span className="composer-codex-popover-item-title">{option.title}</span>
                <span className="composer-codex-popover-item-desc">{option.description}</span>
              </span>
              {option.value === bashReviewMode ? (
                <span className="composer-codex-popover-check" aria-hidden>
                  <Check size={14} strokeWidth={2.25} />
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

function BashReviewToolbarIcon({ mode }: { mode: BashReviewMode }) {
  if (mode === "always") {
    return <Hand size={14} strokeWidth={1.75} />;
  }
  if (mode === "auto") {
    return <Shield size={14} strokeWidth={1.75} />;
  }
  return <ShieldAlert size={14} strokeWidth={1.75} />;
}

function BashReviewModeIcon({ mode }: { mode: BashReviewMode }) {
  if (mode === "always") {
    return <Hand size={COMPOSER_TOOLBAR_ICON_PX} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} />;
  }
  if (mode === "auto") {
    return (
      <span className="composer-bash-review-icon-stack">
        <Shield size={COMPOSER_TOOLBAR_ICON_PX} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} />
        <Terminal size={7} strokeWidth={2.25} className="composer-bash-review-icon-badge" />
      </span>
    );
  }
  return <ShieldAlert size={COMPOSER_TOOLBAR_ICON_PX} strokeWidth={COMPOSER_TOOLBAR_ICON_STROKE} />;
}
