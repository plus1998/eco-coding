/**
 * UI smoke: editing a queued follow-up restores displaced composer draft after save.
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9333";
const DRAFT_TEXT = "【草稿】继续优化性能";
const QUEUED_TEXT = "【排队】稍后补充说明";
const EDITED_QUEUED_TEXT = "【排队-已编辑】稍后补充说明";

async function fillComposer(page, text) {
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
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
}

async function readComposerText(page) {
  return page.locator('.composer-skill-input-control[role="textbox"]').first().innerText();
}

async function waitForSendEnabled(page, timeoutMs = 15_000) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector("button.send-button");
      return button instanceof HTMLButtonElement && !button.disabled;
    },
    undefined,
    { timeout: timeoutMs },
  );
}

async function getSelectedThreadStatus(page) {
  return page.evaluate(async () => {
    const threads = await window.eco.listThreads();
    const selectedTitle = document.querySelector("h2")?.textContent?.trim();
    const active = threads.find((t) => t.title === selectedTitle) ?? threads[0];
    return active?.status;
  });
}

async function waitForThreadRunning(page, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await getSelectedThreadStatus(page);
    if (status === "running" || status === "queued") {
      return status;
    }
    if (status === "blocked" || status === "failed") {
      throw new Error(`Thread entered ${status} before running`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Thread did not enter running/queued within ${timeoutMs}ms`);
}

async function waitForFollowUpQueue(page, timeoutMs = 30_000) {
  await page.locator(".follow-up-queue").waitFor({ state: "visible", timeout: timeoutMs });
}

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context from CDP");
  const page = context.pages().find((p) => p.url().includes("5173")) ?? context.pages()[0];
  if (!page) throw new Error("No page from CDP");

  await page.waitForFunction(() => typeof window.eco !== "undefined", undefined, { timeout: 15_000 });

  console.log("[test] starting new chat...");
  await page.getByRole("button", { name: "新对话" }).click();
  await page.waitForTimeout(1000);

  console.log("[test] sending starter prompt...");
  await fillComposer(page, "请用200字解释什么是递归，不要执行任何工具，只输出文字");
  await waitForSendEnabled(page);
  await page.locator("button.send-button").click();

  console.log("[test] waiting for running thread...");
  const runningStatus = await waitForThreadRunning(page);
  console.log("[test] thread status:", runningStatus);

  console.log("[test] queueing initial follow-up...");
  await fillComposer(page, QUEUED_TEXT);
  await waitForSendEnabled(page);
  await page.locator("button.send-button.queue").click();
  await waitForFollowUpQueue(page);

  console.log("[test] typing composer draft after queue...");
  await fillComposer(page, DRAFT_TEXT);
  const draftBeforeEdit = (await readComposerText(page)).trim();
  console.log("[test] draft before edit:", JSON.stringify(draftBeforeEdit));
  if (!draftBeforeEdit.includes("草稿")) {
    throw new Error(`Expected draft in composer before edit, got: ${draftBeforeEdit}`);
  }

  console.log("[test] editing queued follow-up...");
  await page.locator(".follow-up-row").first().click();
  await page.waitForFunction(
    () => {
      const composer = document.querySelector('.composer-skill-input-control[role="textbox"]');
      return composer?.textContent?.includes("排队");
    },
    undefined,
    { timeout: 10_000 },
  );

  const whileEditing = (await readComposerText(page)).trim();
  console.log("[test] composer while editing:", JSON.stringify(whileEditing));
  if (!whileEditing.includes("排队")) {
    throw new Error(`Expected queued text while editing, got: ${whileEditing}`);
  }

  console.log("[test] saving edited follow-up...");
  await fillComposer(page, EDITED_QUEUED_TEXT);
  await page.locator("button.send-button.save-follow-up").click();
  await page.waitForFunction(
    () => {
      const composer = document.querySelector('.composer-skill-input-control[role="textbox"]');
      return composer?.textContent?.includes("草稿");
    },
    undefined,
    { timeout: 15_000 },
  );

  const restored = (await readComposerText(page)).trim();
  console.log("[test] composer after save:", JSON.stringify(restored));
  if (!restored.includes("草稿")) {
    throw new Error(`Expected restored draft after save, got: ${restored}`);
  }

  console.log("[test] PASS — composer draft restored after editing queued follow-up");
} finally {
  await browser.close();
}
