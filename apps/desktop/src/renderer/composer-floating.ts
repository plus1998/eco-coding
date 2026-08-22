import type { CSSProperties } from "react";

const DEFAULT_MARGIN = 8;
const DEFAULT_GAP = 8;
const MIN_FLOATING_HEIGHT = 48;

/** Panels that can occlude composer popovers portaled to document.body. */
const COMPOSER_FLOATING_RIGHT_OBSTRUCTORS = [
  "#workspace-cards-panel",
  "#task-panel-container",
  ".codex-main-pane > .workspace-panel.is-task-panel-mode",
] as const;

export interface ComposerFloatingOptions {
  width?: number;
  minHeight?: number;
  margin?: number;
  gap?: number;
  prefer?: "above" | "below" | "auto";
  align?: "center" | "start" | "end";
  /** Fixed popover height, clamped to available viewport space. */
  fixedHeight?: number;
}

export interface ComposerFloatingViewport {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface ComposerFloatingObstructorRect {
  left: number;
  width: number;
  height: number;
  visible: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function isVisuallyVisible(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  if (Number.parseFloat(style.opacity) <= 0) {
    return false;
  }
  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }
  return true;
}

function isComposerFloatingObstructor(element: HTMLElement): boolean {
  if (element.id === "workspace-cards-panel" && element.classList.contains("is-open")) {
    return element.getClientRects().length > 0;
  }
  return isVisuallyVisible(element);
}

function readActivityWorkspaceShellRight(margin: number): number | null {
  if (typeof document === "undefined") {
    return null;
  }
  const shell = document.querySelector(".activity-workspace-shell");
  if (!(shell instanceof HTMLElement)) {
    return null;
  }
  const rect = shell.getBoundingClientRect();
  if (rect.width < 160) {
    return null;
  }
  return rect.right - margin;
}

function readDockedWorkspaceCardsReservedRight(windowWidth: number, margin: number): number | null {
  if (typeof document === "undefined") {
    return null;
  }
  const scroll = document.querySelector(".codex-main-scroll.is-workspace-cards-docked");
  if (!(scroll instanceof HTMLElement)) {
    return null;
  }
  const panel = document.querySelector("#workspace-cards-panel");
  if (panel instanceof HTMLElement && isComposerFloatingObstructor(panel)) {
    return null;
  }
  const style = window.getComputedStyle(scroll);
  const panelWidth = Number.parseFloat(style.getPropertyValue("--workspace-cards-panel-width"));
  const panelRight = Number.parseFloat(style.getPropertyValue("--workspace-cards-panel-right"));
  const gap = Number.parseFloat(style.getPropertyValue("--workspace-cards-panel-gap"));
  const reservedWidth =
    (Number.isFinite(panelWidth) ? panelWidth : 300) +
    (Number.isFinite(panelRight) ? panelRight : 0) +
    (Number.isFinite(gap) ? gap : 18);
  if (reservedWidth <= 0) {
    return null;
  }
  return Math.max(margin, windowWidth - reservedWidth - margin);
}

/** Minimum left edge (px) among visible right-side obstructors; falls back to window edge. */
export function resolveComposerFloatingRightBound(input: {
  windowWidth: number;
  obstructors: readonly ComposerFloatingObstructorRect[];
  margin?: number;
  /** Fraction of window width; panels starting left of this are ignored. */
  rightHalfStartRatio?: number;
  /** When set, caps the bound to the main feed column and filters non-overlapping panels. */
  contentRight?: number;
}): number {
  const margin = input.margin ?? DEFAULT_MARGIN;
  const rightHalfStart = input.windowWidth * (input.rightHalfStartRatio ?? 0.35);
  let right = input.windowWidth - margin;

  if (typeof input.contentRight === "number") {
    right = Math.min(right, input.contentRight);
  }

  for (const obstruct of input.obstructors) {
    if (!obstruct.visible || obstruct.width < 8 || obstruct.height < 8) {
      continue;
    }
    const obstructRight = obstruct.left + obstruct.width;
    const overlapsContent =
      typeof input.contentRight !== "number" || obstruct.left < input.contentRight + margin;
    if (!overlapsContent) {
      continue;
    }
    if (obstruct.left >= rightHalfStart || obstructRight > right + margin) {
      right = Math.min(right, obstruct.left - margin);
    }
  }

  return Math.max(margin, right);
}

export function composerFloatingViewport(margin = DEFAULT_MARGIN): ComposerFloatingViewport {
  const obstructors: ComposerFloatingObstructorRect[] = [];
  if (typeof document !== "undefined") {
    for (const selector of COMPOSER_FLOATING_RIGHT_OBSTRUCTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        const rect = node.getBoundingClientRect();
        obstructors.push({
          left: rect.left,
          width: rect.width,
          height: rect.height,
          visible: isComposerFloatingObstructor(node),
        });
      }
    }
  }

