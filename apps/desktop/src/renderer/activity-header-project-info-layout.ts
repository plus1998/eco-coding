/** Pure layout helpers for the activity-header project info popover (no React DOM deps). */

export const ACTIVITY_HEADER_PROJECT_INFO_POPOVER_WIDTH = 300;
export const ACTIVITY_HEADER_PROJECT_INFO_VIEWPORT_MARGIN = 8;
export const ACTIVITY_HEADER_PROJECT_INFO_ANCHOR_GAP = 6;
/** Keep above macOS window chrome z-index (2147483647 is MAX_SAFE for that layer). */
export const ACTIVITY_HEADER_PROJECT_INFO_POPOVER_Z_INDEX = 2_000_000_000;

export interface ActivityHeaderProjectInfoPopoverBox {
  position: "fixed";
  top: number;
  left: number;
  width: number;
  zIndex: number;
  visibility: "visible";
  opacity: number;
}

export interface ActivityHeaderProjectInfoAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export function activityHeaderProjectInfoPopoverBoxForRect(
  rect: ActivityHeaderProjectInfoAnchorRect,
  viewport: { width: number; height: number },
): ActivityHeaderProjectInfoPopoverBox {
  const width = Math.min(
    ACTIVITY_HEADER_PROJECT_INFO_POPOVER_WIDTH,
    Math.max(220, viewport.width - ACTIVITY_HEADER_PROJECT_INFO_VIEWPORT_MARGIN * 2),
  );
  const left = Math.max(
    ACTIVITY_HEADER_PROJECT_INFO_VIEWPORT_MARGIN,
    Math.min(rect.left, viewport.width - ACTIVITY_HEADER_PROJECT_INFO_VIEWPORT_MARGIN - width),
  );
  const top = Math.max(
    ACTIVITY_HEADER_PROJECT_INFO_VIEWPORT_MARGIN,
    rect.bottom + ACTIVITY_HEADER_PROJECT_INFO_ANCHOR_GAP,
  );
  return {
    position: "fixed",
    top,
    left,
    width,
    zIndex: ACTIVITY_HEADER_PROJECT_INFO_POPOVER_Z_INDEX,
    visibility: "visible",
    opacity: 1,
  };
}
