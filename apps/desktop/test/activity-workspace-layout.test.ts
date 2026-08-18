import { expect, test } from "bun:test";
import {
  ACTIVITY_MESSAGE_NAV,
  MAIN_SHELL_BREAKPOINTS,
  MAIN_SHELL_MEDIA_QUERIES,
  TASK_PANEL_GEOMETRY,
  clampTaskPanelWidth,
  feedColumnLeftGutterPx,
  panelChromeButtonsWidthPx,
  panelChromeCssVariables,
  PANEL_CHROME_GEOMETRY,
  resolveActivityWorkspaceLayoutMode,
  resolveTaskPanelLayoutPhase,
  shouldAutoOpenWorkspacePanel,
  shouldResetTaskPanelFullscreenOnBrowserOpen,
  shouldShowActivityMessageNav,
  shouldShowPanelChromeGroupB,
  shouldShowTaskFullscreenChrome,
  shouldShowWorkspaceActionGroupA,
  taskPanelGeometryCssVariables,
  taskPanelMaxWidthForPane,
  workspacePanelLayoutForMode,
} from "../src/renderer/activity-workspace-layout";

test("resolveActivityWorkspaceLayoutMode maps the four available-width scenarios", () => {
  expect(resolveActivityWorkspaceLayoutMode(700, "feed-only")).toBe("feed-only");
  expect(resolveActivityWorkspaceLayoutMode(920, "feed-only")).toBe("feed-nav");
  expect(resolveActivityWorkspaceLayoutMode(1_120, "feed-nav")).toBe("feed-panel");
  expect(resolveActivityWorkspaceLayoutMode(1_520, "feed-panel")).toBe("full");
});

test("resolveActivityWorkspaceLayoutMode retains modes inside resize hysteresis", () => {
  expect(resolveActivityWorkspaceLayoutMode(1_400, "full")).toBe("full");
  expect(resolveActivityWorkspaceLayoutMode(1_040, "feed-panel")).toBe("feed-panel");
  expect(resolveActivityWorkspaceLayoutMode(830, "feed-nav")).toBe("feed-nav");
});

test("workspace panel docks only in feed-panel mode (full floats in gutters on purpose)", () => {
  expect(workspacePanelLayoutForMode("feed-only")).toBe("floating");
  expect(workspacePanelLayoutForMode("feed-nav")).toBe("floating");
  expect(workspacePanelLayoutForMode("feed-panel")).toBe("docked");
  expect(workspacePanelLayoutForMode("full")).toBe("floating");
  expect(shouldAutoOpenWorkspacePanel("feed-nav")).toBe(false);
  expect(shouldAutoOpenWorkspacePanel("feed-panel")).toBe(true);
  expect(shouldAutoOpenWorkspacePanel("full")).toBe(true);
});

test("message navigation needs free left gutter outside the ~750 feed stack", () => {
  const max = ACTIVITY_MESSAGE_NAV.feedMaxWidth;
  const enter = ACTIVITY_MESSAGE_NAV.railClearancePx;
  const stay = ACTIVITY_MESSAGE_NAV.stayClearancePx;

  // Too few messages
  expect(shouldShowActivityMessageNav(max + 2 * enter + 10, 2)).toBe(false);

  // Full-bleed column (no gutter) — never show (overlays feed).
  expect(shouldShowActivityMessageNav(max - 20, 4)).toBe(false);
  expect(shouldShowActivityMessageNav(max, 4)).toBe(false);
  expect(feedColumnLeftGutterPx(max)).toBe(0);
  expect(feedColumnLeftGutterPx(max - 40)).toBe(0);

  // Enter when left gutter >= railClearance (column = max + 2*enter).
  const enterWidth = max + 2 * enter;
  expect(feedColumnLeftGutterPx(enterWidth)).toBe(enter);
  expect(shouldShowActivityMessageNav(enterWidth, 3)).toBe(true);
  expect(shouldShowActivityMessageNav(enterWidth - 2, 4)).toBe(false);

  // Hysteresis: stay until gutter falls below stayClearance.
  const stayWidth = max + 2 * stay;
  expect(shouldShowActivityMessageNav(stayWidth, 4, true)).toBe(true);
  expect(shouldShowActivityMessageNav(stayWidth - 4, 4, true)).toBe(false);
});

test("A/B chrome groups never appear on settings; B only with workspace", () => {
  expect(
    shouldShowPanelChromeGroupB({ settingsOpen: true, showWorkspacePanel: true }),
  ).toBe(false);
  expect(
    shouldShowWorkspaceActionGroupA({ settingsOpen: true, showWorkspacePanel: true }),
  ).toBe(false);
  expect(
    shouldShowPanelChromeGroupB({ settingsOpen: false, showWorkspacePanel: true }),
  ).toBe(true);
  expect(
    shouldShowPanelChromeGroupB({ settingsOpen: false, showWorkspacePanel: false }),
  ).toBe(false);
});

