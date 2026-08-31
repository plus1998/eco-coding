import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { composerFloatingViewport } from "./composer-floating";

/** Composer toolbar collapses labels to icons when the composer card or viewport is this narrow. */
export const COMPOSER_ICON_ONLY_MAX_WIDTH_PX = 640;

// Keep in lockstep with MAIN_SHELL_BREAKPOINTS.composerIconOnly
// (activity-workspace-layout.ts). Local re-export avoids a circular renderer import.
const COMPOSER_ICON_ONLY_QUERY = `(max-width: ${COMPOSER_ICON_ONLY_MAX_WIDTH_PX}px)`;

/**
 * Composer card queried by `@container composer-toolbar`.
 * Same node for landing and thread so icon-only does not fork on `codex-main-landing`.
 */
export const COMPOSER_ICON_ONLY_CONTAINER = ".codex-composer-wrap";

/** Prefer the composer card width; fall back to viewport when it is not mounted. */
export function resolveComposerIconOnlyToolbar(input: {
  containerWidth: number | null | undefined;
  viewportMatches: boolean;
}): boolean {
  const containerWidth = input.containerWidth;
  if (typeof containerWidth === "number" && containerWidth > 0) {
    return containerWidth <= COMPOSER_ICON_ONLY_MAX_WIDTH_PX;
  }
  return input.viewportMatches;
}

/** True when composer toolbar collapses labels to icons (composer card or viewport). */
export function useComposerIconOnlyToolbar(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(COMPOSER_ICON_ONLY_QUERY).matches : false,
  );

  useEffect(() => {
    const media = window.matchMedia(COMPOSER_ICON_ONLY_QUERY);
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let observed: Element | null = null;

    const readContainerWidth = (): number | null => {
      const container = document.querySelector(COMPOSER_ICON_ONLY_CONTAINER);
      if (!(container instanceof HTMLElement)) {
        return null;
      }
      const width = container.clientWidth;
      return width > 0 ? width : null;
    };

    const ensureObserver = () => {
      const container = document.querySelector(COMPOSER_ICON_ONLY_CONTAINER);
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
          containerWidth: readContainerWidth(),
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

/** Matches `.composer-hover-tooltip { max-width: min(280px, ...) }`. */
const HOVER_TOOLTIP_MAX_HALF_WIDTH = 140;

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
    const viewport = composerFloatingViewport();
    const center = rect.left + rect.width / 2;
    const clampedCenter = Math.max(
      viewport.left + HOVER_TOOLTIP_MAX_HALF_WIDTH,
      Math.min(center, viewport.right - HOVER_TOOLTIP_MAX_HALF_WIDTH),
    );
    setPos({
      top: rect.top - 8,
      left: clampedCenter,
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
