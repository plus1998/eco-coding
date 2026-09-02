import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures/electron-app";
import { ensureTaskPanelOpen, openSshBookmarksTab } from "./helpers/task-panel";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("SSH bookmarks CRUD in Electron task panel", async ({ ecoPage: page }) => {
  test.setTimeout(90_000);

  const marker = process.env.ECO_SMOKE_MARKER ?? `E2E_SSH_${Date.now()}`;
  const bookmarkName = `Smoke ${marker}`;

  if (process.env.ECO_SMOKE_CONNECT_ONLY === "1") {
    const apis = await page.evaluate(async () => ({
      getSshBookmarks: typeof window.eco?.getSshBookmarks === "function",
      saveSshBookmark: typeof window.eco?.saveSshBookmark === "function",
      connectSshBookmark: typeof window.eco?.connectSshBookmark === "function",
    }));
    expect(apis.getSshBookmarks).toBe(true);
    expect(apis.saveSshBookmark).toBe(true);
    expect(apis.connectSshBookmark).toBe(true);
    console.log(`[ssh-bookmarks] connect-only ok apis=${JSON.stringify(apis)}`);
    return;
  }

  await page.evaluate(async (workspacePath) => {
    await window.eco.openWorkspacePath(workspacePath);
  }, repoRoot);

  await page.waitForFunction(() => document.querySelector(".codex-main-has-toolbar") !== null, undefined, {
    timeout: 15_000,
  });

  await ensureTaskPanelOpen(page);
  await openSshBookmarksTab(page);

  await page.locator(".ssh-bookmarks-add-btn").click();
  await page.locator(".ssh-bookmarks-dialog").waitFor({ state: "visible", timeout: 10_000 });

  const fields = page.locator(".ssh-bookmarks-dialog .ssh-bookmarks-field input");
  await fields.nth(0).fill(bookmarkName);
  await fields.nth(1).fill("127.0.0.1");
  await fields.nth(2).fill("2222");
  await fields.nth(3).fill("e2e-user");
  await page.locator('.ssh-bookmarks-dialog input[type="password"]').fill("e2e-pass");

  await page.locator(".ssh-bookmarks-dialog .settings-modal-confirm").click();
  await page.locator(".ssh-bookmarks-dialog").waitFor({ state: "hidden", timeout: 10_000 });

  const row = page.locator(".ssh-bookmarks-row").filter({ hasText: bookmarkName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("e2e-user@127.0.0.1:2222");

  const persisted = await page.evaluate(async (name) => {
    const bookmarks = await window.eco.getSshBookmarks();
    return bookmarks.find((item) => item.name === name);
  }, bookmarkName);
  expect(persisted?.host).toBe("127.0.0.1");
  expect(persisted?.port).toBe(2222);
  expect(persisted?.username).toBe("e2e-user");
  expect(persisted?.authType).toBe("password");
  expect(persisted?.hasPassword).toBe(true);

  await row.locator(".ssh-bookmarks-icon-btn").first().click();
  await page.locator(".ssh-bookmarks-dialog").waitFor({ state: "visible", timeout: 10_000 });
  await fields.nth(0).fill(`${bookmarkName} Updated`);
  await page.locator(".ssh-bookmarks-dialog .settings-modal-confirm").click();
  await page.locator(".ssh-bookmarks-dialog").waitFor({ state: "hidden", timeout: 10_000 });

  const updatedRow = page.locator(".ssh-bookmarks-row").filter({ hasText: `${bookmarkName} Updated` });
  await expect(updatedRow).toHaveCount(1);

  await updatedRow.locator(".ssh-bookmarks-remove").click();
  await expect(page.locator(".ssh-bookmarks-row").filter({ hasText: bookmarkName })).toHaveCount(0);

  const remaining = await page.evaluate(async () => window.eco.getSshBookmarks());
  expect(remaining.some((item) => item.name.includes(marker))).toBe(false);

  console.log(`[ssh-bookmarks] ok marker=${marker}`);
});
