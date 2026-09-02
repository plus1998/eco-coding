/**
 * CDP smoke: multi-step tool scenario + follow-ups + Token 速度统计 validation.
 *
 *   bun run smoke:cdp-token-speed
 *   ECO_TOKEN_SPEED_SMOKE_TIMEOUT_MS=900000 bun run smoke:cdp-token-speed
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9333";
const TOKEN_SPEED_KEY = "eco.token-speed-preferences";
const TOKEN_SPEED_EVENT = "eco:token-speed-change";
const TIMEOUT_MS = Number.parseInt(process.env.ECO_TOKEN_SPEED_SMOKE_TIMEOUT_MS ?? "600000", 10);
const MARKER = process.env.ECO_SMOKE_MARKER?.trim() || `TS${Date.now().toString(36).toUpperCase()}`;

mkdirSync(".smoke-artifacts", { recursive: true });

/** Workspace-agnostic multi-step prompt (tools, no special MCP/skill setup). */
function buildTokenSpeedScenarioPrompt(marker) {
  return [
    `Eco token-speed CDP smoke. Marker=${marker}. Complete EVERY step in order using tools. Be concise between steps.`,
    "",
    "1) LIST: List files in the workspace root directory.",
    "2) READ: Read apps/desktop/package.json (first 40 lines is enough) and note the package name.",
    "3) WRITE: Create token-speed-smoke.txt in the workspace root with exactly one line:",
    `SMOKE_FILE:${marker}`,
    "4) READ BACK: Read token-speed-smoke.txt and confirm the line matches.",
    "5) FINAL: Reply with a single line exactly:",
    `SMOKE_DONE:${marker}`,
    "",
    "Do not skip steps. Use tools instead of guessing file contents.",
  ].join("\n");
}

function buildFollowUpPrompt(marker, index) {
  const lines = [
    `Follow-up ${index} for marker=${marker}. Use tools where useful.`,
    index === 1
      ? "Read apps/desktop/package.json and summarize scripts.dev and scripts.smoke:cdp-token-speed in 2-3 sentences."
      : "Read token-speed-smoke.txt again, then write a 120+ word plain-text paragraph explaining what files you touched during this smoke.",
    `End your reply with exactly: FOLLOWUP${index}_DONE:${marker}`,
  ];
  return lines.join("\n");
}

const browser = await chromium.connectOverCDP(cdpUrl);
const results = { marker: MARKER, steps: [], pass: false, badges: [], spanStats: [], threadId: null };

function step(name, ok, detail) {
  results.steps.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
  console.log(`[token-speed-smoke] ${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? `: ${detail}` : ""}`);
}

function parseMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

function parseRateTps(text) {
  const m = text.match(/~?(\d+(?:\.\d+)?)\s*tok\/s/);
  return m ? Number.parseFloat(m[1]) : undefined;
}

function spanDecodeMs(span) {
  const end = span.lastTokenAt ?? span.streamingEndedAt ?? span.endedAt;
  if (!span.firstTokenAt || !end) return undefined;
  const a = parseMs(span.firstTokenAt);
  const b = parseMs(end);
  if (a === undefined || b === undefined || b <= a) return undefined;
  return b - a;
}

function isFinalBadgeText(text) {
  const t = text.trim();
  if (!t || t.startsWith("等待首字")) return false;
  return t.includes("首字") && /tok\/s/.test(t);
}

async function readBadges(page) {
  return page.locator(".run-log-token-speed").allTextContents().then((rows) => rows.map((s) => s.trim()).filter(Boolean));
}

async function listThreadIds(page) {
  return page.evaluate(async () => (await window.eco.listThreads?.())?.map((t) => t.id) ?? []);
}

async function waitForNewThread(page, beforeIds, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(
      async ({ beforeIds: prev, marker: m }) => {
        const threads = await window.eco.listThreads?.();
        if (!threads?.length) return null;
        const sorted = [...threads].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const fresh = sorted.find((t) => !prev.includes(t.id));
        if (fresh) return { id: fresh.id, prompt: fresh.prompt?.slice(0, 80) };
        const marked = sorted.find((t) => t.prompt?.includes(m) || t.title?.includes(m));
        return marked ? { id: marked.id, prompt: marked.prompt?.slice(0, 80) } : null;
      },
      { beforeIds, marker },
    );
    if (hit?.id) return hit;
    await page.waitForTimeout(400);
  }
  throw new Error(`No new thread for marker=${marker} within ${timeoutMs}ms`);
}

