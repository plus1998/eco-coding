/** Pure layout helpers for the terminal context menu (no React DOM deps). */

export const TERMINAL_CONTEXT_MENU_WIDTH = 188;
export const TERMINAL_CONTEXT_MENU_VIEWPORT_MARGIN = 8;
/** Above macOS window chrome, matching the other body-portal popovers. */
export const TERMINAL_CONTEXT_MENU_Z_INDEX = 2_000_000_000;

export interface TerminalContextMenuBox {
  position: "fixed";
  top: number;
  left: number;
  width: number;
  zIndex: number;
}

export interface TerminalContextMenuPoint {
  x: number;
  y: number;
}

export interface TerminalContextMenuSize {
  height: number;
}

/**
 * Context menus open at the pointer with their top-left corner under the cursor, then
 * clamp inside the viewport so a right-click near an edge stays fully readable.
 */
export function terminalContextMenuBoxForPoint(
  point: TerminalContextMenuPoint,
  size: TerminalContextMenuSize,
  viewport: { width: number; height: number },
): TerminalContextMenuBox {
  const maxLeft = viewport.width - TERMINAL_CONTEXT_MENU_VIEWPORT_MARGIN - TERMINAL_CONTEXT_MENU_WIDTH;
  const maxTop = viewport.height - TERMINAL_CONTEXT_MENU_VIEWPORT_MARGIN - size.height;
  return {
    position: "fixed",
    left: Math.max(TERMINAL_CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(point.x, maxLeft)),
    top: Math.max(TERMINAL_CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(point.y, maxTop)),
    width: TERMINAL_CONTEXT_MENU_WIDTH,
    zIndex: TERMINAL_CONTEXT_MENU_Z_INDEX,
  };
}
