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

/**
 * Heavy markdown/ProseMirror body must mount immediately for live or
 * user-initiated open. Preference-default expand is deferred until visible.
 */
export function shouldEagerMountThinkingBody(input: {
  activelyStreaming: boolean;
  settling: boolean;
  userExpanded: boolean | null;
}): boolean {
  if (input.activelyStreaming || input.settling) {
    return true;
  }
  return input.userExpanded === true;
}

/** True when open state comes only from the settings default (not live/user). */
export function isThinkingPreferenceDrivenExpand(input: {
  activelyStreaming: boolean;
  settling: boolean;
  userExpanded: boolean | null;
}): boolean {
  return !input.activelyStreaming && !input.settling && input.userExpanded === null;
}

/**
 * Preference-driven mass expand must not flush feed scroll N times.
 * Collapse / live / user toggle keep immediate clamp.
 */
export function resolveThinkingLayoutNotifyOptions(input: {
  displayOpen: boolean;
  preferenceDriven: boolean;
}): { immediate: true } | undefined {
  if (input.displayOpen && input.preferenceDriven) {
    return undefined;
  }
  return { immediate: true };
}

export function findThinkingFeedScrollRoot(from: Element | null): Element | null {
  return from?.closest(".activity-messages") ?? null;
}
