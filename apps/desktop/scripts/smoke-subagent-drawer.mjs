import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const marker = process.env.ECO_SMOKE_MARKER ?? `ECO_SUBAGENT_DRAWER_${Date.now()}`;
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "90000", 10);
const connectOnly = process.argv.includes("--connect-only") || process.env.ECO_SMOKE_CONNECT_ONLY === "1";
const prompt =
  process.env.ECO_SMOKE_PROMPT ??
  [
    `Ask the coder subagent to inspect one small file and report ${marker}.`,
    "Do not modify files.",
    `After the subagent finishes, reply only with ${marker}.`,
  ].join(" ");

const browser = await chromium.connectOverCDP(cdpUrl);
const page = await findEcoPage(browser);
await page.bringToFront();

if (connectOnly) {
  console.log(
    `[smoke-subagent-drawer] connected title=${JSON.stringify(await page.title())} url=${page.url()}`,
  );
  process.exit(0);
}

await fillComposer(page, prompt);
await clickSend(page);

const subagentCard = page.locator(".subagent-run-row").first();
await subagentCard.waitFor({ state: "visible", timeout: timeoutMs });

const detailCountBeforeOpen = await page.locator(".work-session-details-compact").count();
if (detailCountBeforeOpen !== 0) {
  throw new Error(
    `Expected subagent details to stay unmounted in the main feed, found ${detailCountBeforeOpen}.`,
  );
}

await subagentCard.click();
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".subagent-task-detail-feed").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".subagent-conversation").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".subagent-conversation-prompt").waitFor({ state: "visible", timeout: 10_000 });
await waitForTaskPanelWidth(page, 360);
await expectSubagentTaskPanel(page);

const workspacePanelButton = page
  .locator('.codex-main-toolbar-button[aria-controls="workspace-panel"]')
  .first();
const terminalPanelButton = page
  .locator('.codex-main-toolbar-button[aria-controls="terminal-panel"]')
  .first();
const taskPanelButton = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
await workspacePanelButton.waitFor({ state: "visible", timeout: 10_000 });
await terminalPanelButton.waitFor({ state: "visible", timeout: 10_000 });
await taskPanelButton.waitFor({ state: "visible", timeout: 10_000 });

if (!(await taskPanelButton.evaluate((node) => node.classList.contains("is-active")))) {
  throw new Error("Expected the task panel toolbar button to be active after opening a subagent card.");
}
if (await workspacePanelButton.evaluate((node) => node.classList.contains("is-active"))) {
  throw new Error("Workspace cards button should not stay active while the task panel is open.");
}

const taskPanelWidthBefore = await page
  .locator("#task-panel")
  .evaluate((node) => node.getBoundingClientRect().width);
if (taskPanelWidthBefore < 360) {
  throw new Error(
    `Expected task panel to be wider than the compact workspace cards, got ${taskPanelWidthBefore}.`,
  );
}

const resizeHandle = page.locator(".task-panel-resize-handle").first();
await resizeHandle.waitFor({ state: "visible", timeout: 10_000 });
const resizeHandleBox = await resizeHandle.boundingBox();
if (!resizeHandleBox) {
  throw new Error("Task panel resize handle did not expose a bounding box.");
}
const dragLeft = taskPanelWidthBefore < 700;
await page.mouse.move(
  resizeHandleBox.x + resizeHandleBox.width / 2,
  resizeHandleBox.y + resizeHandleBox.height / 2,
);
await page.mouse.down();
try {
  await page.waitForFunction(() => document.body.classList.contains("is-resizing-task-panel"), {
    timeout: 5_000,
  });
  await page.mouse.move(
    resizeHandleBox.x + resizeHandleBox.width / 2 + (dragLeft ? -90 : 90),
    resizeHandleBox.y + resizeHandleBox.height / 2,
    { steps: 10 },
  );
  await page.waitForFunction(
    (previousWidth) => {
      const panel = document.querySelector("#task-panel");
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
  .locator("#task-panel")
  .evaluate((node) => node.getBoundingClientRect().width);
if (Math.abs(taskPanelWidthAfter - taskPanelWidthBefore) < 40) {
  throw new Error(
    `Expected dragging the task panel handle to resize the panel, before=${taskPanelWidthBefore}, after=${taskPanelWidthAfter}.`,
  );
}

await workspacePanelButton.click();
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "hidden", timeout: 10_000 });
await page.locator(".workspace-floating-cards").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".workspace-subagent-runs-list").waitFor({ state: "visible", timeout: 10_000 });
if (!(await workspacePanelButton.evaluate((node) => node.classList.contains("is-active")))) {
  throw new Error("Expected workspace cards button to become active after clicking it.");
}
if (await taskPanelButton.evaluate((node) => node.classList.contains("is-active"))) {
  throw new Error("Task panel button should not stay active while workspace cards are open.");
}

const changesButton = page
  .locator(".thread-info-workspace-git-changes-row .thread-info-workspace-git-row-button")
  .first();
await changesButton.waitFor({ state: "visible", timeout: 10_000 });
await changesButton.click();
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
await waitForTaskPanelWidth(page, 360);
await expectReviewTaskPanel(page);
const legacyDiffDrawerCount = await page.locator(".workspace-diff-drawer").count();
if (legacyDiffDrawerCount !== 0) {
  throw new Error(
    `Expected workspace changes to open in the task panel, found ${legacyDiffDrawerCount} legacy drawers.`,
  );
}

