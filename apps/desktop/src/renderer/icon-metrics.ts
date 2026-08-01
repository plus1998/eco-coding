/** Shared Lucide metrics so chrome icons share the same optical weight. */
export const ICON_STROKE = 1.75;

export const ICON_SIZE = {
  /** Badges, compact chrome. */
  xs: 12,
  /** Dense inline actions (copy / reply / tree chevrons). */
  sm: 14,
  /** Default toolbar, list, sidebar, composer. */
  md: 16,
  /** Emphasized chrome / settings rows. */
  lg: 18,
  /** Empty states / picker cards. */
  xl: 20,
} as const;

export type IconSizeToken = keyof typeof ICON_SIZE;

/** @deprecated Prefer ICON_SIZE.md — kept for existing composer imports. */
export const COMPOSER_TOOLBAR_ICON_PX = ICON_SIZE.md;
/** @deprecated Prefer ICON_STROKE */
export const COMPOSER_TOOLBAR_ICON_STROKE = ICON_STROKE;
/** @deprecated Prefer ICON_SIZE.md */
export const COMPOSER_SEND_ICON_PX = ICON_SIZE.md;

/** Session mode glyphs stay one size so agent/plan/ask feel consistent. */
export function sessionModeIconPx(_mode: "agent" | "plan" | "ask"): number {
  return ICON_SIZE.md;
}
