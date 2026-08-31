import type { Page } from "@playwright/test";

export async function waitForEcoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof window.eco !== "undefined");
}

export async function fillComposer(page: Page, text: string): Promise<void> {
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

export async function clickSend(page: Page): Promise<void> {
  await page.locator("button.send-button").click();
}

export async function approveBashIfPresent(page: Page): Promise<number> {
  const approveButton = page
    .locator(
      [
        ".bash-approval-dock-shell button.bash-approval-option-row",
        ".bash-approval-panel button.bash-approval-option-row",
      ].join(", "),
    )
    .filter({ hasText: /^是$/ })
    .first();
  if ((await approveButton.count()) === 0) {
    return 0;
  }
  try {
    await approveButton.click({ timeout: 500 });
    return 1;
  } catch {
    return 0;
  }
}

export async function readFeedLoadingState(page: Page) {
  return page.evaluate(() => ({
    elapsedAt: new Date().toISOString(),
    inlineLoading: document.querySelectorAll(".run-log-inline-loading").length,
    inlineDots: Array.from(document.querySelectorAll(".run-log-inline-loading"))
      .map((node) => node.textContent ?? "")
      .join("|"),
    runningActionNodes: document.querySelectorAll(
      ".run-log-action-trigger.is-running, .run-log-tool-group-trigger.is-running",
    ).length,
    latestActions: Array.from(
      document.querySelectorAll(
        [
          ".run-log-action-trigger",
          ".run-log-tool-group-trigger",
          ".run-log-action",
          ".run-log-bash-card",
          ".run-log-file-change-card",
        ].join(", "),
      ),
    )
      .slice(-5)
      .map((node) => ({
        className: String(node.className ?? ""),
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      })),
  }));
}
