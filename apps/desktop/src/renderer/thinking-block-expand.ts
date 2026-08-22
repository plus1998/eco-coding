/** Hold expanded after stream ends before auto-collapse (ms). */
export const THINKING_COLLAPSE_HOLD_MS = 0;

/** Height fold animation duration (ms); keep in sync with CSS. */
export const THINKING_COLLAPSE_ANIM_MS = 200;

export function resolveThinkingCollapseHoldMs(prefersReducedMotion: boolean): number {
  return prefersReducedMotion ? 0 : THINKING_COLLAPSE_HOLD_MS;
}

export function resolveThinkingExpanded(input: {
  activelyStreaming: boolean;
  settling: boolean;
  manualExpanded: boolean;
}): boolean {
  return input.activelyStreaming || input.settling || input.manualExpanded;
}
