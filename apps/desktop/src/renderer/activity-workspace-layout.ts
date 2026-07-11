export type ActivityWorkspaceLayoutMode = "full" | "feed-panel" | "feed-nav" | "feed-only";

export type WorkspacePanelLayoutMode = "floating" | "docked";

export const ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS = {
  feedNav: 860,
  feedPanel: 1_024,
  full: 1_426,
  hysteresis: 48,
} as const;

function thresholdForMode(mode: Exclude<ActivityWorkspaceLayoutMode, "feed-only">): number {
  switch (mode) {
    case "feed-nav":
      return ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS.feedNav;
    case "feed-panel":
      return ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS.feedPanel;
    case "full":
      return ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS.full;
  }
}

function modeRank(mode: ActivityWorkspaceLayoutMode): number {
  switch (mode) {
    case "feed-only":
      return 0;
    case "feed-nav":
      return 1;
    case "feed-panel":
      return 2;
    case "full":
      return 3;
  }
}

function crossesThreshold(
  width: number,
  target: Exclude<ActivityWorkspaceLayoutMode, "feed-only">,
  current: ActivityWorkspaceLayoutMode,
): boolean {
  const threshold = thresholdForMode(target);
  const retainingTargetOrWider = modeRank(current) >= modeRank(target);
  return (
    width >=
    threshold +
      (retainingTargetOrWider
        ? -ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS.hysteresis
        : ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS.hysteresis)
  );
}

export function resolveActivityWorkspaceLayoutMode(
  width: number,
  current: ActivityWorkspaceLayoutMode,
): ActivityWorkspaceLayoutMode {
  if (!Number.isFinite(width) || width <= 0) {
    return "feed-only";
  }
  if (crossesThreshold(width, "full", current)) {
    return "full";
  }
  if (crossesThreshold(width, "feed-panel", current)) {
    return "feed-panel";
  }
  if (crossesThreshold(width, "feed-nav", current)) {
    return "feed-nav";
  }
  return "feed-only";
}

export function workspacePanelLayoutForMode(mode: ActivityWorkspaceLayoutMode): WorkspacePanelLayoutMode {
  return mode === "feed-panel" ? "docked" : "floating";
}

export function shouldAutoOpenWorkspacePanel(mode: ActivityWorkspaceLayoutMode): boolean {
  return mode === "full" || mode === "feed-panel";
}

export function shouldShowActivityMessageNav(
  mode: ActivityWorkspaceLayoutMode,
  userMessageCount: number,
): boolean {
  return userMessageCount >= 3 && (mode === "full" || mode === "feed-nav");
}
