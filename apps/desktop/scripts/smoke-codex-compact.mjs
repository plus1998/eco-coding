import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const threadId = process.env.ECO_SMOKE_THREAD_ID?.trim();
if (!threadId) {
  throw new Error("ECO_SMOKE_THREAD_ID is required.");
}

const browser = await chromium.connectOverCDP(cdpUrl);
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:5174/"));
if (!page) {
  throw new Error("No Eco Electron page is available through CDP.");
}

const result = await page.evaluate(async (ecoThreadId) => {
  const before = await window.eco.listUsageLedgerEvents(ecoThreadId);
  const compact = await window.eco.compactThreadContext(ecoThreadId);
  const after = await window.eco.listUsageLedgerEvents(ecoThreadId);
  return {
    compact,
    beforeCount: before.length,
    afterCount: after.length,
    newEvents: after.slice(before.length),
  };
}, threadId);

console.log(JSON.stringify(result, null, 2));
await browser.close();
