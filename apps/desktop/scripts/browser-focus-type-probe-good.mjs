import { chromium } from "@playwright/test";
import { browserAgentSessionKey } from "../src/shared/browser.ts";
import { runAgentBrowser } from "./agent-browser-cli.mjs";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9344";
const marker = `GOOD_${Date.now()}`;
const fillText = `FILL_${marker}`;
const typeText = `TYPE_${marker}`;
const seed = `COMP_${marker}`;

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages().find((p) => p.url().includes("5173"));
const tid = (await page.evaluate(() => window.eco.listThreads()))[0]?.id;
if (!tid) throw new Error("no thread");

const url =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    "<!doctype html><html><body><h1>probe</h1><input id=field type=text /></body></html>",
  );
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

let textboxRef = null;
for (let i = 0; i < 30; i++) {
  const snap = runAgentBrowser(["snapshot", "--interactive"], env);
  const m = snap.stdout.match(/textbox.*\[ref=e(\d+)\]/);
  if (m) {
    textboxRef = `@e${m[1]}`;
    console.log(`[wait ${i}] found textbox ${textboxRef}`);
    break;
  }
  await page.waitForTimeout(400);
}
if (!textboxRef) throw new Error("no textbox ref");

const fill = runAgentBrowser(["fill", textboxRef, fillText], env);
console.log("fill ok", fill.ok, fill.stderr?.slice(0, 120) ?? "");
const c1 = await composer.evaluate((n) => (n.textContent ?? "").trim());
console.log("composer after fill", JSON.stringify(c1));

const type = runAgentBrowser(["type", textboxRef, typeText], env);
console.log("type ok", type.ok, type.stderr?.slice(0, 120) ?? "");
await page.waitForTimeout(300);
const c2 = await composer.evaluate((n) => (n.textContent ?? "").trim());
const field = runAgentBrowser(["eval", "document.querySelector('#field')?.value ?? ''"], env).stdout.trim();
console.log("composer after type", JSON.stringify(c2));
console.log("field", JSON.stringify(field));
console.log("=== leak fill", c1.includes(fillText), "leak type", c2.includes(typeText));
console.log("=== field fill", field.includes(fillText), "field type", field.includes(typeText));
await browser.close();
