export interface TypographyPreferences {
  uiFontSize: number;
  codeFontSize: number;
}

export const DEFAULT_TYPOGRAPHY_PREFERENCES: TypographyPreferences = {
  uiFontSize: 14,
  codeFontSize: 12,
};

export const UI_FONT_SIZE_RANGE = { min: 11, max: 16 } as const;
export const CODE_FONT_SIZE_RANGE = { min: 8, max: 24 } as const;
export const TYPOGRAPHY_STORAGE_KEY = "eco.typography-preferences";
export const TYPOGRAPHY_CHANGE_EVENT = "eco:typography-change";

function clampFontSize(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

export function normalizeTypographyPreferences(value: unknown): TypographyPreferences {
  const candidate = value && typeof value === "object" ? (value as Partial<TypographyPreferences>) : {};
  return {
    uiFontSize: clampFontSize(
      candidate.uiFontSize,
      UI_FONT_SIZE_RANGE,
      DEFAULT_TYPOGRAPHY_PREFERENCES.uiFontSize,
    ),
    codeFontSize: clampFontSize(
      candidate.codeFontSize,
      CODE_FONT_SIZE_RANGE,
      DEFAULT_TYPOGRAPHY_PREFERENCES.codeFontSize,
    ),
  };
}

export function readStoredTypographyPreferences(): TypographyPreferences {
  try {
    const stored = localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
    return stored
      ? normalizeTypographyPreferences(JSON.parse(stored))
      : { ...DEFAULT_TYPOGRAPHY_PREFERENCES };
  } catch {
    return { ...DEFAULT_TYPOGRAPHY_PREFERENCES };
  }
}

export function applyTypographyPreferences(preferences: TypographyPreferences): void {
  const normalized = normalizeTypographyPreferences(preferences);
  document.documentElement.style.setProperty("--ui-font-size", `${normalized.uiFontSize}px`);
  document.documentElement.style.setProperty("--code-font-size", `${normalized.codeFontSize}px`);
  window.dispatchEvent(
    new CustomEvent<TypographyPreferences>(TYPOGRAPHY_CHANGE_EVENT, { detail: normalized }),
  );
}

export function persistTypographyPreferences(preferences: TypographyPreferences): void {
  const normalized = normalizeTypographyPreferences(preferences);
  try {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // CSS preferences still apply when storage is unavailable.
  }
  applyTypographyPreferences(normalized);
}