await workspacePanelButton.click();
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "hidden", timeout: 10_000 });
await page.locator(".workspace-floating-cards").waitFor({ state: "visible", timeout: 10_000 });

await taskPanelButton.click();
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".workspace-floating-cards").waitFor({ state: "hidden", timeout: 10_000 });
await waitForTaskPanelWidth(page, 360);
await expectReviewTaskPanel(page);

await taskPanelButton.click();
await expectMainFeedLayoutRestored(page);

await taskPanelButton.click();
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
await waitForTaskPanelWidth(page, 360);
await expectReviewTaskPanel(page);

const terminalTask = await page.evaluate(async (taskMarker) => {
  if (!window.eco?.getCurrentWorkspace || !window.eco?.startBackgroundTerminalTask) {
    throw new Error("Eco preload background terminal API is unavailable.");
  }
  const workspace = await window.eco.getCurrentWorkspace();
  if (!workspace?.path) {
    throw new Error("No current workspace is available.");
  }
  return await window.eco.startBackgroundTerminalTask({
    workspacePath: workspace.path,
    command: ["echo", taskMarker],
    label: `smoke ${taskMarker}`,
  });
}, marker);

const terminalTabs = await page.locator(".subagent-task-panel-tab--terminal").count();
if (terminalTabs !== 0) {
  throw new Error(
    `Expected background terminal tasks to stay out of the subagent detail tabs, found ${terminalTabs}.`,
  );
}

await page.evaluate(async (taskId) => {
  if (!window.eco?.openBackgroundTerminalTask) {
    throw new Error("Eco preload openBackgroundTerminalTask API is unavailable.");
  }
  await window.eco.openBackgroundTerminalTask({ taskId });
}, terminalTask.taskId);

await page.evaluate(async (taskId) => {
  if (!window.eco?.stopBackgroundTerminalTask) {
    throw new Error("Eco preload stopBackgroundTerminalTask API is unavailable.");
  }
  await window.eco.stopBackgroundTerminalTask({ taskId });
}, terminalTask.taskId);

console.log(`[smoke-subagent-drawer] ok marker=${marker}`);
process.exit(0);

async function findEcoPage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const existing =
    pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:5173/")) ??
    pages.find((candidate) => candidate.url().startsWith("http://localhost:5173/")) ??
    pages[0];
  if (!existing) {
    throw new Error("No Electron page is available through CDP.");
  }
  await existing.waitForLoadState("domcontentloaded");
  return existing;
}

async function fillComposer(page, text) {
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 10_000 });
  await composer.evaluate((node, value) => {
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, value);
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }, text);
  await page.waitForFunction(() => {
    const button = document.querySelector("button.send-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
}

async function clickSend(page) {
  await page.locator("button.send-button").click();
}

async function waitForTaskPanelWidth(page, minimumWidth) {
  await page.waitForFunction(
    (expectedWidth) => {
      const panel = document.querySelector("#task-panel");
      return panel instanceof HTMLElement && panel.getBoundingClientRect().width >= expectedWidth;
    },
    minimumWidth,
    { timeout: 10_000 },
  );
}

async function expectReviewTab(page) {
  const reviewTabs = page.locator(".subagent-task-panel-tab--review");
  await reviewTabs.first().waitFor({ state: "visible", timeout: 10_000 });
  const reviewCount = await reviewTabs.count();
  if (reviewCount !== 1) {
    throw new Error(`Expected the default review tab to be present once, found ${reviewCount}.`);
  }
}

async function expectSubagentTaskPanel(page) {
  await expectReviewTab(page);
  const subagentTabCount = await page.locator(".subagent-task-panel-tab--subagent").count();
  if (subagentTabCount !== 1) {
    throw new Error(`Expected exactly one opened subagent tab, found ${subagentTabCount}.`);
  }
  const terminalCount = await page.locator(".subagent-task-panel-tab--terminal").count();
  if (terminalCount !== 0) {
    throw new Error("Expected terminal not to be shown as a subagent detail tab.");
  }
  const nestedHeadingCount = await page
    .locator(".subagent-task-side-panel-title, .subagent-task-detail-head")
    .count();
  if (nestedHeadingCount !== 0) {
    throw new Error(
      `Expected subagent panel content to stay flat, found ${nestedHeadingCount} nested headings.`,
    );
  }
}

async function expectReviewTaskPanel(page) {
  await expectReviewTab(page);
  const reviewActive = await page
    .locator(".subagent-task-panel-tab--review")
    .first()
    .evaluate((node) => node.classList.contains("is-active"));
  if (!reviewActive) {
    throw new Error("Expected review tab to be active.");
  }
  const subagentTabCount = await page.locator(".subagent-task-panel-tab--subagent").count();
  if (subagentTabCount !== 0) {
    throw new Error(`Expected no subagent tab in default review panel, found ${subagentTabCount}.`);
  }
  const terminalCount = await page.locator(".subagent-task-panel-tab--terminal").count();
  if (terminalCount !== 0) {
    throw new Error("Expected terminal not to be shown as a subagent detail tab.");
  }
}

async function expectMainFeedLayoutRestored(page) {
  await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const main = document.querySelector(".codex-main-scroll");
      return (
        main instanceof HTMLElement &&
        !main.classList.contains("has-workspace-panel") &&
        !main.classList.contains("is-workspace-panel-open") &&
        !main.classList.contains("is-task-panel-open") &&
        !document.querySelector("#workspace-panel")
      );
    },
    undefined,
    { timeout: 10_000 },
  );
}
