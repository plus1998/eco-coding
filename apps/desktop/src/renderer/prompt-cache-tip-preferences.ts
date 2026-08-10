export interface PromptCacheTipPreferences {
  enabled: boolean;
}

export const DEFAULT_PROMPT_CACHE_TIP_PREFERENCES: PromptCacheTipPreferences = {
  enabled: true,
};

export const PROMPT_CACHE_TIP_STORAGE_KEY = "eco.prompt-cache-tip-preferences";

export function normalizePromptCacheTipPreferences(value: unknown): PromptCacheTipPreferences {
  const candidate = value && typeof value === "object" ? (value as Partial<PromptCacheTipPreferences>) : {};
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : DEFAULT_PROMPT_CACHE_TIP_PREFERENCES.enabled,
  };
}

export function readStoredPromptCacheTipPreferences(): PromptCacheTipPreferences {
  try {
    const stored = localStorage.getItem(PROMPT_CACHE_TIP_STORAGE_KEY);
    return stored
      ? normalizePromptCacheTipPreferences(JSON.parse(stored))
      : { ...DEFAULT_PROMPT_CACHE_TIP_PREFERENCES };
  } catch {
    return { ...DEFAULT_PROMPT_CACHE_TIP_PREFERENCES };
  }
}

export function persistPromptCacheTipPreferences(preferences: PromptCacheTipPreferences): void {
  const normalized = normalizePromptCacheTipPreferences(preferences);
  try {
    localStorage.setItem(PROMPT_CACHE_TIP_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preference still applies in-memory when storage is unavailable.
  }
}