  const windowWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const left = margin;
  const contentRight = readActivityWorkspaceShellRight(margin);
  let right = resolveComposerFloatingRightBound({
    windowWidth,
    obstructors,
    margin,
    ...(contentRight !== null ? { contentRight } : {}),
  });
  const dockedReservedRight = readDockedWorkspaceCardsReservedRight(windowWidth, margin);
  if (dockedReservedRight !== null) {
    right = Math.min(right, dockedReservedRight);
  }
  const top = margin;
  const bottom = windowHeight - margin;

  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** viewportWidth arg for cascade placement helpers (right edge + margin). */
export function composerFloatingPlacementViewportWidth(margin = DEFAULT_MARGIN): number {
  return composerFloatingViewport(margin).right + margin;
}

export function clampComposerFloatingLeft(
  rawLeft: number,
  width: number,
  margin = DEFAULT_MARGIN,
): number {
  const viewport = composerFloatingViewport(margin);
  return clamp(rawLeft, viewport.left, viewport.right - width);
}

export function composerFloatingAvailableWidth(margin = DEFAULT_MARGIN, minWidth = 160): number {
  return Math.max(minWidth, composerFloatingViewport(margin).width);
}

export function composerFloatingStyleForAnchor(
  anchor: HTMLElement,
  options: ComposerFloatingOptions = {},
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const margin = options.margin ?? DEFAULT_MARGIN;
  const gap = options.gap ?? DEFAULT_GAP;
  const viewport = composerFloatingViewport(margin);
  const preferredWidth = options.width ?? 280;
  const width = Math.min(preferredWidth, Math.max(160, viewport.width));
  const rawLeft =
    options.align === "start"
      ? rect.left
      : options.align === "end"
        ? rect.right - width
        : rect.left + rect.width / 2 - width / 2;
  const left = clamp(rawLeft, viewport.left, viewport.right - width);
  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const spaceAbove = rect.top - margin - gap;
  const spaceBelow = windowHeight - rect.bottom - margin - gap;
  const minHeight = options.minHeight ?? 96;
  const prefer = options.prefer ?? "auto";
  const placeAbove =
    prefer === "above"
      ? spaceAbove >= minHeight || spaceAbove >= spaceBelow
      : prefer === "below"
        ? !(spaceBelow < minHeight && spaceAbove > spaceBelow)
        : spaceBelow < minHeight && spaceAbove > spaceBelow;
  const availableSpace = Math.max(
    MIN_FLOATING_HEIGHT,
    Math.floor(placeAbove ? spaceAbove : spaceBelow),
  );
  const fixedHeight =
    options.fixedHeight !== undefined
      ? Math.min(Math.max(options.fixedHeight, MIN_FLOATING_HEIGHT), availableSpace)
      : undefined;

  return {
    position: "fixed",
    left,
    width,
    maxWidth: width,
    boxSizing: "border-box",
    maxHeight: fixedHeight ?? availableSpace,
    ...(fixedHeight !== undefined ? { height: fixedHeight } : {}),
    zIndex: 10000,
    ...(placeAbove
      ? { bottom: windowHeight - rect.top + gap }
      : { top: rect.bottom + gap }),
  };
}

/** Reposition open composer popovers when right-side panels resize. */
export function observeComposerFloatingViewport(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  let frame = 0;
  const schedule = () => {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };

  const observer = new ResizeObserver(schedule);
  for (const selector of COMPOSER_FLOATING_RIGHT_OBSTRUCTORS) {
    for (const node of document.querySelectorAll(selector)) {
      if (node instanceof HTMLElement) {
        observer.observe(node);
      }
    }
  }
  const shell = document.querySelector(".activity-workspace-shell");
  if (shell instanceof HTMLElement) {
    observer.observe(shell);
  }
  const dockedScroll = document.querySelector(".codex-main-scroll.is-workspace-cards-docked");
  if (dockedScroll instanceof HTMLElement) {
    observer.observe(dockedScroll);
  }

  window.addEventListener("resize", schedule);
  return () => {
    if (frame) {
      cancelAnimationFrame(frame);
    }
    observer.disconnect();
    window.removeEventListener("resize", schedule);
  };
}
