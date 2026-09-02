/**
 * Quick CDP check: one short turn (no tools) + ledger generationMs validation.
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9333";
const MARKER = process.env.ECO_SMOKE_MARKER?.trim() || `Q${Date.now().toString(36).toUpperCase()}`;
const TIMEOUT_MS = Number.parseInt(process.env.ECO_TOKEN_SPEED_SMOKE_TIMEOUT_MS ?? "180000", 10);
const dbPath = `${process.env.APPDATA}/@eco/desktopDev/eco-coding.sqlite`;

function parseRateTps(text) {
  const m = text.match(/~?(\d+(?:\.\d+)?)\s*tok\/s/);
  return m ? Number.parseFloat(m[1]) : undefined;
}

function isFinalBadgeText(text) {
  const t = text.trim();
  return t.includes("首字") && /tok\/s/.test(t);
}

function readLedger(threadId) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  return db
    .prepare(
      "SELECT provider_request_id, output_tokens, metadata_json FROM thread_usage_ledger_events WHERE thread_id = ? ORDER BY observed_at DESC LIMIT 20",
    )
    .all(threadId)
    .map((row) => {
      const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      return {
        providerRequestId: row.provider_request_id,
        outputTokens: row.output_tokens,
        generationMs: meta.generationMs,
        logicalRequestId: meta.logicalRequestId,
      };
    });
}

const browser = await chromium.connectOverCDP(cdpUrl);
const results = { marker: MARKER, threadId: null, badges: [], ledger: [], projectionSpans: [], pass: false };

try {
  const page = browser.contexts()[0]?.pages().find((p) => p.url().includes("5173")) ?? browser.contexts()[0]?.pages()[0];
  if (!page) throw new Error("No CDP page");

  await page.evaluate(() => {
    localStorage.setItem("eco.token-speed-preferences", JSON.stringify({ showTokenSpeed: true }));
    window.dispatchEvent(new CustomEvent("eco:token-speed-change", { detail: { showTokenSpeed: true } }));
  });

  const before = await page.evaluate(async () => (await window.eco.listThreads?.())?.map((t) => t.id) ?? []);

  const prompt = `Reply with exactly one line and nothing else: QUICK_DONE:${MARKER}`;
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await composer.fill(prompt);
  await page.getByRole("button", { name: "发送" }).click({ timeout: 8000 }).catch(() => page.keyboard.press("Enter"));

  const started = Date.now();
  let threadId = null;
  while (Date.now() - started < 60_000) {
    const hit = await page.evaluate(
      async ({ beforeIds, marker }) => {
        const threads = await window.eco.listThreads?.();
        if (!threads?.length) return null;
        const sorted = [...threads].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const fresh = sorted.find((t) => !beforeIds.includes(t.id));
        if (fresh) return fresh.id;
        const marked = sorted.find((t) => t.prompt?.includes(marker) || t.title?.includes(marker));
        return marked?.id ?? null;
      },
      { beforeIds: before, marker: MARKER },
    );
    if (hit) {
      threadId = hit;
      break;
    }
    await page.waitForTimeout(400);
  }
  if (!threadId) throw new Error("Thread not found");
  results.threadId = threadId;

  await page.waitForFunction(
    async ({ tid, marker }) => {
      const proj = await window.eco.getThreadRunProjection?.({ threadId: tid, mode: "feed" });
      if (!proj) return false;
      for (const item of proj.timeline ?? []) {
        if (item.eventType === "message.final" && item.text?.includes(marker)) return true;
      }
      for (const agent of proj.agents ?? []) {
        for (const item of agent.timeline ?? []) {
          if (item.eventType === "message.final" && item.text?.includes(marker)) return true;
        }
      }
      return false;
    },
    { tid: threadId, marker: `QUICK_DONE:${MARKER}` },
    { timeout: TIMEOUT_MS },
  );

  await page.waitForFunction(
    async (tid) => {
      const t = await window.eco.getThread?.(tid);
      return t && t.status !== "running" && t.status !== "queued";
    },
    threadId,
    { timeout: TIMEOUT_MS },
  );

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    results.ledger = readLedger(threadId);
    if (results.ledger.some((r) => typeof r.generationMs === "number" && r.generationMs > 0)) {
      break;
    }
    await page.waitForTimeout(500);
  }

  await page.evaluate(() => {
    const feed = document.querySelector(".run-log");
    if (feed) feed.scrollTop = feed.scrollHeight;
  });
  await page.waitForTimeout(2000);

  results.badges = (await page.locator(".run-log-token-speed").allTextContents()).map((s) => s.trim()).filter(Boolean);

  const projection = await page.evaluate(async (tid) => {
    const proj = await window.eco.getThreadRunProjection?.({ threadId: tid, mode: "feed" });
    return (proj?.requestSpans ?? []).map((s) => ({
      status: s.status,
      outputTokens: s.outputTokens,
      reasoningTokens: s.reasoningTokens,
      generationMs: s.generationMs,
    }));
  }, threadId);
  results.projectionSpans = projection;

  const finalBadges = results.badges.filter(isFinalBadgeText);
  const withGenerationMs = results.ledger.filter((r) => typeof r.generationMs === "number" && r.generationMs > 0);
  const insane = finalBadges.filter((b) => {
    const rate = parseRateTps(b);
    return rate !== undefined && rate > 2000;
  });

  results.pass =
    withGenerationMs.length >= 1 &&
    withGenerationMs.some((r) => r.logicalRequestId) &&
    insane.length === 0 &&
    (finalBadges.length >= 1 || withGenerationMs.length >= 1);

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.pass ? 0 : 1);
} catch (error) {
  console.error(error);
  console.log(JSON.stringify(results, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
