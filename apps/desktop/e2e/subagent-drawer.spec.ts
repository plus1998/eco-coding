import { clickSend, fillComposer } from "./helpers/eco-page";
import {
  expectMainFeedLayoutRestored,
  expectResponsiveWorkspaceModes,
  expectReviewTaskPanel,
  expectSubagentTaskPanel,
  expectWorkspaceToolbarRightReserve,
  waitForTaskPanelWidth,
} from "./helpers/subagent-drawer";
import { expect, test } from "./fixtures/electron-app";

test("subagent drawer, task panel, and workspace layout", async ({ ecoPage: page }) => {
  const marker = process.env.ECO_SMOKE_MARKER ?? `ECO_SUBAGENT_DRAWER_${Date.now()}`;
  const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "90000", 10);
  const workspaceLayoutOnly = process.env.ECO_SMOKE_WORKSPACE_LAYOUT_ONLY === "1";
  const prompt =
    process.env.ECO_SMOKE_PROMPT ??
    [
      `Ask the coder subagent to inspect one small file and report ${marker}.`,
      "Do not modify files.",
      `After the subagent finishes, reply only with ${marker}.`,
    ].join(" ");

  if (process.env.ECO_SMOKE_CONNECT_ONLY === "1") {
    console.log(
      `[subagent-drawer] connected title=${JSON.stringify(await page.title())} url=${page.url()}`,
    );
    return;
  }

  if (workspaceLayoutOnly) {
    await page.locator(".codex-feed-stack").waitFor({ state: "visible", timeout: 10_000 });
    await expectResponsiveWorkspaceModes(page);
    console.log("[subagent-drawer] workspace layout ok");
    return;
  }

  await fillComposer(page, prompt);
  await clickSend(page);

  const subagentCard = page.locator(".subagent-run-row").first();
  await subagentCard.waitFor({ state: "visible", timeout: timeoutMs });

  expect(await page.locator(".work-session-details-compact").count()).toBe(0);

  await subagentCard.click();
  await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".subagent-task-detail-feed").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".subagent-conversation").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".subagent-conversation-prompt").waitFor({ state: "visible", timeout: 30_000 });
  await waitForTaskPanelWidth(page, 360);
  await expectSubagentTaskPanel(page);

  const workspacePanelButton = page
    .locator('.codex-main-toolbar-button[aria-controls="workspace-cards-panel"]')
    .first();
  const taskPanelButton = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await workspacePanelButton.waitFor({ state: "visible", timeout: 10_000 });
  await taskPanelButton.waitFor({ state: "visible", timeout: 10_000 });

  expect(await taskPanelButton.evaluate((node) => node.classList.contains("is-active"))).toBe(true);
  await expectWorkspaceToolbarRightReserve(page, false);

  const taskPanelWidthBefore = await page
    .locator("#task-panel-container")
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(taskPanelWidthBefore).toBeGreaterThanOrEqual(360);

  const resizeHandle = page.locator(".task-panel-resize-handle").first();
  await resizeHandle.waitFor({ state: "visible", timeout: 10_000 });
  const resizeHandleBox = await resizeHandle.boundingBox();
  expect(resizeHandleBox).toBeTruthy();

  const dragLeft = taskPanelWidthBefore < 700;
  await page.mouse.move(
    resizeHandleBox!.x + resizeHandleBox!.width / 2,
    resizeHandleBox!.y + resizeHandleBox!.height / 2,
  );
  await page.mouse.down();
  try {
    await page.waitForFunction(() => document.body.classList.contains("is-resizing-task-panel"), {
      timeout: 5_000,
    });
    await page.mouse.move(
      resizeHandleBox!.x + resizeHandleBox!.width / 2 + (dragLeft ? -90 : 90),
      resizeHandleBox!.y + resizeHandleBox!.height / 2,
      { steps: 10 },
    );
    await page.waitForFunction(
      (previousWidth) => {
        const panel = document.querySelector("#task-panel-container");
        return (
          panel instanceof HTMLElement && Math.abs(panel.getBoundingClientRect().width - previousWidth) >= 40
        );
      },
      taskPanelWidthBefore,
      { timeout: 5_000 },
    );
  } finally {
    await page.mouse.up();
  }

  const taskPanelWidthAfter = await page
    .locator("#task-panel-container")
    .evaluate((node) => node.getBoundingClientRect().width);
  expect(Math.abs(taskPanelWidthAfter - taskPanelWidthBefore)).toBeGreaterThanOrEqual(40);

  if (!(await workspacePanelButton.evaluate((node) => node.classList.contains("is-active")))) {
    await workspacePanelButton.click();
  }
  await page.locator(".workspace-floating-cards").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".workspace-subagent-runs-list").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });

  const changesButton = page
    .locator(".thread-info-workspace-git-changes-row .thread-info-workspace-git-row-button")
    .first();
  await changesButton.waitFor({ state: "visible", timeout: 10_000 });
  await changesButton.click();
  await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
  await waitForTaskPanelWidth(page, 360);
  await expectReviewTaskPanel(page);
  expect(await page.locator(".workspace-diff-drawer").count()).toBe(0);

  await workspacePanelButton.click();
  await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".workspace-floating-cards").waitFor({ state: "hidden", timeout: 10_000 });
  await waitForTaskPanelWidth(page, 360);
  await expectReviewTaskPanel(page);

  await taskPanelButton.click();
  await expectMainFeedLayoutRestored(page);
  await expectWorkspaceToolbarRightReserve(page, true);
  await expectResponsiveWorkspaceModes(page);

  await taskPanelButton.click();
  await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
  await waitForTaskPanelWidth(page, 360);
  await expectReviewTaskPanel(page);
  await expectWorkspaceToolbarRightReserve(page, false);

  const terminalTask = await page.evaluate(async (taskMarker) => {
    const workspace = await window.eco.getCurrentWorkspace();
    if (!workspace?.path) {
      throw new Error("No current workspace is available.");
    }
    return window.eco.startBackgroundTerminalTask({
      workspacePath: workspace.path,
      command: ["echo", taskMarker],
      label: `smoke ${taskMarker}`,
    });
  }, marker);

  expect(await page.locator(".subagent-task-panel-tab--terminal").count()).toBe(0);

  await page.evaluate(async (taskId) => {
    await window.eco.openBackgroundTerminalTask({ taskId });
  }, terminalTask.taskId);

  await page.evaluate(async (taskId) => {
    await window.eco.stopBackgroundTerminalTask({ taskId });
  }, terminalTask.taskId);

  console.log(`[subagent-drawer] ok marker=${marker}`);
});
