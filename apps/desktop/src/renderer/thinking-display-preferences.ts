export type ThinkingContentDefaultExpanded = boolean;

export interface ThinkingDisplayPreferences {
  /** When true, completed thinking blocks start expanded. Default: collapsed. */
  thinkingContentDefaultExpanded: ThinkingContentDefaultExpanded;
}

export const DEFAULT_THINKING_DISPLAY_PREFERENCES: ThinkingDisplayPreferences = {
  thinkingContentDefaultExpanded: false,
};

export const THINKING_DISPLAY_STORAGE_KEY = "eco.thinking-display-preferences";
export const THINKING_DISPLAY_CHANGE_EVENT = "eco:thinking-display-change";

export function normalizeThinkingDisplayPreferences(value: unknown): ThinkingDisplayPreferences {
  const candidate =
    value && typeof value === "object" ? (value as Partial<ThinkingDisplayPreferences>) : {};
  return {
    thinkingContentDefaultExpanded:
      typeof candidate.thinkingContentDefaultExpanded === "boolean"
        ? candidate.thinkingContentDefaultExpanded
        : DEFAULT_THINKING_DISPLAY_PREFERENCES.thinkingContentDefaultExpanded,
  };
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
