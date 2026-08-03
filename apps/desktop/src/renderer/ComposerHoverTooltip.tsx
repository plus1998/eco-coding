import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const COMPOSER_ICON_ONLY_QUERY = "(max-width: 600px)";

/** True when composer toolbar collapses labels to icons (viewport ≤600px). */
export function useComposerIconOnlyToolbar(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(COMPOSER_ICON_ONLY_QUERY).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(COMPOSER_ICON_ONLY_QUERY);
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return narrow;
}

interface ComposerHoverTooltipProps {
  content: string;
  children: ReactNode;
  disabled?: boolean | undefined;
}

/** Lightweight hover tooltip for compact composer toolbar icons. */
export function ComposerHoverTooltip({ content, children, disabled }: ComposerHoverTooltipProps) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const show = useCallback(() => {
    if (disabled || !content) {
      return;
    }
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.top - 8,
      left: rect.left + rect.width / 2,
    });
    setHovered(true);
  }, [content, disabled]);

  const hide = useCallback(() => {
    setHovered(false);
  }, []);

  useEffect(() => {
    if (disabled) {
      setHovered(false);
    }
  }, [disabled]);

  return (
    <>
      <span
        ref={wrapRef}
        className="composer-hover-tooltip-wrap"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {hovered && !disabled && content
        ? createPortal(
            <span
              className="composer-hover-tooltip"
              role="tooltip"
              style={{
                position: "fixed",
                top: pos.top,
                left: pos.left,
                transform: "translate(-50%, -100%)",
              }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
