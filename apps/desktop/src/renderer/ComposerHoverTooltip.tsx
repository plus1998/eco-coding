import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const COMPOSER_ICON_ONLY_MAX_WIDTH_PX = 600;

// Keep in lockstep with MAIN_SHELL_BREAKPOINTS.composerIconOnly
// (activity-workspace-layout.ts). Local re-export avoids a circular renderer import.
const COMPOSER_ICON_ONLY_QUERY = `(max-width: ${COMPOSER_ICON_ONLY_MAX_WIDTH_PX}px)`;

/** Feed column container queried by `@container codex-main-scroll`. */
const COMPOSER_ICON_ONLY_FEED_CONTAINER =
  ".codex-main:not(.codex-main-landing) .codex-main-scroll-body";

/** Prefer Feed column width; fall back to viewport when Feed is not mounted (e.g. landing). */
export function resolveComposerIconOnlyToolbar(input: {
  feedWidth: number | null | undefined;
  viewportMatches: boolean;
}): boolean {
  const feedWidth = input.feedWidth;
  if (typeof feedWidth === "number" && feedWidth > 0) {
    return feedWidth <= COMPOSER_ICON_ONLY_MAX_WIDTH_PX;
  }
  return input.viewportMatches;
}

/** True when composer toolbar collapses labels to icons (Feed or viewport ≤600px). */
export function useComposerIconOnlyToolbar(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(COMPOSER_ICON_ONLY_QUERY).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(COMPOSER_ICON_ONLY_QUERY);
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let observed: Element | null = null;

    const readFeedWidth = (): number | null => {
      const container = document.querySelector(COMPOSER_ICON_ONLY_FEED_CONTAINER);
      if (!(container instanceof HTMLElement)) {
        return null;
      }
      const width = container.clientWidth;
      return width > 0 ? width : null;
    };

    const ensureObserver = () => {
      const container = document.querySelector(COMPOSER_ICON_ONLY_FEED_CONTAINER);
      if (container === observed) {
        return;
      }
      observer?.disconnect();
      observed = container;
      if (container) {
        observer = new ResizeObserver(() => scheduleUpdate());
        observer.observe(container);
      }
    };

    const update = () => {
      ensureObserver();
      setNarrow(
        resolveComposerIconOnlyToolbar({
          feedWidth: readFeedWidth(),
          viewportMatches: media.matches,
        }),
      );
    };

    const scheduleUpdate = () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    update();
    media.addEventListener("change", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      media.removeEventListener("change", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      observer?.disconnect();
    };
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
  const pointerInsideRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const show = useCallback(() => {
    pointerInsideRef.current = true;
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
    pointerInsideRef.current = false;
    setHovered(false);
  }, []);

  useEffect(() => {
    if (disabled) {
      setHovered(false);
      return;
    }
    if (pointerInsideRef.current && content) {
      show();
    }
  }, [content, disabled, show]);

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
