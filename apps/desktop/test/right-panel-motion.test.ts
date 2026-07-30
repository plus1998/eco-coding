import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const appSource = readFileSync(fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)), "utf8");
const styles = readFileSync(fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)), "utf8");
const taskPanelController = appSource.slice(
  appSource.indexOf("const revealTaskPanel"),
  appSource.indexOf("const handleTaskPanelResizeMouseDown"),
);

test("task panel releases layout only after its compositor exit completes", () => {
  expect(appSource).toMatch(
    /taskPanelAnimationControls\s*\.start\([\s\S]*?\)\s*\.then\(\(\) => \{[\s\S]*?startTransition\(\(\) => \{[\s\S]*?setTaskPanelLayoutPresent\(false\);/,
  );
  expect(appSource).toContain("showWorkspacePanel && workspacePanelResolvedOpen && !taskPanelLayoutPresent");
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
