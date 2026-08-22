/**
 * Main-shell layout program (conversation workspace).
 *
 * Width truth:
 * - `mainPane` / activity-workspace width → feed program mode (cards dock/float, auto-open)
 * - `feedColumn` width → message-nav rails (space, not mode whitelist)
 * - viewport media (sidebar/task overlay breakpoints) → shell chrome only until those
 *   move onto a single MainPane observer
 *
 * Action groups:
 * - A (workspace): web chat + workpanel — feed topbar, moves with feed
 * - B (chrome): terminal + task (+ fullscreen slot) — **top-only overlay** on MainPane
 *   (not a full-height column — content/terminal keep full width). Never on settings.
 *   Feed/task topbars reserve strip width only in the top toolbar plane.
 *
 * Cards: feed-panel docks; full floats in gutter on purpose so the ~750 feed is unobstructed.
 */

export type ActivityWorkspaceLayoutMode = "full" | "feed-panel" | "feed-nav" | "feed-only";

export type WorkspacePanelLayoutMode = "floating" | "docked";

/** Task column geometry relative to MainPane grid. */
export type TaskPanelLayoutPhase = "closed" | "open" | "closing" | "fullscreen";

export const ACTIVITY_MESSAGE_NAV = {
  /**
   * Matches `--feed-max-width`. Nav lives in the **left gutter** outside the
   * centered ~750 feed column — column width alone is the wrong signal.
   */
  feedMaxWidth: 750,
  /** Rail (44) + small breathing room before the feed edge. */
  railClearancePx: 56,
  minUserMessages: 3,
  /** Stay visible while gutter shrinks a little past the enter clearance. */
  stayClearancePx: 40,
} as const;

/** Single table of main-shell size tokens (px). */
export const MAIN_SHELL_BREAKPOINTS = {
  /** Viewport: project sidebar becomes overlay and auto-collapses. */
  sidebarOverlay: 900,
  /** Viewport: task panel is a sheet; no fullscreen chrome. */
  taskOverlay: 720,
  /**
   * Approximate feed-column width where left gutter first fits the message-nav rail
   * (`feedMaxWidth + 2 * railClearance`). Prefer {@link shouldShowActivityMessageNav}.
   */
  messageNavMinFeed:
    ACTIVITY_MESSAGE_NAV.feedMaxWidth + 2 * ACTIVITY_MESSAGE_NAV.railClearancePx,
  /** Composer toolbar collapses labels (composer card / viewport). */
  composerIconOnly: 640,
} as const;

/** B-group strip geometry — CSS vars and JS agree on one formula. */
export const PANEL_CHROME_GEOMETRY = {
  buttonPx: 28,
  gapPx: 4,
  /** Closed FS slot: terminal + task. */
  baseButtonCount: 2,
  /** Open FS slot adds one more control to the left of the strip. */
  fullscreenSlotButtons: 1,
} as const;

export function panelChromeButtonsWidthPx(fullscreenSlotOpen: boolean): number {
  const { buttonPx, gapPx, baseButtonCount, fullscreenSlotButtons } = PANEL_CHROME_GEOMETRY;
  const count = baseButtonCount + (fullscreenSlotOpen ? fullscreenSlotButtons : 0);
  return count * buttonPx + Math.max(0, count - 1) * gapPx;
}

/**
 * Docked task column vs feed column. Window resize and panel resize share this
 * floor so both paths shrink gutters first, then the 750 feed card.
 */
export const TASK_PANEL_GEOMETRY = {
  defaultWidth: 480,
  minWidth: 360,
  /** Feed column floor while the task panel occupies a grid column. */
  feedColumnMinWidth: 320,
} as const;

export function taskPanelMaxWidthForPane(paneWidth: number): number {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) {
    return TASK_PANEL_GEOMETRY.minWidth;
  }
  return Math.max(
    TASK_PANEL_GEOMETRY.minWidth,
    Math.floor(paneWidth) - TASK_PANEL_GEOMETRY.feedColumnMinWidth,
  );
}

/** Pane-aware clamp. Omit pane width when persisting / hydrating (CSS still caps). */
export function clampTaskPanelWidth(value: number, paneWidth?: number): number {
  if (!Number.isFinite(value)) {
    return TASK_PANEL_GEOMETRY.defaultWidth;
  }
  const rounded = Math.round(value);
  const min = TASK_PANEL_GEOMETRY.minWidth;
  if (typeof paneWidth === "number" && paneWidth > 0) {
    return Math.min(taskPanelMaxWidthForPane(paneWidth), Math.max(min, rounded));
  }
  return Math.max(min, rounded);
}

export function taskPanelGeometryCssVariables(): Record<string, string> {
  return {
    "--task-panel-min-width": `${TASK_PANEL_GEOMETRY.minWidth}px`,
    "--feed-column-min-width": `${TASK_PANEL_GEOMETRY.feedColumnMinWidth}px`,
  };
}

export const ACTIVITY_WORKSPACE_LAYOUT_THRESHOLDS = {
  /** MainPane: allow "roomy / nav-oriented" program band. */
  feedNav: 860,
  /** MainPane: dock workspace cards (mid width — floating would cover feed). */
  feedPanel: 1_024,
  /**
   * MainPane: float cards in the feed gutters (intentional: centered ~750 feed
   * leaves enough side space without docking).
   */
  full: 1_426,
  hysteresis: 48,
} as const;

/**
 * Free space to the left of the max-width feed stack for a **content-box** width
 * (padding excluded). When the column is narrower than the feed max, full-bleed → 0.
 *
 * Prefer {@link measureFeedColumnLeftGutterPx} at runtime — asymmetric padding and
 * left-aligned feed-panel stacks make width/2 wrong.
 */
