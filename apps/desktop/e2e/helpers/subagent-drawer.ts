import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function waitForTaskPanelWidth(page: Page, minimumWidth: number): Promise<void> {
  await page.waitForFunction(
    (expectedWidth) => {
      const panel = document.querySelector("#task-panel");
      return panel instanceof HTMLElement && panel.getBoundingClientRect().width >= expectedWidth;
    },
    minimumWidth,
    { timeout: 10_000 },
  );
}

export async function expectReviewTab(page: Page): Promise<void> {
  const reviewTabs = page.locator(".subagent-task-panel-tab--review");
  await reviewTabs.first().waitFor({ state: "visible", timeout: 10_000 });
  await expect(reviewTabs).toHaveCount(1);
}

export async function expectSubagentTaskPanel(page: Page): Promise<void> {
  await expectReviewTab(page);
  await expect(page.locator(".subagent-task-panel-tab--subagent")).toHaveCount(1);
  await expect(page.locator(".subagent-task-panel-tab--terminal")).toHaveCount(0);
  await expect(page.locator(".subagent-task-side-panel-title, .subagent-task-detail-head")).toHaveCount(0);
}

export async function expectReviewTaskPanel(page: Page): Promise<void> {
  await expectReviewTab(page);
  const reviewActive = await page
    .locator(".subagent-task-panel-tab--review")
    .first()
    .evaluate((node) => node.classList.contains("is-active"));
  expect(reviewActive).toBe(true);
  await expect(page.locator(".subagent-task-panel-tab--subagent")).toHaveCount(0);
  await expect(page.locator(".subagent-task-panel-tab--terminal")).toHaveCount(0);
}

export async function expectMainFeedLayoutRestored(page: Page): Promise<void> {
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

export async function expectResponsiveWorkspaceModes(page: Page): Promise<void> {
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

async function expectWorkspacePanelLayout(page: Page, expectedDocked: boolean): Promise<void> {
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

async function expectFloatingWorkspacePanelClearOfFeed(page: Page) {
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
      return panelRect.left - feedRect.right >= 8;
    },
    undefined,
    { timeout: 10_000 },
  );
  return page.locator(".codex-feed-stack").evaluate((feed) => {
    const rect = feed.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
}

async function expectDockedWorkspacePanelReservesFeed(page: Page): Promise<void> {
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
  expect(openGeometry).toBeTruthy();

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

async function expectFeedRect(page: Page, expectedRect: { left: number; width: number }): Promise<void> {
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

export async function expectWorkspacePanelOpen(page: Page, expectedOpen: boolean): Promise<void> {
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

export async function expectWorkspaceToolbarRightReserve(
  page: Page,
  expectedReserved: boolean,
): Promise<void> {
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
