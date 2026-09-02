import { chromium } from "@playwright/test";
import { browserAgentSessionKey } from "../src/shared/browser.ts";
import { runAgentBrowser } from "./agent-browser-cli.mjs";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9344";
const marker = `E2TEST_${Date.now()}`;
const fillText = `FILL_${marker}`;
const typeText = `TYPE_${marker}`;
const seed = `COMP_${marker}`;

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages().find((p) => p.url().includes("5173"));
const tid = (await page.evaluate(() => window.eco.listThreads()))[0]?.id;
if (!tid) throw new Error("no thread");

const url =
  "data:text/html;charset=utf-8," +
  encodeURIComponent("<!doctype html><html><body><input id=field type=text /></body></html>");
await page.evaluate(
  async ({ url, tid }) => window.eco.browserOpen({ url, reveal: false, threadId: tid, newBrowser: true }),
  { url, tid },
);

const btn = page.locator(".codex-main-toolbar-button[aria-controls=task-panel]").first();
if ((await btn.getAttribute("aria-expanded")) === "true") await btn.click();

const composer = page.locator(".composer-skill-input-control[role=textbox]").first();
await composer.evaluate((n, s) => {
  n.focus();
  n.textContent = s;
  n.dispatchEvent(new InputEvent("input", { bubbles: true, data: s, inputType: "insertText" }));
}, seed);

const prep = await page.evaluate((t) => window.eco.browserDevPrepareAgentCdp(t), tid);
const env = {
  AGENT_BROWSER_CDP: String(prep.cdpPort),
  AGENT_BROWSER_SESSION: browserAgentSessionKey(tid),
};

const snap = runAgentBrowser(["snapshot", "--interactive"], env);
console.log("snapshot head:", snap.stdout.slice(0, 400));

const ref = "@e2";
console.log("using ref", ref);
console.log("fill ok", runAgentBrowser(["fill", ref, fillText], env).ok);
const c1 = await composer.evaluate((n) => (n.textContent ?? "").trim());
console.log("composer after fill", JSON.stringify(c1));
console.log("type ok", runAgentBrowser(["type", ref, typeText], env).ok);
await page.waitForTimeout(300);
const c2 = await composer.evaluate((n) => (n.textContent ?? "").trim());
const field = runAgentBrowser(["eval", "document.querySelector('#field')?.value ?? ''"], env).stdout.trim();
console.log("composer after type", JSON.stringify(c2));
console.log("field", JSON.stringify(field));
console.log("leak fill", c1.includes(fillText), "leak type", c2.includes(typeText));
console.log("field ok", field.includes(fillText) || field.includes(typeText));
await browser.close();
