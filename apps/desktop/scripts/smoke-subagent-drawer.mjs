import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const marker = process.env.ECO_SMOKE_MARKER ?? `ECO_SUBAGENT_DRAWER_${Date.now()}`;
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "90000", 10);
const connectOnly = process.argv.includes("--connect-only") || process.env.ECO_SMOKE_CONNECT_ONLY === "1";
const workspaceLayoutOnly = process.argv.includes("--workspace-layout-only");
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

if (workspaceLayoutOnly) {
  await page.locator(".codex-feed-stack").waitFor({ state: "visible", timeout: 10_000 });
  await expectResponsiveWorkspaceModes(page);
  console.log("[smoke-subagent-drawer] workspace layout ok");
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
await page.locator(".subagent-conversation-prompt").waitFor({ state: "visible", timeout: 30_000 });
await waitForTaskPanelWidth(page, 360);
await expectSubagentTaskPanel(page);

const workspacePanelButton = page
  .locator('.codex-main-toolbar-button[aria-controls="workspace-cards-panel"]')
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
await expectWorkspaceToolbarRightReserve(page, false);
const taskPanelWidthBefore = await page
  .locator("#task-panel-container")
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
if (Math.abs(taskPanelWidthAfter - taskPanelWidthBefore) < 40) {
  throw new Error(
    `Expected dragging the task panel handle to resize the panel, before=${taskPanelWidthBefore}, after=${taskPanelWidthAfter}.`,
  );
}

if (!(await workspacePanelButton.evaluate((node) => node.classList.contains("is-active")))) {
  await workspacePanelButton.click();
}
await page.locator(".workspace-floating-cards").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".workspace-subagent-runs-list").waitFor({ state: "visible", timeout: 10_000 });
await page.locator(".subagent-task-side-panel.is-open").waitFor({ state: "visible", timeout: 10_000 });
if (!(await workspacePanelButton.evaluate((node) => node.classList.contains("is-active")))) {
  throw new Error("Expected workspace cards button to become active after clicking it.");
}
if (!(await taskPanelButton.evaluate((node) => node.classList.contains("is-active")))) {
  throw new Error("Task panel should remain active while workspace cards are open.");
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
    pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:")) ??
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
      const mainPane = document.querySelector(".codex-main-pane");
      return (
        mainPane instanceof HTMLElement &&
        !mainPane.classList.contains("is-task-panel-open") &&
        !document.querySelector("#task-panel-container")
      );
    },
    undefined,
    { timeout: 10_000 },
  );
}

async function expectResponsiveWorkspaceModes(page) {
  const originalViewport = page.viewportSize() ?? { width: 1440, height: 900 };
  const scenarios = [
    { width: 1800, mode: "is-full", panelOpen: true, panelDocked: false },
    { width: 1450, mode: "is-feed-panel", panelOpen: true, panelDocked: true },
    { width: 1150, mode: "is-feed-nav", panelOpen: false, panelDocked: false },
    { width: 1000, mode: "is-feed-only", panelOpen: false, panelDocked: false },
  ];
  try {
    for (const [index, scenario] of scenarios.entries()) {
      await page.setViewportSize({ width: scenario.width, height: 900 });
      await page.waitForFunction(
        (expectedMode) =>
          document.querySelector(".activity-workspace-shell")?.classList.contains(expectedMode),
        scenario.mode,
        { timeout: 10_000 },
      );
      await expectWorkspacePanelOpen(page, scenario.panelOpen);
      await expectWorkspacePanelLayout(page, scenario.panelDocked);

      if (index === 0) {
        const openFeedRect = await expectFloatingWorkspacePanelClearOfFeed(page);
        await page.locator('.codex-main-toolbar-button[aria-controls="workspace-cards-panel"]').click();
        await expectWorkspacePanelOpen(page, false);
        await expectFeedRect(page, openFeedRect);
      }
      if (index === 1) {
        await expectDockedWorkspacePanelReservesFeed(page);
      }
      if (index === 2) {
        await page.locator('.codex-main-toolbar-button[aria-controls="workspace-cards-panel"]').click();
        await expectWorkspacePanelOpen(page, true);
      }
    }
  } finally {
    await page.setViewportSize(originalViewport);
  }
}

