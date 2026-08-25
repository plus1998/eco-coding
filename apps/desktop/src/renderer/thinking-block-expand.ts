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
  /** Explicit user toggle; `null` means follow `defaultExpanded`. */
  userExpanded: boolean | null;
  /** Preference for completed thinking when the user has not overridden. */
  defaultExpanded: boolean;
}): boolean {
  if (input.activelyStreaming || input.settling) {
    return true;
  }
  if (input.userExpanded !== null) {
    return input.userExpanded;
  }
  return input.defaultExpanded;
}
