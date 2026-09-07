import { useEffect, useState } from "react";

/**
 * Token-speed badge display modes:
 * - `hidden`: no badge.
 * - `throughput`: first-token time + overall throughput (output / total latency,
 *   comparable to new-api style request-level throughput).
 * - `detailed`: first-token + throughput + prefill estimate + strict decode rate.
 *   Segments that are unavailable (e.g. prefill under a buffering proxy) are
 *   withheld, degrading gracefully to the throughput view.
 */
export type TokenSpeedDisplayMode = "hidden" | "throughput" | "detailed";

export interface TokenSpeedPreferences {
  mode: TokenSpeedDisplayMode;
}

export const TOKEN_SPEED_DISPLAY_MODES: readonly TokenSpeedDisplayMode[] = [
  "hidden",
  "throughput",
  "detailed",
] as const;

export const DEFAULT_TOKEN_SPEED_PREFERENCES: TokenSpeedPreferences = {
  mode: "hidden",
};

export const TOKEN_SPEED_STORAGE_KEY = "eco.token-speed-preferences";
export const TOKEN_SPEED_CHANGE_EVENT = "eco:token-speed-change";

export function isTokenSpeedDisplayMode(value: unknown): value is TokenSpeedDisplayMode {
  return value === "hidden" || value === "throughput" || value === "detailed";
}

export function normalizeTokenSpeedPreferences(value: unknown): TokenSpeedPreferences {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (isTokenSpeedDisplayMode(candidate.mode)) {
    return { mode: candidate.mode };
  }
  // Migrate the pre-mode boolean: true meant "show full stats", false meant hidden.
  if (typeof candidate.showTokenSpeed === "boolean") {
    return { mode: candidate.showTokenSpeed ? "detailed" : "hidden" };
  }
  return { ...DEFAULT_TOKEN_SPEED_PREFERENCES };
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

/**
 * Reactive display mode: reads the stored preference and follows
 * `TOKEN_SPEED_CHANGE_EVENT` so badges and billing rows update in place.
 */
export function useTokenSpeedDisplayMode(): TokenSpeedDisplayMode {
  const [mode, setMode] = useState<TokenSpeedDisplayMode>(() =>
    readStoredTokenSpeedPreferences().mode,
  );
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<TokenSpeedPreferences>).detail;
      if (detail && isTokenSpeedDisplayMode(detail.mode)) {
        setMode(detail.mode);
      }
    };
    window.addEventListener(TOKEN_SPEED_CHANGE_EVENT, update);
    return () => window.removeEventListener(TOKEN_SPEED_CHANGE_EVENT, update);
  }, []);
  return mode;
}
