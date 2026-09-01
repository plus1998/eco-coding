import { screen } from "electron";
import { centerBoundsInWorkArea, type WindowBounds } from "./desktop-window-bounds";

export { centerBoundsInWorkArea, type WindowBounds } from "./desktop-window-bounds";

export function resolveInitialWindowBounds(width: number, height: number): WindowBounds {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return centerBoundsInWorkArea(display.workArea, width, height);
}
