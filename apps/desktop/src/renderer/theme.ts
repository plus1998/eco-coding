export type AppTheme = "dark" | "light";

export const APP_THEME_STORAGE_KEY = "eco.app-theme";

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light";
}

export function readStoredAppTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(APP_THEME_STORAGE_KEY);
    return isAppTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

export function applyAppTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
}

export function persistAppTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }
  applyAppTheme(theme);
}
