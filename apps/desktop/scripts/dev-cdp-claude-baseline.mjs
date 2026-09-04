/**
 * Claude baseline: hello without Creative Drawing, then with it.
 * ECO_DEV_CDP_URL=http://127.0.0.1:9334 bun scripts/dev-cdp-claude-baseline.mjs
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9334";
const MARKER = `CLAUDEBASE${Date.now().toString(36).toUpperCase()}`;

async function selectCore(page, core) {
  const trigger = page.getByRole("button", { name: /当前 Core/ });
  await trigger.click({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const picked = await page.evaluate((kind) => {
    const menu = document.querySelector(".sidebar-core-menu");
    const items = [...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])];
    const match = items.find((el) => (el.textContent || "").toLowerCase().includes(kind));
    if (!match) return { ok: false, items: items.map((i) => (i.textContent || "").trim()) };
    match.click();
    return { ok: true, label: (match.textContent || "").trim() };
  }, core);
  if (!picked.ok) throw new Error(`selectCore failed ${JSON.stringify(picked)}`);
  await page.waitForTimeout(500);
}

async function setCreativeDrawing(page, enabled) {
  await page.getByRole("button", { name: /配置会话集成/ }).click({ timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const toggle = page.getByText(/创意绘画|Creative Drawing/).first();
  if (!(await toggle.isVisible().catch(() => false))) {
    await page.keyboard.press("Escape").catch(() => undefined);
    return { ok: false, reason: "toggle_missing" };
  }
  const row = toggle.locator("xpath=ancestor::*[self::label or self::div][1]");
  const isOn =
    (await row.locator('input[type="checkbox"]:checked, [aria-checked="true"]').count()) > 0 ||
    (await page.evaluate(() => {
      const labels = [...document.querySelectorAll("label,div,span")].filter((el) =>
        /创意绘画|Creative Drawing/.test(el.textContent || ""),
      );
      for (const el of labels) {
        const input = el.querySelector?.("input[type=checkbox]") || el.closest("label")?.querySelector("input");
        if (input) return input.checked;
      }
      return null;
    }));
  if (enabled && !isOn) await toggle.click();
  if (!enabled && isOn) await toggle.click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape").catch(() => undefined);
  return { ok: true, wanted: enabled, wasOn: isOn };
}

async function newThread(page) {
  const before = await page.evaluate(async () => ((await window.eco.listThreads?.()) ?? []).map((t) => t.id));
  const btn = page.getByRole("button", { name: /新对话|New chat|新建对话/ }).first();
  await btn.click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  return before;
}

async function send(page, text) {
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await composer.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(text);
  await page.waitForTimeout(200);
  const sendBtn = page.getByRole("button", { name: "发送" });
  if (await sendBtn.isEnabled()) await sendBtn.click();
  else await page.keyboard.press("Enter");
}

async function waitThread(page, before, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(
      async ({ beforeIds, m }) => {
        const threads = (await window.eco.listThreads?.()) ?? [];
        return (
          [...threads]
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
            .find((t) => !beforeIds.includes(t.id) && t.prompt?.includes(m)) ?? null
        );
      },
      { beforeIds: before, m: marker },
    );
    if (hit) return hit;
    await page.waitForTimeout(800);
  }
  throw new Error(`thread for ${marker} not found`);
}

async function pollStatus(page, threadId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(async (tid) => {
      const t = ((await window.eco.listThreads?.()) ?? []).find((x) => x.id === tid);
      const events = (await window.eco.getThreadEvents?.(tid)) ?? [];
      const tail = events.slice(-8).map((e) => ({
        type: e.type || e.eventType,
        message: String(e.message || "").slice(0, 180),
        status: e.status,
      }));
      return {
        status: t?.status,
        message: String(t?.message || "").slice(0, 240),
        tail,
      };
    }, threadId);
    console.log(`[claude-base] ${threadId} status=${last.status} msg=${last.message}`);
    if (["completed", "idle", "failed", "error", "cancelled"].includes(String(last.status))) {
      return last;
    }
    // ENAMETOOLONG often lands in message while still "running" briefly
    if (/ENAMETOOLONG|spawn|blocked/i.test(last.message + JSON.stringify(last.tail))) {
      return last;
    }
    await page.waitForTimeout(1500);
  }
  return last;
}

async function runCase(page, { name, drawingEnabled, prompt }) {
  console.log(`\n=== CASE ${name} drawing=${drawingEnabled} ===`);
  await selectCore(page, "claude");
  const drawing = await setCreativeDrawing(page, drawingEnabled);
  console.log("[claude-base] drawing toggle", drawing);
  const before = await newThread(page);
  await send(page, prompt);
  const thread = await waitThread(page, before, prompt.slice(0, 24), 60_000);
  console.log(`[claude-base] thread ${thread.id}`);
  const result = await pollStatus(page, thread.id, 90_000);
  return { name, threadId: thread.id, drawing, result };
}

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error("no page");
await page.bringToFront();

const results = [];
results.push(
  await runCase(page, {
    name: "no-drawing-hello",
    drawingEnabled: false,
    prompt: `${MARKER}-NO-DRAW reply exactly: CLAUDE_OK_NODRAW`,
  }),
);
results.push(
  await runCase(page, {
    name: "with-drawing-hello",
    drawingEnabled: true,
    prompt: `${MARKER}-WITH-DRAW reply exactly: CLAUDE_OK_WITHDRAW (do not call tools)`,
  }),
);

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
await browser.close().catch(() => undefined);
process.exit(0);
