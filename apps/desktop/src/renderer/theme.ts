export type AppTheme = "dark" | "light" | "system";

export type ResolvedAppTheme = "dark" | "light";

export const APP_THEME_STORAGE_KEY = "eco.app-theme";

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light" || value === "system";
}

export function readSystemAppTheme(): ResolvedAppTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveAppTheme(preference: AppTheme): ResolvedAppTheme {
  if (preference === "system") {
    return readSystemAppTheme();
  }
  return preference;
}

export function readStoredAppTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppTheme(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyAppThemePreference(preference: AppTheme): ResolvedAppTheme {
  const resolved = resolveAppTheme(preference);
  document.documentElement.dataset.theme = resolved;
  void window.eco?.setAppThemeSource?.(preference).catch(() => {
    // Native theme sync is best-effort; CSS theme still applies in the renderer.
  });
  return resolved;
}

export function persistAppTheme(preference: AppTheme): void {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, preference);
  } catch {
    // ignore quota / private mode
  }
  applyAppThemePreference(preference);
}

export function subscribeToSystemTheme(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => listener();
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}

/** @deprecated Use applyAppThemePreference */
export function applyAppTheme(theme: AppTheme): void {
  applyAppThemePreference(theme);
}
