#!/usr/bin/env bun
/**
 * CDP UI smoke: Claude + Codex via window.eco + DOM composer.
 * Requires Eco running with --remote-debugging-port=9222 and ELECTRON_RUN_AS_NODE unset.
 *
 *   env -u ELECTRON_RUN_AS_NODE bun apps/desktop/scripts/smoke-ui-claude-codex-cdp.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const REPORT = join(REPO_ROOT, ".cursor/smoke-reports/ui-cdp-latest.json");
const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const timeoutMs = Number(process.env.ECO_SMOKE_TIMEOUT_MS ?? 120_000);
const workspacePath =
  process.env.ECO_SMOKE_WORKSPACE ?? resolve(REPO_ROOT, "apps/desktop");

const marker = `ECO_UI_${Date.now()}`;
const results = [];

function record(r) {
  results.push(r);
  console.log(`${r.ok ? "✓" : "✗"} ${r.id} — ${r.summary}`);
  if (!r.ok && r.detail) console.log(`   ${String(r.detail).slice(0, 400)}`);
}

async function findEcoPage(browser) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  const page =
    pages.find((p) => /127\.0\.0\.1:5173|localhost:5173|127\.0\.0\.1:5174/.test(p.url())) ??
    pages[0];
  if (!page) throw new Error("No Eco page on CDP");
  await page.waitForLoadState("domcontentloaded");
  return page;
}

async function waitEco(page) {
  await page.waitForFunction(() => typeof window.eco !== "undefined", null, {
    timeout: 30_000,
  });
}

async function approveBashIfPresent(page) {
  const buttons = page
    .locator(
      [
        ".bash-approval-dock-shell button.bash-approval-option-row",
        ".bash-approval-panel button.bash-approval-option-row",
      ].join(", "),
    )
    .filter({ hasText: /^是$|^Yes$|^Allow$/i });
  let n = 0;
  if ((await buttons.count()) > 0) {
    try {
      await buttons.first().click({ timeout: 800 });
      n++;
    } catch {
      // ignore
    }
  }
  return n;
}

async function fillComposerAndSend(page, text) {
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.evaluate((node, value) => {
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, value);
    node.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
    );
  }, text);
  await page.waitForFunction(() => {
    const button = document.querySelector("button.send-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  }, null, { timeout: 10_000 });
  await page.locator("button.send-button").click();
}

async function waitThreadOutcome(page, threadId, startedAt) {
  /** @type {any} */
  let last = null;
  while (Date.now() - startedAt < timeoutMs) {
    await approveBashIfPresent(page);
    last = await page.evaluate(async (id) => {
      const threads = await window.eco.listThreads();
      const t = threads.find((x) => x.id === id);
      const projection = await window.eco
        .getThreadRunProjection?.(id)
        .catch(() => undefined);
      return {
        status: t?.status ?? t?.runStatus ?? null,
        errorMessage: t?.errorMessage ?? t?.lastError ?? null,
        title: t?.title ?? null,
        hasProjection: Boolean(projection),
        bodySnippet: document.body?.innerText?.slice(0, 1200) ?? "",
        apiErrorNodes: Array.from(
          document.querySelectorAll(
            ".run-log-error, .thread-error, [data-testid='thread-error'], .run-failure",
          ),
        )
          .map((n) => n.textContent ?? "")
          .join(" | ")
          .slice(0, 500),
        activity: Array.from(document.querySelectorAll(".run-log-action-trigger")).length,
        assistantText: Array.from(
          document.querySelectorAll(
            ".run-log-assistant-message, .assistant-message, .markdown-body",
          ),
        )
          .map((n) => n.textContent ?? "")
          .join("\n")
          .slice(0, 800),
      };
    }, threadId);

    const text = `${last.assistantText}\n${last.bodySnippet}\n${last.apiErrorNodes}`;
    if (/empty or malformed response|API Error|api_error|eco-gateway|Missing x-gateway/i.test(text)) {
      return { done: true, ok: false, last, reason: "api_error_in_ui" };
    }
    if (last.assistantText && last.assistantText.trim().length > 5) {
      return { done: true, ok: true, last, reason: "assistant_visible" };
    }
    if (/failed|error|cancelled/i.test(String(last.status)) && last.apiErrorNodes) {
      return { done: true, ok: false, last, reason: "thread_status_failed" };
    }
    await page.waitForTimeout(800);
  }
  return { done: false, ok: false, last, reason: "timeout" };
}

