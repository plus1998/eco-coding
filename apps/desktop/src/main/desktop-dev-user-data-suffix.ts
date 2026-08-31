/** Default dev suffix: `@eco/desktop` → `@eco/desktopDev`. */
export const DEFAULT_DEV_USER_DATA_SUFFIX = "Dev";

const FORBIDDEN_DEV_USER_DATA_SUFFIX = /[\\/:*?"<>|]|\p{Cc}/u;

/**
 * Dev userData directory suffix, overridable via `ECO_DEV_USER_DATA_SUFFIX`.
 * Blank values fall back to {@link DEFAULT_DEV_USER_DATA_SUFFIX}.
 */
export function resolveDevUserDataSuffix(configured?: string): string {
  const trimmed = configured?.trim();
  if (!trimmed) {
    return DEFAULT_DEV_USER_DATA_SUFFIX;
  }
  if (FORBIDDEN_DEV_USER_DATA_SUFFIX.test(trimmed) || trimmed.endsWith(".")) {
    throw new Error(
      `ECO_DEV_USER_DATA_SUFFIX ${JSON.stringify(trimmed)} must be a single path component ` +
        "(no path separator, drive colon, Windows-reserved character, or trailing dot).",
    );
  }
  return trimmed;
}