test("main shell media queries match the token table", () => {
  expect(MAIN_SHELL_MEDIA_QUERIES.sidebarOverlay).toBe(
    `(max-width: ${MAIN_SHELL_BREAKPOINTS.sidebarOverlay}px)`,
  );
  expect(MAIN_SHELL_MEDIA_QUERIES.taskOverlay).toBe(
    `(max-width: ${MAIN_SHELL_BREAKPOINTS.taskOverlay}px)`,
  );
});

test("task panel layout phase derives open/closing/fullscreen cleanly", () => {
  expect(
    resolveTaskPanelLayoutPhase({ layoutPresent: false, exiting: false, fullscreen: false }),
  ).toBe("closed");
  expect(
    resolveTaskPanelLayoutPhase({ layoutPresent: true, exiting: true, fullscreen: true }),
  ).toBe("closing");
  expect(
    resolveTaskPanelLayoutPhase({ layoutPresent: true, exiting: false, fullscreen: true }),
  ).toBe("fullscreen");
  expect(
    resolveTaskPanelLayoutPhase({ layoutPresent: true, exiting: false, fullscreen: false }),
  ).toBe("open");
});

test("browser tab switches keep fullscreen while the task panel is already open", () => {
  expect(shouldResetTaskPanelFullscreenOnBrowserOpen(true)).toBe(false);
  expect(shouldResetTaskPanelFullscreenOnBrowserOpen(false)).toBe(true);
});

test("fullscreen chrome only while docked open and wide", () => {
  expect(
    shouldShowTaskFullscreenChrome({ phase: "open", viewportMatchesTaskOverlay: false }),
  ).toBe(true);
  expect(
    shouldShowTaskFullscreenChrome({ phase: "open", viewportMatchesTaskOverlay: true }),
  ).toBe(false);
  expect(
    shouldShowTaskFullscreenChrome({ phase: "closing", viewportMatchesTaskOverlay: false }),
  ).toBe(false);
});

test("panel chrome button strip width grows only for the FS slot", () => {
  const base =
    PANEL_CHROME_GEOMETRY.baseButtonCount * PANEL_CHROME_GEOMETRY.buttonPx +
    (PANEL_CHROME_GEOMETRY.baseButtonCount - 1) * PANEL_CHROME_GEOMETRY.gapPx;
  const withFs =
    (PANEL_CHROME_GEOMETRY.baseButtonCount + PANEL_CHROME_GEOMETRY.fullscreenSlotButtons) *
      PANEL_CHROME_GEOMETRY.buttonPx +
    (PANEL_CHROME_GEOMETRY.baseButtonCount + PANEL_CHROME_GEOMETRY.fullscreenSlotButtons - 1) *
      PANEL_CHROME_GEOMETRY.gapPx;
  expect(panelChromeButtonsWidthPx(false)).toBe(base);
  expect(panelChromeButtonsWidthPx(true)).toBe(withFs);
  expect(panelChromeCssVariables({ fullscreenSlotOpen: false })["--panel-chrome-buttons-width"]).toBe(
    `${base}px`,
  );
  expect(panelChromeCssVariables({ fullscreenSlotOpen: true })["--panel-chrome-buttons-width"]).toBe(
    `${withFs}px`,
  );
});

test("task panel width is capped by feed column floor, not a fixed 760", () => {
  expect(TASK_PANEL_GEOMETRY.minWidth).toBe(360);
  expect(TASK_PANEL_GEOMETRY.feedColumnMinWidth).toBe(320);
  expect(clampTaskPanelWidth(Number.NaN)).toBe(TASK_PANEL_GEOMETRY.defaultWidth);
  expect(clampTaskPanelWidth(200)).toBe(360);
  expect(clampTaskPanelWidth(900)).toBe(900);
  expect(clampTaskPanelWidth(900, 1_600)).toBe(900);
  expect(clampTaskPanelWidth(1_400, 1_600)).toBe(1_280);
  expect(clampTaskPanelWidth(200, 1_600)).toBe(360);
  expect(taskPanelMaxWidthForPane(1_600)).toBe(1_280);
  expect(taskPanelMaxWidthForPane(0)).toBe(360);
  expect(taskPanelGeometryCssVariables()["--feed-column-min-width"]).toBe("320px");
  expect(taskPanelGeometryCssVariables()["--task-panel-min-width"]).toBe("360px");
});
