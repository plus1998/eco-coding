/**
 * E2E: account lifecycle → codex app-server cold restart (feature branch fixes).
 *
 *   ECO_DEV_CDP_URL=http://127.0.0.1:9335 bun scripts/dev-cdp-account-restart-smoke.mjs
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9335";
const log = (m) => console.log(`[account-e2e] ${m}`);

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes("127.0.0.1:5173"));
if (!page) {
  console.error("[account-e2e] FATAL: no page on CDP");
  process.exit(1);
}
await page.bringToFront();

// 1) Initialize the account service — this is what sets the proxy getter.
//    (Old code: getter threw TypeError on every later app-server start.)
const active = await page.evaluate(() => window.eco.openAIAccountsGetActive());
const activeId = active?.activeAccountId;
log(`active account: ${activeId ?? "(none)"}`);
if (!activeId) {
  console.error("[account-e2e] FATAL: no active account");
  process.exit(1);
}

// 2) New conversation → send a short turn. This starts the app-server
//    (with the getter already set — the old crash scenario).
await page.getByRole("button", { name: "新对话" }).click();
await page.waitForTimeout(1000);
const composer = page.getByRole("textbox").first();
await composer.waitFor({ timeout: 15000 });
await composer.click();
await composer.type("你好，请只回复：ok");
await page.keyboard.press("Enter");
log("turn1 sent");

const findThread = async () => {
  const list = await page.evaluate(() => window.eco.listThreads());
  return list.find((t) => (t.prompt || "").includes("只回复"));
};
const waitThread = async (threadId, timeoutMs) => {
  const start = Date.now();
  let status;
  while (Date.now() - start < timeoutMs) {
    status = (await page.evaluate((id) => window.eco.getThread(id), threadId))?.status;
    if (status === "idle" || status === "completed" || status === "failed") return status;
    await page.waitForTimeout(1000);
  }
  return status;
};

let threadId = null;
for (let i = 0; i < 20; i++) {
  const t = await findThread();
  if (t) {
    threadId = t.id;
    break;
  }
  await page.waitForTimeout(500);
}
if (!threadId) {
  console.error("[account-e2e] FATAL: new thread not found");
  process.exit(1);
}
log(`thread: ${threadId}`);

const status1 = await waitThread(threadId, 180000);
log(`turn1 status: ${status1}`);

// 3) Deactivate the active account → should idle-wait then cold-restart the app-server.
await page.evaluate(() => window.eco.openAIAccountsSetActive(null));
log("setActive(null) — waiting for idle + cold restart…");
await page.waitForTimeout(20000);

// 4) Reactivate → another credential change → another cold restart.
await page.evaluate((id) => window.eco.openAIAccountsSetActive(id), activeId);
log(`setActive(${activeId}) — waiting for idle + cold restart…`);
await page.waitForTimeout(20000);

// 5) Second turn must succeed after the restart cycles.
await composer.click();
await composer.type("再回复一次：ok2");
await page.keyboard.press("Enter");
log("turn2 sent");
const status2 = await waitThread(threadId, 180000);
log(`turn2 status: ${status2}`);

const ok = status1 === "completed" || status1 === "idle";
const ok2 = status2 === "completed" || status2 === "idle";
log(`RESULT: turn1=${status1} turn2=${status2} ${ok && ok2 ? "PASS" : "CHECK LOGS"}`);
await browser.close();
process.exit(ok && ok2 ? 0 : 1);
