import type { Page } from "@playwright/test";

export async function ensureTaskPanelOpen(page: Page): Promise<void> {
  const button = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await button.waitFor({ state: "visible", timeout: 15_000 });
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
    await page.waitForTimeout(600);
  }
}

export async function closeTaskPanel(page: Page): Promise<void> {
  const button = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await button.waitFor({ state: "visible", timeout: 15_000 });
  if ((await button.getAttribute("aria-expanded")) === "true") {
    await button.click();
    await page.waitForTimeout(900);
  }
}

export async function goToTaskPanelHome(page: Page): Promise<void> {
  const homeButton = page.locator(".subagent-task-panel-tab-add").first();
  await homeButton.waitFor({ state: "visible", timeout: 10_000 });
  await homeButton.click();
  await page.locator(".task-panel-home-actions").waitFor({ state: "visible", timeout: 10_000 });
}

export async function openSshBookmarksTab(page: Page): Promise<void> {
  await goToTaskPanelHome(page);
  await page.locator(".task-panel-home-actions button").filter({ hasText: /SSH/i }).click();
  await page.locator(".ssh-bookmarks-panel").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("#subagent-task-tab-ssh-bookmarks").waitFor({ state: "visible", timeout: 10_000 });
}