export function feedColumnLeftGutterPx(
  feedColumnContentWidth: number,
  feedMaxWidth: number = ACTIVITY_MESSAGE_NAV.feedMaxWidth,
): number {
  if (!Number.isFinite(feedColumnContentWidth) || feedColumnContentWidth <= 0) {
    return 0;
  }
  if (feedColumnContentWidth <= feedMaxWidth) {
    return 0;
  }
  return (feedColumnContentWidth - feedMaxWidth) / 2;
}

/**
 * Actual left gutter: feed-stack left edge minus the scroll-body **content** left.
 * Falls back to a centered content-box estimate when the stack is missing.
 */
export function measureFeedColumnLeftGutterPx(feedColumn: HTMLElement): number {
  const style = getComputedStyle(feedColumn);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const feedStack = feedColumn.querySelector(":scope > .codex-feed-stack");
  if (!(feedStack instanceof HTMLElement)) {
    return feedColumnLeftGutterPx(feedColumn.clientWidth - paddingLeft - paddingRight);
  }
  const columnRect = feedColumn.getBoundingClientRect();
  const feedRect = feedStack.getBoundingClientRect();
  const contentLeft = columnRect.left + feedColumn.clientLeft + paddingLeft;
  return Math.max(0, feedRect.left - contentLeft);
}

/**
 * Message-nav from **measured left gutter** + message count — not feed program mode.
 * Overlaying the feed (no free gutter) counts as “not enough space”.
 *
 * First argument is gutter px (from {@link measureFeedColumnLeftGutterPx} or
 * {@link feedColumnLeftGutterPx}), not raw column width.
 */
export function shouldShowActivityMessageNav(
  leftGutterPx: number,
  userMessageCount: number,
  currentlyVisible = false,
): boolean {
  if (userMessageCount < ACTIVITY_MESSAGE_NAV.minUserMessages) {
    return false;
  }
  if (!Number.isFinite(leftGutterPx) || leftGutterPx < 0) {
    return false;
  }
  if (currentlyVisible) {
    return leftGutterPx >= ACTIVITY_MESSAGE_NAV.stayClearancePx;
  }
  return leftGutterPx >= ACTIVITY_MESSAGE_NAV.railClearancePx;
}


export const MAIN_SHELL_MEDIA_QUERIES = {
  sidebarOverlay: `(max-width: ${MAIN_SHELL_BREAKPOINTS.sidebarOverlay}px)`,
  taskOverlay: `(max-width: ${MAIN_SHELL_BREAKPOINTS.taskOverlay}px)`,
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

/**
 * Feed program from MainPane / activity-workspace width.
 * Does not alone decide message-nav (use {@link shouldShowActivityMessageNav}).
 */
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

/** Only mid `feed-panel` docks; `full` floats in gutters by design. */
export function workspacePanelLayoutForMode(mode: ActivityWorkspaceLayoutMode): WorkspacePanelLayoutMode {
  return mode === "feed-panel" ? "docked" : "floating";
}

export function shouldAutoOpenWorkspacePanel(mode: ActivityWorkspaceLayoutMode): boolean {
  return mode === "full" || mode === "feed-panel";
}

/**
 * B group (ChromeStrip): terminal + task / fullscreen.
 * Never on the settings shell.
 */
export function shouldShowPanelChromeGroupB(options: {
  settingsOpen: boolean;
  showWorkspacePanel: boolean;
}): boolean {
  return Boolean(options.showWorkspacePanel && !options.settingsOpen);
}

/** A group (feed topbar): web chat + workpanel — only outside settings. */
export function shouldShowWorkspaceActionGroupA(options: {
  settingsOpen: boolean;
  showWorkspacePanel: boolean;
}): boolean {
  return Boolean(options.showWorkspacePanel && !options.settingsOpen);
}

/** Derive task phase for MainPane grid classes (single source for layout CSS). */
export function resolveTaskPanelLayoutPhase(options: {
  layoutPresent: boolean;
  exiting: boolean;
  fullscreen: boolean;
}): TaskPanelLayoutPhase {
  if (!options.layoutPresent) {
    return "closed";
  }
  if (options.exiting) {
    return "closing";
  }
  if (options.fullscreen) {
    return "fullscreen";
  }
  return "open";
}

/** Fullscreen control only when task is docked open and not on a narrow sheet. */
export function shouldShowTaskFullscreenChrome(options: {
  phase: TaskPanelLayoutPhase;
  viewportMatchesTaskOverlay: boolean;
}): boolean {
  return options.phase === "open" && !options.viewportMatchesTaskOverlay;
}

/**
 * Fullscreen is panel chrome, not per-page state.
 * Switching or focusing a browser while the panel is already open must keep it.
 */
export function shouldResetTaskPanelFullscreenOnBrowserOpen(panelOpen: boolean): boolean {
  return panelOpen !== true;
}

/**
 * CSS custom properties for the MainPane chrome *overlay* strip (top toolbar only).
 * Content columns ignore this width; only topbar padding uses --panel-chrome-strip-width.
 */
export function panelChromeCssVariables(options: {
  fullscreenSlotOpen: boolean;
}): Record<string, string> {
  const buttons = panelChromeButtonsWidthPx(options.fullscreenSlotOpen);
  return {
    "--panel-chrome-button-size": `${PANEL_CHROME_GEOMETRY.buttonPx}px`,
    "--panel-chrome-gap": `${PANEL_CHROME_GEOMETRY.gapPx}px`,
    "--panel-chrome-buttons-width": `${buttons}px`,
  };
}
