import { Check, ChevronDown, ClipboardList } from "lucide-react";
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
import { PLAN_MODE_UI, planModeUi } from "../shared/plan-mode-ui";

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
  planModeEnabled: boolean;
  canEdit: boolean;
  saving?: boolean | undefined;
  onToggle: (planModeEnabled: boolean) => void;
}

export function ComposerPlanModeToggle({
  planModeEnabled,
  canEdit,
  saving,
  onToggle,
}: ComposerPlanModeToggleProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>(() => ({ visibility: "hidden" }));

  const clickable = canEdit && !saving;
  const current = planModeUi(planModeEnabled);
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

  function selectMode(enabled: boolean) {
    if (enabled !== planModeEnabled) {
      onToggle(enabled);
    }
    setOpen(false);
  }

  const control = clickable ? (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      disabled={saving}
      aria-pressed={planModeEnabled}
      aria-label={current.title}
      aria-expanded={open}
      onClick={() => setOpen((currentOpen) => !currentOpen)}
    >
      <ClipboardList size={15} aria-hidden className="composer-toolbar-trigger-icon" />
      <span className="composer-toolbar-trigger-label">{current.toolbarTitle}</span>
      <ChevronDown size={14} aria-hidden className="composer-trigger-chevron" />
    </button>
  ) : (
    <span className={className} title="当前对话进行中，计划模式不可修改">
      <ClipboardList size={15} aria-hidden className="composer-toolbar-trigger-icon" />
      <span className="composer-toolbar-trigger-label">{current.toolbarTitle}</span>
    </span>
  );

  return (
    <>
      <span className="composer-orchestration-wrap">{control}</span>
      {open && clickable ? (
        <ComposerPlanModePopover
          panelRef={panelRef}
          panelStyle={panelStyle}
          planModeEnabled={planModeEnabled}
          disabled={Boolean(saving)}
          onSelect={selectMode}
        />
      ) : null}
    </>
  );
}

function ComposerPlanModePopover({
  panelRef,
  panelStyle,
  planModeEnabled,
  disabled,
  onSelect,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  panelStyle: CSSProperties;
  planModeEnabled: boolean;
  disabled: boolean;
  onSelect: (enabled: boolean) => void;
}) {
  return createPortal(
    <div
      ref={panelRef}
      className="composer-codex-popover composer-plan-mode-popover"
      role="dialog"
      aria-label="计划模式"
      style={panelStyle}
    >
      <header className="composer-codex-popover-header">
        <p className="composer-codex-popover-title">计划模式</p>
      </header>
      <ul className="composer-codex-popover-list">
        {PLAN_MODE_UI.map((option) => (
          <li key={String(option.value)}>
            <button
              type="button"
              className={
                option.value === planModeEnabled
                  ? "composer-codex-popover-item active"
                  : "composer-codex-popover-item"
              }
              disabled={disabled}
              onClick={() => onSelect(option.value)}
            >
              <span className="composer-codex-popover-body">
                <span className="composer-codex-popover-item-title">{option.title}</span>
                <span className="composer-codex-popover-item-desc">{option.description}</span>
              </span>
              {option.value === planModeEnabled ? (
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