async function probeBridgeFromPage(page) {
  return page.evaluate(async () => {
    try {
      const r = await fetch("http://127.0.0.1:18765/health");
      return { status: r.status, body: (await r.text()).slice(0, 300) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

async function startViaApi(page, coreKind, prompt) {
  return page.evaluate(
    async ({ coreKind, prompt, workspacePath }) => {
      // Prefer existing projects if API provides them; otherwise startThread with path.
      const eco = window.eco;
      if (!eco?.startThread) {
        return { error: "window.eco.startThread missing" };
      }
      // Minimal runtime config — let main fill defaults from active profile.
      const runtimeConfig = {};
      try {
        const result = await eco.startThread({
          workspacePath,
          prompt,
          coreKind,
          runtimeConfig,
        });
        return { threadId: result.thread?.id, thread: result.thread };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    { coreKind, prompt, workspacePath },
  );
}

async function runCoreCase(page, coreKind) {
  const prompt = `Reply with exactly one word: ${marker}_${coreKind}. Do not use tools.`;
  const started = Date.now();

  // Path A: IPC startThread
  const apiStart = await startViaApi(page, coreKind, prompt);

  if (apiStart.error) {
    record({
      id: `${coreKind} startThread API`,
      hypothesisId: "H-ui-claude",
      ok: false,
      summary: "start failed",
      detail: apiStart.error,
    });

    // Path B: try DOM if composer available (new chat may already be open)
    try {
      await fillComposerAndSend(page, prompt);
      record({
        id: `${coreKind} composer send fallback`,
        hypothesisId: "H-ui-dom",
        ok: true,
        summary: "composer sent",
      });
      const outcome = await waitThreadOutcome(page, "", started);
      record({
        id: `${coreKind} UI outcome`,
        hypothesisId: "H-ui-outcome",
        ok: outcome.ok,
        summary: outcome.reason,
        detail: JSON.stringify(outcome.last)?.slice(0, 600),
      });
    } catch (e) {
      record({
        id: `${coreKind} composer fallback`,
        hypothesisId: "H-ui-dom",
        ok: false,
        summary: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  record({
    id: `${coreKind} startThread API`,
    hypothesisId: "H-ui",
    ok: Boolean(apiStart.threadId),
    summary: `threadId=${apiStart.threadId}`,
    detail: JSON.stringify(apiStart.thread)?.slice(0, 300),
  });

  const outcome = await waitThreadOutcome(page, apiStart.threadId, started);
  record({
    id: `${coreKind} run outcome`,
    hypothesisId: "H-ui-outcome",
    ok: outcome.ok,
    summary: `${outcome.reason} status=${outcome.last?.status}`,
    detail: JSON.stringify({
      errorMessage: outcome.last?.errorMessage,
      apiErrorNodes: outcome.last?.apiErrorNodes,
      assistant: outcome.last?.assistantText?.slice?.(0, 300),
      activity: outcome.last?.activity,
    }),
  });
}

const browser = await chromium.connectOverCDP(cdpUrl);
const page = await findEcoPage(browser);
await page.bringToFront();
await waitEco(page);

const url = page.url();
const title = await page.title();
record({
  id: "CDP page",
  hypothesisId: "H-ui",
  ok: true,
  summary: `${title} ${url}`,
});

const hasEco = await page.evaluate(() => typeof window.eco !== "undefined");
record({
  id: "window.eco present",
  hypothesisId: "H-ui",
  ok: hasEco,
  summary: hasEco ? "yes" : "no",
});

const bridge = await probeBridgeFromPage(page);
record({
  id: "Bridge /health",
  hypothesisId: "H-bridge",
  ok: bridge.status === 200,
  summary:
    bridge.status !== undefined
      ? `HTTP ${bridge.status}`
      : `error: ${bridge.error}`,
  detail: JSON.stringify(bridge),
});

// List eco method names for diagnostics
const ecoKeys = await page.evaluate(() =>
  Object.keys(window.eco || {})
    .filter((k) => typeof window.eco[k] === "function")
    .sort(),
);

// Prefer Claude then Codex API paths
await runCoreCase(page, "claude");
await runCoreCase(page, "codex");

mkdirSync(dirname(REPORT), { recursive: true });
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
writeFileSync(
  REPORT,
  JSON.stringify({ passed, failed, total: results.length, marker, results }, null, 2),
);

// screenshot
try {
  const shot = join(REPO_ROOT, ".cursor/smoke-reports/ui-cdp-latest.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`screenshot: ${shot}`);
} catch (e) {
  console.warn("screenshot failed", e);
}

console.log(`\n${passed}/${results.length} passed → ${REPORT}`);
await browser.close().catch(() => undefined);
if (failed > 0) process.exitCode = 1;
