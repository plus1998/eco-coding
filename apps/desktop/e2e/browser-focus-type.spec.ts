import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browserAgentSessionKey } from "../src/shared/browser";
import { runAgentBrowser } from "../scripts/agent-browser-cli.mjs";
import { expect, test } from "./fixtures/electron-app";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("background browser fill/type does not leak into Composer", async ({ ecoPage: page }) => {
  test.setTimeout(Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "120000", 10));

  const marker = `FOCUS_TYPE_${Date.now()}`;
  const fillText = `FILL_${marker}`;
  const typeText = `TYPE_${marker}`;
  const composerSeed = `COMPOSER_${marker}`;
  const outDir = path.join(desktopRoot, ".smoke-artifacts", marker);
  mkdirSync(outDir, { recursive: true });

  await page.waitForFunction(() => typeof window.eco?.saveBrowserSettings === "function");

  const newConversation = page.locator("button.sidebar-action").filter({ hasText: /新对话|New conversation/i });
  if ((await newConversation.count()) > 0) {
    await newConversation.first().click();
    await page.waitForTimeout(800);
  }

  await page.evaluate(async () => {
    await window.eco.saveBrowserSettings({
      agentIntegrationEnabled: true,
      openApprovalMode: "always_allow",
    });
  });

  const threads = await page.evaluate(async () => window.eco.listThreads());
  const threadId = threads[0]?.id;
  expect(threadId, "need at least one thread — send a message from landing first").toBeTruthy();

  const html = `<!doctype html><html><body>
    <h1>${marker}</h1>
    <input id="field" type="text" value="" />
  </body></html>`;
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

  await page.evaluate(
    async ({ url, tid }) => {
      await window.eco.browserOpen({ url, reveal: false, threadId: tid, newBrowser: true });
    },
    { url: dataUrl, tid: threadId! },
  );
  await page.waitForTimeout(1200);

  const taskBtn = page.locator(".codex-main-toolbar-button[aria-controls='task-panel']").first();
  if ((await taskBtn.getAttribute("aria-expanded")) === "true") {
    await taskBtn.click();
    await page.waitForTimeout(600);
  }

  const composer = page.locator(".composer-skill-input-control[role='textbox']").first();
  await composer.waitFor({ state: "visible" });
  await composer.evaluate((node, seed) => {
    node.focus();
    node.textContent = "";
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, seed);
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: seed }));
  }, composerSeed);

  const prepared = await page.evaluate(async (tid) => {
    if (typeof window.eco.browserDevPrepareAgentCdp !== "function") {
      return null;
    }
    return window.eco.browserDevPrepareAgentCdp(tid);
  }, threadId!);
  expect(prepared?.cdpPort, "browserDevPrepareAgentCdp must return cdpPort").toBeGreaterThan(0);

  const cdpPort = prepared!.cdpPort;
  const sessionKey = browserAgentSessionKey(threadId!);
  const abEnv = { AGENT_BROWSER_CDP: String(cdpPort), AGENT_BROWSER_SESSION: sessionKey };

  const snap = runAgentBrowser(["snapshot", "--interactive"], abEnv);
  expect(snap.ok, snap.stderr || snap.stdout).toBe(true);
  writeFileSync(path.join(outDir, "snapshot.txt"), snap.stdout);

  const refMatch = snap.stdout.match(/@e\d+/);
  expect(refMatch, "snapshot should contain @e ref").toBeTruthy();
  const ref = refMatch![0];

  const fill = runAgentBrowser(["fill", ref, fillText], abEnv);
  expect(fill.ok, fill.stderr || fill.stdout).toBe(true);

  const composerAfterFill = await composer.evaluate((node) =>
    (node.textContent ?? "").replace(/\u200b/g, "").trim(),
  );
  console.log(`[focus-type-e2e] composer after fill: ${composerAfterFill}`);

  const type = runAgentBrowser(["type", ref, typeText], abEnv);
  expect(type.ok, type.stderr || type.stdout).toBe(true);

  await page.waitForTimeout(300);
  const composerAfterType = await composer.evaluate((node) =>
    (node.textContent ?? "").replace(/\u200b/g, "").trim(),
  );
  console.log(`[focus-type-e2e] composer after type: ${composerAfterType}`);

  const evalField = runAgentBrowser(
    ["eval", "document.querySelector('#field')?.value ?? ''"],
    abEnv,
  );
  const fieldValue = evalField.ok ? evalField.stdout.trim() : "";
  console.log(`[focus-type-e2e] webview field: ${fieldValue}`);

  const report = {
    marker,
    threadId,
    cdpPort,
    ref,
    composerSeed,
    composerAfterFill,
    composerAfterType,
    fieldValue,
    composerLeakedFill: composerAfterFill.includes(fillText),
    composerLeakedType: composerAfterType.includes(typeText),
    fieldHasFill: fieldValue.includes(fillText),
    fieldHasType: fieldValue.includes(typeText),
  };
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  expect(composerAfterFill.includes(fillText), "fill text leaked into Composer").toBe(false);
  expect(composerAfterType.includes(typeText), "type text leaked into Composer").toBe(false);
  expect(
    fieldValue.includes(fillText) || fieldValue.includes(typeText),
    "fill/type should reach webview input",
  ).toBe(true);
});