async function waitForThreadRunning(page, threadId, timeoutMs) {
  await page.waitForFunction(
    async (tid) => {
      const t = await window.eco.getThread?.(tid);
      return t?.status === "running" || t?.status === "queued";
    },
    threadId,
    { timeout: timeoutMs },
  );
}

async function waitForAssistantMarker(page, threadId, marker, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await page.evaluate(
      async ({ tid, marker: m }) => {
        const proj = await window.eco.getThreadRunProjection?.({ threadId: tid, mode: "feed" });
        if (!proj) return null;
        const collect = [];
        for (const item of proj.timeline ?? []) {
          if (item.eventType === "message.final" && item.role !== "user") collect.push(item);
        }
        for (const agent of proj.agents ?? []) {
          for (const item of agent.timeline ?? []) {
            if (item.eventType === "message.final" && item.role !== "user") collect.push(item);
          }
        }
        const match = collect.find((item) => item.text?.includes(m));
        return match ? { tail: match.text.slice(-120), finals: collect.length } : null;
      },
      { tid: threadId, marker },
    );
    if (hit) return hit;
    await page.waitForTimeout(1500);
  }
  throw new Error(`Assistant marker ${marker} not found within ${timeoutMs}ms`);
}

async function waitForThreadIdle(page, threadId, timeoutMs) {
  await page.waitForFunction(
    async (tid) => {
      const t = await window.eco.getThread?.(tid);
      return t && t.status !== "running" && t.status !== "queued";
    },
    threadId,
    { timeout: timeoutMs },
  );
}

async function fetchProjection(page, threadId) {
  return page.evaluate(
    async (tid) => {
      const proj = await window.eco.getThreadRunProjection?.({ threadId: tid, mode: "feed" });
      if (!proj) return null;
      return {
        threadStatus: proj.thread?.status,
        spans: (proj.requestSpans ?? []).map((span) => ({
          requestId: span.requestId?.slice(-12),
          status: span.status,
          role: span.role,
          startedAt: span.startedAt,
          firstTokenAt: span.firstTokenAt,
          streamingEndedAt: span.streamingEndedAt,
          endedAt: span.endedAt,
          outputTokens: span.outputTokens,
        })),
      };
    },
    threadId,
  );
}

async function sendComposerMessage(page, text) {
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 20_000 });
  await composer.click();
  await composer.fill(text);
  const send = page.getByRole("button", { name: "发送" });
  await send.click({ timeout: 8000 }).catch(async () => page.keyboard.press("Enter"));
}

async function enableAutoApprove(page) {
  const toggle = page.locator('.composer-toolbar-trigger[data-mode="always"]').first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    const auto = page.getByRole("button", { name: /替我审批|Auto approve/i });
    if (await auto.isVisible().catch(() => false)) {
      await auto.click();
    }
  }
}

async function runTurn(page, threadId, pattern, label, timeoutMs) {
  const started = Date.now();
  const remaining = () => Math.max(30_000, timeoutMs - (Date.now() - started));
  try {
    await waitForThreadRunning(page, threadId, Math.min(120_000, remaining()));
    step(`${label} thread running`, true);
  } catch {
    step(`${label} thread running`, false, "never entered running/queued");
  }
  const hit = await waitForAssistantMarker(page, threadId, pattern, remaining());
  step(`${label} assistant marker`, true, `${pattern} · finals=${hit.finals}`);
  await waitForThreadIdle(page, threadId, remaining());
  step(`${label} thread idle`, true);
  await page.waitForTimeout(2000);
}

