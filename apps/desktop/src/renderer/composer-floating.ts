import type { CSSProperties } from "react";

const DEFAULT_MARGIN = 8;
const DEFAULT_GAP = 8;
const MIN_FLOATING_HEIGHT = 48;

export interface ComposerFloatingOptions {
  width?: number;
  minHeight?: number;
  margin?: number;
  gap?: number;
  prefer?: "above" | "below" | "auto";
  align?: "center" | "start";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function composerFloatingStyleForAnchor(
  anchor: HTMLElement,
  options: ComposerFloatingOptions = {},
): CSSProperties {
  const rect = anchor.getBoundingClientRect();
  const margin = options.margin ?? DEFAULT_MARGIN;
  const gap = options.gap ?? DEFAULT_GAP;
  const preferredWidth = options.width ?? 280;
  const width = Math.min(preferredWidth, Math.max(160, window.innerWidth - margin * 2));
  const rawLeft =
    options.align === "start" ? rect.left : rect.left + rect.width / 2 - width / 2;
  const left = clamp(rawLeft, margin, window.innerWidth - margin - width);
  const spaceAbove = rect.top - margin - gap;
  const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
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

  return {
    position: "fixed",
    left,
    width,
    maxHeight: availableSpace,
    zIndex: 10000,
    ...(placeAbove
      ? { bottom: window.innerHeight - rect.top + gap }
      : { top: rect.bottom + gap }),
  };
}
