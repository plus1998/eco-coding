import { chromium } from "@playwright/test";
import { browserAgentSessionKey } from "../src/shared/browser.ts";
import { runAgentBrowser } from "./agent-browser-cli.mjs";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9344";
const marker = process.env.ECO_SMOKE_MARKER ?? `FOCUS_RETRY_${Date.now()}`;
const fillText = `FILL_${marker}`;
const typeText = `TYPE_${marker}`;
const composerSeed = `COMPOSER_${marker}`;

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages().find((p) => p.url().includes("5173"));
if (!page) throw new Error("no eco page");

const threads = await page.evaluate(async () => window.eco.listThreads());
const threadId = threads[0]?.id;
if (!threadId) throw new Error("no thread");

const html = `<!doctype html><html><body><h1>${marker}</h1><input id="field" type="text" /></body></html>`;
const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

await page.evaluate(
  async ({ url, tid }) => {
    await window.eco.saveBrowserSettings({
      agentIntegrationEnabled: true,
      openApprovalMode: "always_allow",
    });
    await window.eco.browserOpen({ url, reveal: false, threadId: tid, newBrowser: true });
  },
  { url: dataUrl, tid: threadId },
);

const taskBtn = page.locator(".codex-main-toolbar-button[aria-controls='task-panel']").first();
if ((await taskBtn.getAttribute("aria-expanded")) === "true") {
  await taskBtn.click();
  await page.waitForTimeout(600);
}

const composer = page.locator(".composer-skill-input-control[role='textbox']").first();
await composer.evaluate((node, seed) => {
  node.focus();
  node.textContent = seed;
  node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: seed }));
}, composerSeed);

const prepared = await page.evaluate(async (tid) => window.eco.browserDevPrepareAgentCdp(tid), threadId);
const cdpPort = prepared.cdpPort;
const sessionKey = browserAgentSessionKey(threadId);
const abEnv = { AGENT_BROWSER_CDP: String(cdpPort), AGENT_BROWSER_SESSION: sessionKey };

let ref = null;
for (let i = 0; i < 30; i++) {
  const state = await page.evaluate(async () => window.eco.getBrowserState());
  const snap = runAgentBrowser(["snapshot", "--interactive"], abEnv);
  const m = snap.stdout.match(/ref=e(\d+)/);
  console.log(
    `[retry ${i}] instances=${state.instances?.length} guests=${state.guestInstances?.length} snapOk=${snap.ok} hasRef=${Boolean(m)}`,
  );
  if (m) {
    ref = `@e${m[1]}`;
    break;
  }
  await page.waitForTimeout(500);
}
if (!ref) throw new Error("no ref after waits");

console.log(`[probe] ref=${ref} cdpPort=${cdpPort}`);

const fill = runAgentBrowser(["fill", ref, fillText], abEnv);
console.log(`[probe] fill ok=${fill.ok}`);
const composerAfterFill = await composer.evaluate((n) => (n.textContent ?? "").trim());
console.log(`[probe] composer after fill: ${JSON.stringify(composerAfterFill)}`);

const type = runAgentBrowser(["type", ref, typeText], abEnv);
console.log(`[probe] type ok=${type.ok}`);
await page.waitForTimeout(300);
const composerAfterType = await composer.evaluate((n) => (n.textContent ?? "").trim());
console.log(`[probe] composer after type: ${JSON.stringify(composerAfterType)}`);

const evalField = runAgentBrowser(["eval", "document.querySelector('#field')?.value ?? ''"], abEnv);
const fieldValue = evalField.ok ? evalField.stdout.trim() : "";
console.log(`[probe] field value: ${JSON.stringify(fieldValue)}`);

console.log("\n=== RESULT ===");
console.log("composer leaked fill:", composerAfterFill.includes(fillText));
console.log("composer leaked type:", composerAfterType.includes(typeText));
console.log("field has fill:", fieldValue.includes(fillText));
console.log("field has type:", fieldValue.includes(typeText));

await browser.close();
