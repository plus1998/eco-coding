import { chromium } from "@playwright/test";
import { browserAgentSessionKey } from "../src/shared/browser.ts";
import { runAgentBrowser } from "./agent-browser-cli.mjs";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9344";
const marker = `CLICK_${Date.now()}`;
const fillText = `FILL_${marker}`;

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages().find((p) => p.url().includes("5173"));
const tid = (await page.evaluate(() => window.eco.listThreads()))[0]?.id;
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
}, `COMP_${marker}`);

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
    break;
  }
  await page.waitForTimeout(400);
}
if (!textboxRef) throw new Error("no textbox ref");

const click = runAgentBrowser(["click", textboxRef], env);
console.log("click ok", click.ok, click.stderr?.slice(0, 200) ?? "");
const fill = runAgentBrowser(["fill", textboxRef, fillText], env);
console.log("fill ok", fill.ok, fill.stderr?.slice(0, 200) ?? "");
const c1 = await composer.evaluate((n) => (n.textContent ?? "").trim());
const field = runAgentBrowser(["eval", "document.querySelector('#field')?.value ?? ''"], env).stdout.trim();
console.log("composer", JSON.stringify(c1));
console.log("field", JSON.stringify(field));
console.log("leak", c1.includes(fillText), "field ok", field.includes(fillText));
await browser.close();
