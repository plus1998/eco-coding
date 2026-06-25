/** Shared optical size for composer footer / context-bar glyphs. */
export const COMPOSER_TOOLBAR_ICON_PX = 16;
export const COMPOSER_TOOLBAR_ICON_STROKE = 1.75;
export const COMPOSER_SEND_ICON_PX = 16;

export function sessionModeIconPx(mode: "agent" | "plan" | "ask"): number {
  if (mode === "agent") {
    return COMPOSER_TOOLBAR_ICON_PX + 1;
  }
  if (mode === "plan" || mode === "ask") {
    return COMPOSER_TOOLBAR_ICON_PX - 1;
  }
  return COMPOSER_TOOLBAR_ICON_PX;
}
