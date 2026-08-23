export interface TokenSpeedPreferences {
  showTokenSpeed: boolean;
}

export const DEFAULT_TOKEN_SPEED_PREFERENCES: TokenSpeedPreferences = {
  showTokenSpeed: false,
};

export const TOKEN_SPEED_STORAGE_KEY = "eco.token-speed-preferences";
export const TOKEN_SPEED_CHANGE_EVENT = "eco:token-speed-change";

export function normalizeTokenSpeedPreferences(value: unknown): TokenSpeedPreferences {
  const candidate = value && typeof value === "object" ? (value as Partial<TokenSpeedPreferences>) : {};
  return {
    showTokenSpeed:
      typeof candidate.showTokenSpeed === "boolean"
        ? candidate.showTokenSpeed
        : DEFAULT_TOKEN_SPEED_PREFERENCES.showTokenSpeed,
  };
}

export function readStoredTokenSpeedPreferences(): TokenSpeedPreferences {
  try {
    const stored = localStorage.getItem(TOKEN_SPEED_STORAGE_KEY);
    return stored
      ? normalizeTokenSpeedPreferences(JSON.parse(stored))
      : { ...DEFAULT_TOKEN_SPEED_PREFERENCES };
  } catch {
    return { ...DEFAULT_TOKEN_SPEED_PREFERENCES };
  }
}

export function persistTokenSpeedPreferences(preferences: TokenSpeedPreferences): void {
  const normalized = normalizeTokenSpeedPreferences(preferences);
  try {
    localStorage.setItem(TOKEN_SPEED_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preference still applies in-memory when storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent<TokenSpeedPreferences>(TOKEN_SPEED_CHANGE_EVENT, { detail: normalized }),
  );
}
