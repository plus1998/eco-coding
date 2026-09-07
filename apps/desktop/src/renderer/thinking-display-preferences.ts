/**
 * Thinking on the Feed has exactly two presentation effects:
 *
 * 1. Tip (`reasoning-stage`) — Summary lifecycle: shimmer label, tip only,
 *    removed when tools/正文 supersede. Used by OpenAI summary always, and by
 *    raw thinking when mode is `ephemeral` (阅后即焚).
 * 2. Card (`thinking`) — Collapsible ThinkingBlock. Used when mode is
 *    `collapsed` / `expanded` (default open state differs).
 *
 * Preference is applied in the projection display pipeline, not by hiding
 * ThinkingBlock after the fact.
 */
export type ThinkingDisplayMode = "ephemeral" | "collapsed" | "expanded";

export interface ThinkingDisplayPreferences {
  mode: ThinkingDisplayMode;
}

export const THINKING_DISPLAY_MODES: readonly ThinkingDisplayMode[] = [
  "ephemeral",
  "collapsed",
  "expanded",
] as const;

export const DEFAULT_THINKING_DISPLAY_PREFERENCES: ThinkingDisplayPreferences = {
  mode: "ephemeral",
};

export const THINKING_DISPLAY_STORAGE_KEY = "eco.thinking-display-preferences";
export const THINKING_DISPLAY_CHANGE_EVENT = "eco:thinking-display-change";

export function isThinkingDisplayMode(value: unknown): value is ThinkingDisplayMode {
  return value === "ephemeral" || value === "collapsed" || value === "expanded";
}

/** Tip path (Summary machinery), not a retained thinking card. */
export function thinkingModeUsesEphemeralTip(mode: ThinkingDisplayMode): boolean {
  return mode === "ephemeral";
}

/** Default expand state when the card path is used. */
export function thinkingModeDefaultExpanded(mode: ThinkingDisplayMode): boolean {
  return mode === "expanded";
}

export function normalizeThinkingDisplayPreferences(value: unknown): ThinkingDisplayPreferences {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (isThinkingDisplayMode(candidate.mode)) {
    return { mode: candidate.mode };
  }
  // Migrate pre-mode boolean: preserve explicit collapsed/expanded; do not map to ephemeral.
  if (typeof candidate.thinkingContentDefaultExpanded === "boolean") {
    return {
      mode: candidate.thinkingContentDefaultExpanded ? "expanded" : "collapsed",
    };
  }
  return { ...DEFAULT_THINKING_DISPLAY_PREFERENCES };
}

export function readStoredThinkingDisplayPreferences(): ThinkingDisplayPreferences {
  try {
    const stored = localStorage.getItem(THINKING_DISPLAY_STORAGE_KEY);
    return stored
      ? normalizeThinkingDisplayPreferences(JSON.parse(stored))
      : { ...DEFAULT_THINKING_DISPLAY_PREFERENCES };
  } catch {
    return { ...DEFAULT_THINKING_DISPLAY_PREFERENCES };
  }
}

export function persistThinkingDisplayPreferences(preferences: ThinkingDisplayPreferences): void {
  const normalized = normalizeThinkingDisplayPreferences(preferences);
  try {
    localStorage.setItem(THINKING_DISPLAY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preference still applies in-memory when storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent<ThinkingDisplayPreferences>(THINKING_DISPLAY_CHANGE_EVENT, {
      detail: normalized,
    }),
  );
}
