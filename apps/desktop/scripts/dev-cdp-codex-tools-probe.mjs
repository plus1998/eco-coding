/**
 * Probe: does Codex see create_image when Creative Drawing is on?
 * ECO_DEV_CDP_URL=http://127.0.0.1:9334 bun scripts/dev-cdp-codex-tools-probe.mjs
 */
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL?.trim() || "http://127.0.0.1:9334";
const MARKER = `TOOLPROBE${Date.now().toString(36).toUpperCase()}`;

async function goHome(page) {
  await page.getByRole("button", { name: /新对话/ }).click({ timeout: 10_000 });
  await page.waitForTimeout(700);
}

async function selectCodex(page) {
  await goHome(page);
  await page.getByRole("button", { name: /当前 Core/ }).click({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await page.getByRole("menuitemradio", { name: /Codex/i }).click();
  await page.waitForTimeout(500);
}

async function setDrawing(page, on) {
  await page.getByRole("button", { name: /配置会话集成/ }).click({ timeout: 10_000 });
  await page.waitForTimeout(400);
  const state = await page.evaluate((want) => {
    const dialog = document.querySelector("dialog, [role='dialog']");
    const boxes = [...(dialog?.querySelectorAll('input[type="checkbox"]') ?? [])];
    const drawing = boxes.find((b) => (b.getAttribute("aria-label") || "") === "创意绘画");
    if (!drawing) return { ok: false };
    if (drawing.checked !== want) drawing.click();
    return { ok: true, checked: drawing.checked };
  }, on);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  console.log("[probe] drawing", state);
}

async function send(page, prompt) {
  const before = await page.evaluate(async () => ((await window.eco.listThreads?.()) ?? []).map((t) => t.id));
  const composer = page.locator('[role="textbox"]').first();
  await composer.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(200);
  const sendBtn = page.getByRole("button", { name: "发送" });
  if (await sendBtn.isEnabled()) await sendBtn.click();
  else await page.keyboard.press("Enter");
  const deadline = Date.now() + 60_000;
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
      { beforeIds: before, m: MARKER },
    );
    if (hit) return hit;
    await page.waitForTimeout(500);
  }
  throw new Error("no thread");
}

const browser = await chromium.connectOverCDP(cdpUrl);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error("no page");
await page.bringToFront();

await selectCodex(page);
await setDrawing(page, true);

const prompt = [
  `${MARKER}`,
  "Do not call any tools.",
  "Reply with exactly two lines:",
  "HAS_CREATE_IMAGE=yes|no",
  "IMAGE_TOOLS=<comma-separated exact MCP tool names you can call that contain image or create_image>",
].join("\n");

const thread = await send(page, prompt);
console.log("[probe] thread", thread.id, thread.coreKind);

const deadline = Date.now() + 180_000;
let last = null;
while (Date.now() < deadline) {
  const pending = await page.evaluate(async (tid) => (await window.eco.getPendingBashApproval?.(tid)) ?? null, thread.id);
  if (pending?.toolUseId) {
    await page.evaluate(
      async ({ toolUseId }) => window.eco.resolveBashApproval?.({ toolUseId, decision: "approved" }),
      { toolUseId: pending.toolUseId },
    );
  }
  last = await page.evaluate(async ({ tid, marker }) => {
    const t = ((await window.eco.listThreads?.()) ?? []).find((x) => x.id === tid);
    let integ = null;
    try {
      integ = JSON.parse(t?.runtimeConfigJson || "{}").integrationsEnabled;
    } catch {
      /* */
    }
    const feed = document.querySelector(".codex-feed-stack")?.innerText || "";
    const after = feed.includes(marker) ? feed.slice(feed.indexOf(marker) + marker.length) : feed;
    return {
      status: t?.status,
      message: String(t?.message || "").slice(0, 200),
      integrations: integ,
      hasCreateLine: /HAS_CREATE_IMAGE=(yes|no)/i.test(after),
      hasCreateYes: /HAS_CREATE_IMAGE=yes/i.test(after),
      hasCreateNo: /HAS_CREATE_IMAGE=no/i.test(after),
      mentionsCreate: /create_image/i.test(after),
      mentionsNotAvailable: /not available|不可用|没有|unavailable/i.test(after),
      tail: after.slice(-700),
    };
  }, { tid: thread.id, marker: MARKER });
  console.log("[probe]", JSON.stringify({ status: last.status, hasCreateLine: last.hasCreateLine, hasCreateYes: last.hasCreateYes, hasCreateNo: last.hasCreateNo, integrations: last.integrations }));
  if (last.hasCreateLine || (["completed", "idle", "failed", "blocked"].includes(String(last.status)) && last.tail.length > 50)) {
    break;
  }
  await page.waitForTimeout(2000);
}

console.log("\n=== PROBE RESULT ===");
console.log(JSON.stringify(last, null, 2));
await browser.close().catch(() => undefined);
process.exit(last?.hasCreateYes ? 0 : 2);
