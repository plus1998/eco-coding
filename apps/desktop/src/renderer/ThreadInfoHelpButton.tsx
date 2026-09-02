import { CircleHelp } from "lucide-react";
import { type ReactNode, useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clampComposerFloatingLeft, composerFloatingAvailableWidth } from "./composer-floating";
import { ICON_SIZE, ICON_STROKE } from "./icon-metrics";

const TOOLTIP_MAX_WIDTH = 248;
const VIEWPORT_MARGIN = 8;
const GAP = 8;

interface ThreadInfoHelpButtonProps {
  label: string;
  children: ReactNode;
}

export function ThreadInfoHelpButton({ label, children }: ThreadInfoHelpButtonProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: TOOLTIP_MAX_WIDTH });

  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const width = Math.min(TOOLTIP_MAX_WIDTH, composerFloatingAvailableWidth(VIEWPORT_MARGIN));
    const left = clampComposerFloatingLeft(rect.right - width, width, VIEWPORT_MARGIN);
    setPos({
      top: rect.bottom + GAP,
      left,
      width,
    });
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setVisible(true);
  }, [updatePosition]);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const tooltip =
    visible &&
    createPortal(
      <span
        id={tooltipId}
        className="thread-info-help-tooltip"
        role="tooltip"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          maxWidth: pos.width,
          zIndex: 10000,
          opacity: 1,
          visibility: "visible",
          transform: "none",
        }}
      >
        {children}
      </span>,
      document.body,
    );

  return (
    <>
      <span
        ref={wrapRef}
        className="thread-info-help-wrap"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <button type="button" className="thread-info-help" aria-describedby={tooltipId} aria-label={label}>
          <CircleHelp size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </span>
      {tooltip}
    </>
  );
}