async function expectWorkspacePanelLayout(page, expectedDocked) {
  await page.waitForFunction(
    (docked) => {
      const shell = document.querySelector(".activity-workspace-shell");
      const scroll = document.querySelector(".codex-main-scroll");
      const panel = document.querySelector("#workspace-cards-panel");
      return (
        shell instanceof HTMLElement &&
        scroll instanceof HTMLElement &&
        panel instanceof HTMLElement &&
        shell.classList.contains("has-docked-workspace-cards") === docked &&
        scroll.classList.contains("is-workspace-cards-docked") === docked &&
        panel.classList.contains("is-docked") === docked
      );
    },
    expectedDocked,
    { timeout: 10_000 },
  );
}

async function expectFloatingWorkspacePanelClearOfFeed(page) {
  await page.waitForFunction(
    () => {
      const feed = document.querySelector(".codex-feed-stack");
      const panel = document.querySelector("#workspace-cards-panel");
      if (!(feed instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return false;
      }
      const panelTransform = new DOMMatrixReadOnly(window.getComputedStyle(panel).transform);
      if (Math.abs(panelTransform.m41) > 0.5) {
        return false;
      }
      const feedRect = feed.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.left - feedRect.right < 8) {
        return false;
      }
      return true;
    },
    undefined,
    { timeout: 10_000 },
  );
  return await page.locator(".codex-feed-stack").evaluate((feed) => {
    const rect = feed.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
}

async function expectDockedWorkspacePanelReservesFeed(page) {
  const openGeometry = await page.evaluate(() => {
    const feed = document.querySelector(".codex-feed-stack");
    const panel = document.querySelector("#workspace-cards-panel");
    const scrollBody = document.querySelector(".codex-main-scroll-body");
    if (
      !(feed instanceof HTMLElement) ||
      !(panel instanceof HTMLElement) ||
      !(scrollBody instanceof HTMLElement)
    ) {
      return null;
    }
    const feedRect = feed.getBoundingClientRect();
    return {
      feedLeft: feedRect.left,
      feedWidth: feedRect.width,
      panelWidth: panel.getBoundingClientRect().width,
      paddingRight: Number.parseFloat(window.getComputedStyle(scrollBody).paddingRight),
    };
  });
  if (!openGeometry) {
    throw new Error("Expected docked workspace panel geometry to be measurable.");
  }

  await page.locator('.codex-main-toolbar-button[aria-controls="workspace-cards-panel"]').click();
  await expectWorkspacePanelOpen(page, false);
  await page.waitForFunction(
    (open) => {
      const feed = document.querySelector(".codex-feed-stack");
      const scrollBody = document.querySelector(".codex-main-scroll-body");
      if (!(feed instanceof HTMLElement) || !(scrollBody instanceof HTMLElement)) {
        return false;
      }
      const feedRect = feed.getBoundingClientRect();
      const paddingRight = Number.parseFloat(window.getComputedStyle(scrollBody).paddingRight);
      return (
        open.paddingRight - paddingRight >= open.panelWidth * 0.75 &&
        (Math.abs(feedRect.left - open.feedLeft) > 2 || Math.abs(feedRect.width - open.feedWidth) > 2)
      );
    },
    openGeometry,
    { timeout: 10_000 },
  );
}

async function expectFeedRect(page, expectedRect) {
  await page.waitForFunction(
    (expected) => {
      const feed = document.querySelector(".codex-feed-stack");
      if (!(feed instanceof HTMLElement)) {
        return false;
      }
      const rect = feed.getBoundingClientRect();
      return Math.abs(rect.left - expected.left) <= 1 && Math.abs(rect.width - expected.width) <= 1;
    },
    expectedRect,
    { timeout: 10_000 },
  );
}

async function expectWorkspacePanelOpen(page, expectedOpen) {
  await page.waitForFunction(
    (open) => {
      const panel = document.querySelector("#workspace-cards-panel");
      const button = document.querySelector(
        '.codex-main-toolbar-button[aria-controls="workspace-cards-panel"]',
      );
      return (
        panel instanceof HTMLElement &&
        button instanceof HTMLButtonElement &&
        panel.classList.contains("is-open") === open &&
        button.getAttribute("aria-expanded") === String(open)
      );
    },
    expectedOpen,
    { timeout: 10_000 },
  );
}

async function expectWorkspaceToolbarRightReserve(page, expectedReserved) {
  await page.waitForFunction(
    (reserved) => {
      const toolbar = document.querySelector(".codex-main-toolbar--workspace");
      if (!(toolbar instanceof HTMLElement)) {
        return false;
      }
      const marginRight = Number.parseFloat(window.getComputedStyle(toolbar).marginRight);
      return Number.isFinite(marginRight) && (reserved ? marginRight > 1 : marginRight <= 0.5);
    },
    expectedReserved,
    { timeout: 10_000 },
  );
}
