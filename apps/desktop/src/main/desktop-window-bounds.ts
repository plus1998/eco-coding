import type { Rectangle } from "electron";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function centerBoundsInWorkArea(workArea: Rectangle, width: number, height: number): WindowBounds {
  const boundedWidth = Math.min(width, workArea.width);
  const boundedHeight = Math.min(height, workArea.height);
  const x = Math.round(workArea.x + (workArea.width - boundedWidth) / 2);
  const y = Math.round(workArea.y + (workArea.height - boundedHeight) / 2);
  return { x, y, width: boundedWidth, height: boundedHeight };
}