try {
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context from CDP");
  const page = context.pages().find((p) => p.url().includes("5173")) ?? context.pages()[0];
  if (!page) throw new Error("No page from CDP");

  step("cdp page", true, `${page.url()} · ${await page.title()}`);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  step("reload renderer bundle", true);

  await page.evaluate(
    ({ key, eventName }) => {
      localStorage.setItem(key, JSON.stringify({ showTokenSpeed: true }));
      window.dispatchEvent(new CustomEvent(eventName, { detail: { showTokenSpeed: true } }));
    },
    { key: TOKEN_SPEED_KEY, eventName: TOKEN_SPEED_EVENT },
  );
  step("enable token speed preference", true);

  const beforeIds = await listThreadIds(page);

  const newChat = page.getByRole("button", { name: "新对话" });
  if (await newChat.isVisible().catch(() => false)) {
    await newChat.click();
    await page.waitForTimeout(600);
  }
  step("start new conversation", true);

  await enableAutoApprove(page);
  step("enable auto approve", true);

  const scenarioPrompt = buildTokenSpeedScenarioPrompt(MARKER);
  await sendComposerMessage(page, scenarioPrompt);
  step("send multi-step scenario prompt", true, `marker=${MARKER}`);

  const threadHit = await waitForNewThread(page, beforeIds, MARKER, 60_000);
  const threadId = threadHit.id;
  results.threadId = threadId;
  step("resolve thread id", true, `${threadId} · ${threadHit.prompt ?? ""}`);

  const scenarioStarted = Date.now();
  try {
    await runTurn(page, threadId, `SMOKE_DONE:${MARKER}`, "scenario", TIMEOUT_MS);
  } catch (error) {
    step("scenario marker in feed", false, error instanceof Error ? error.message : String(error));
    step("scenario thread idle", false, "skipped");
  }

  // Two follow-ups → more request spans + longer aggregate decode sample.
  for (const index of [1, 2]) {
    const followPattern = `FOLLOWUP${index}_DONE:${MARKER}`;
    const remaining = Math.max(60_000, TIMEOUT_MS - (Date.now() - scenarioStarted));
    try {
      await sendComposerMessage(page, buildFollowUpPrompt(MARKER, index));
      step(`send follow-up ${index}`, true);
      await runTurn(page, threadId, followPattern, `follow-up ${index}`, remaining);
    } catch (error) {
      step(`follow-up ${index}`, false, error instanceof Error ? error.message : String(error));
    }
  }

  await page.evaluate(() => {
    const feed = document.querySelector(".run-log");
    if (feed) feed.scrollTop = feed.scrollHeight;
  });

  const projection = await fetchProjection(page, threadId);
  const spans = projection?.spans ?? [];
  const completed = spans.filter((s) => s.status === "completed" && s.firstTokenAt);
  step("completed request spans", completed.length >= 2, `count=${completed.length}`);

  const decodeStats = completed.map((span) => {
    const decodeMs = spanDecodeMs(span);
    const rate =
      decodeMs && span.outputTokens ? (span.outputTokens * 1000) / decodeMs : undefined;
    return {
      ...span,
      decodeMs,
      rateTps: rate !== undefined ? Math.round(rate * 10) / 10 : undefined,
    };
  });
  results.spanStats = decodeStats;

  const longDecodes = decodeStats.filter((s) => (s.decodeMs ?? 0) >= 800);
  step("spans with decode window >= 800ms", longDecodes.length >= 1, JSON.stringify(longDecodes.slice(0, 5)));

  const tokenHeavy = decodeStats.filter((s) => (s.outputTokens ?? 0) >= 20);
  step("spans with outputTokens >= 20", tokenHeavy.length >= 1, `count=${tokenHeavy.length}`);

  const badges = await readBadges(page);
  results.badges = badges;
  const finalBadges = badges.filter(isFinalBadgeText);
  step(
    "final token speed badges",
    finalBadges.length >= 1,
    finalBadges.join(" | ") || badges.join(" | ") || "(none)",
  );

  const insaneRates = finalBadges.filter((b) => {
    const rate = parseRateTps(b);
    return rate !== undefined && rate > 2000;
  });
  step("no insane tok/s (>2000)", insaneRates.length === 0, insaneRates.join(" | ") || "none");

  const stuckWaiting = badges.filter((b) => b.startsWith("等待首字"));
  step("no stuck waiting badges", stuckWaiting.length === 0, stuckWaiting.join(" | ") || "none");

  const elapsedSec = Math.round((Date.now() - scenarioStarted) / 1000);
  step("total elapsed seconds", elapsedSec >= 20, `${elapsedSec}s`);

  await page.screenshot({ path: ".smoke-artifacts/cdp-token-speed-smoke.png", fullPage: false });
  step("screenshot", true, ".smoke-artifacts/cdp-token-speed-smoke.png");

  results.pass = results.steps.every((s) => s.ok);
} catch (error) {
  step("unexpected error", false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      ok: results.pass,
      marker: MARKER,
      threadId: results.threadId,
      steps: results.steps,
      badges: results.badges,
      spanStats: results.spanStats,
    },
    null,
    2,
  ),
);
process.exit(results.pass ? 0 : 1);
