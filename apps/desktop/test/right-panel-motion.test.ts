import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const drawerSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/SubagentTaskDrawer.tsx", import.meta.url)),
  "utf8",
);
const taskPanelController = appSource.slice(
  appSource.indexOf("const revealTaskPanel"),
  appSource.indexOf("const handleTaskPanelResizeMouseDown"),
);

test("task panel releases layout only after its compositor exit completes", () => {
  // Critical layout flags apply immediately after the exit animation; secondary
  // mode side-effects can stay non-urgent.
  expect(appSource).toMatch(
    /taskPanelAnimationControls[\s\S]*?\.start\([\s\S]*?\)\s*\.then\(\(\) => \{[\s\S]*?setTaskDrawerOpen\(false\);\s*setTaskPanelLayoutPresent\(false\);/,
  );
  expect(appSource).toContain("setTaskPanelExiting(true)");
  expect(appSource).toContain("is-task-panel-exiting");
  expect(styles).toContain(".is-task-panel-exiting");
  expect(appSource).toContain("Boolean(showWorkspacePanel && workspacePanelResolvedOpen)");
  expect(appSource).not.toContain(
    "showWorkspacePanel && workspacePanelResolvedOpen && !taskPanelLayoutPresent",
  );
  expect(appSource).toMatch(
    /if \(shouldAutoOpenWorkspacePanel\(nextLayoutMode\)\) \{\s*setWorkspacePanelManualOverride\(\{[\s\S]*?open: true,/,
  );
});

test("right panel motion stays on transform and opacity instead of animating grid layout", () => {
  const mainPaneRule = styles.match(/\.codex-main-pane\s*\{[^}]*\}/s)?.[0] ?? "";
  const workspaceGridRule = styles.match(/\.codex-main-scroll\.has-workspace-panel\s*\{[^}]*\}/s)?.[0] ?? "";

  expect(mainPaneRule).not.toContain("grid-template-columns 0.32s");
  expect(workspaceGridRule).not.toContain("grid-template-columns 0.32s");
  expect(appSource).toContain('style={{ willChange: "transform, opacity" }}');
  expect(appSource).toContain('layout={prefersReducedMotion ? false : "size"}');
  expect(taskPanelController).toMatch(
    /taskPanelAnimationControls\s*\.start\(\s*prefersReducedMotion\s*\?\s*\{\s*opacity:\s*0\s*\}/,
  );
  expect(appSource).toContain("const width = activityWorkspace.clientWidth;");
  expect(appSource).not.toContain("const width = activityWorkspace.getBoundingClientRect().width;");
});

test("task panel close remains reversible and all close paths share the controller", () => {
  expect(taskPanelController).toContain("taskPanelAnimationControls.stop();");
  expect(taskPanelController).toContain("duration: reversingExit ? 0.28 : 0.34");
  expect(taskPanelController).toMatch(
    /if \(taskPanelClosingRef\.current\) \{\s*revealTaskPanel\(\);/,
  );
  expect(taskPanelController).toMatch(
    /pendingTaskPanelTabCloseRef\.current = tabId;\s*dismissTaskPanel\(\);/,
  );
  expect(appSource).toMatch(
    /onOpenTerminal=\{\(\) => \{\s*toggleTerminalForCurrentProject\(\);\s*dismissTaskPanel\(\);/,
  );
});

test("task panel ui is saved and restored per thread instead of hard-reset", () => {
  expect(appSource).toContain("taskPanelUiByThreadRef");
  expect(appSource).toContain("liveTaskPanelUiRef.current");
  expect(appSource).toContain("normalizeTaskPanelSessionUiState");
  expect(appSource).toContain("emptyTaskPanelSessionUiState");
  expect(appSource).toMatch(
    /if \(prevThreadId\) \{\s*taskPanelUiByThreadRef\.current\[prevThreadId\] = liveTaskPanelUiRef\.current;/,
  );
  expect(appSource).not.toMatch(
    /setTaskPanelActiveTab\(TASK_PANEL_HOME_TAB_ID\);\s*setFileTarget\(undefined\);\s*setOpenTaskPanelTabIds\(\[\]\);\s*setTaskDrawerOpen\(false\);\s*setTaskPanelLayoutPresent\(false\);/,
  );
});

test("panel chrome stays pinned; main topbar only hosts workspace controls", () => {
  // terminal/rightpanel stay in a fixed pane strip; fullscreen expands into that strip;
  // chat/workpanel ride the shrinking feed topbar (pushed left by layout).
  expect(appSource).toContain('data-group="workspace"');
  expect(appSource).toContain("codex-main-pane-panel-actions");
  expect(appSource).toContain("codex-main-pane-panel-action-slot");
  expect(appSource).toContain("toggleTaskPanelFullscreen");
  expect(appSource).toContain("{showWorkspacePanel ? panelControlButtons : null}");
  expect(appSource).not.toContain("toolbarEnd");
  expect(drawerSource).not.toContain("toolbarEnd");
  expect(styles).toContain(".codex-main-pane-panel-actions");
  expect(styles).toContain(".codex-main-pane-panel-action-slot.is-open");
  // Reserved topbar padding must outrank later generic padding-right rules.
  expect(styles).toContain(
    ".codex-main .codex-main-pane:not(.is-task-panel-open) .codex-main-topbar",
  );
  expect(styles).toMatch(
    /\.codex-main \.codex-main-pane:not\(\.is-task-panel-open\) \.codex-main-topbar[\s\S]*?padding-right:\s*calc\(\s*var\(--toolbar-edge-inset\) \+ 28px \+ 4px \+ 28px/,
  );

  const mainTopbar = appSource.slice(
    appSource.indexOf("const workspaceTopbarActions"),
    appSource.indexOf("const taskPanelNode"),
  );
  expect(mainTopbar).toContain("webChatListAnchorRef");
  expect(mainTopbar).toContain("toggleWorkspacePanelForCurrentProject");
  expect(mainTopbar).not.toContain("toggleTerminalForCurrentProject");
  expect(mainTopbar).not.toContain("toggleTaskPanelForCurrentProject");
  expect(appSource).toContain("{taskPanelLayoutOpen ? taskPanelNode : null}");
  expect(appSource).toContain("taskPanelLayoutOpen && !taskPanelExiting");
});
