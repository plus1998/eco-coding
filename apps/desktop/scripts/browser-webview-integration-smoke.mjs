/**
 * Built-in browser (renderer webview + thread CDP) integration smoke.
 *
 * Prerequisites:
 *   bun run dev:cdp   (Eco Desktop with --remote-debugging-port=9222)
 *   Active project + thread in UI (or script will try to open browser anyway)
 *
 * Usage:
 *   bun run smoke:browser-webview
 *   ECO_CDP_URL=http://127.0.0.1:9222 node scripts/browser-webview-integration-smoke.mjs
 *
 * Note: Eco agent MCP (eco_agent_browser) can hang on Windows; this script drives
 * agent-browser via CLI + thread CDP instead of MCP stdio.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { runAgentBrowser } from "./agent-browser-cli.mjs";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "120000", 10);
const marker = `ECO_BROWSER_SMOKE_${Date.now()}`;
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".smoke-artifacts", marker);

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`[PASS] ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ""}`);
}

function agentBrowser(args, env = {}) {
  return runAgentBrowser(args, env);
}

async function findEcoPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const hasEco = await page
        .evaluate(() => typeof window.eco?.getBrowserState === "function")
        .catch(() => false);
      if (hasEco) {
        return page;
      }
    }
  }
  throw new Error("No Eco renderer page with window.eco found via CDP.");
}

async function waitForBrowserInstances(page, min = 1) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(async () => window.eco.getBrowserState());
    if (state?.instances?.length >= min) {
      return state;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${min} browser instance(s).`);
}

async function ensureTaskPanelOpen(page) {
  const btn = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  const expanded = await btn.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await btn.click();
    await page.waitForTimeout(600);
  }
}

async function closeTaskPanel(page) {
  const btn = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  const expanded = await btn.getAttribute("aria-expanded");
  if (expanded === "true") {
    await btn.click();
    await page.waitForTimeout(900);
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log(`[smoke] CDP=${cdpUrl} marker=${marker} out=${outDir}`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    fail("connect Eco CDP", String(error));
    summarize(1);
    return;
  }
  pass("connect Eco CDP");

  const page = await findEcoPage(browser);
  await page.bringToFront();
  pass("find Eco renderer page", page.url());

  // --- Open two browser tabs via IPC ---
  const openState = await page.evaluate(async (m) => {
    const a = await window.eco.browserOpen({
      url: `https://example.com/?tab=a&${m}`,
      newBrowser: true,
      reveal: true,
    });
    const b = await window.eco.browserOpen({
      url: `https://example.org/?tab=b&${m}`,
      newBrowser: true,
      reveal: true,
    });
    return { a, b };
  }, marker);

  const instances = openState.b?.instances ?? openState.a?.instances ?? [];
  if (instances.length < 2) {
    fail("multi-page: open two browser instances", `instances=${instances.length}`);
  } else {
    pass("multi-page: open two browser instances", `count=${instances.length}`);
  }

  await ensureTaskPanelOpen(page);
  await page.waitForTimeout(1200);

  const tabLabels = await page.locator(".subagent-task-panel-tab--browser .subagent-task-panel-tab-label").allTextContents();
  if (tabLabels.length >= 2) {
    pass("multi-page: task panel shows browser tabs", tabLabels.join(" | "));
  } else {
    fail("multi-page: task panel shows browser tabs", `labels=${JSON.stringify(tabLabels)}`);
  }

  // --- Session marker via localStorage ---
  const sessionKey = `eco_smoke_${marker}`;
  await page.evaluate(async ({ key, value }) => {
    const state = await window.eco.getBrowserState();
    const id = state.focusedBrowserId ?? state.instances.at(-1)?.id;
    if (!id) throw new Error("no browser id");
    await window.eco.browserNavigate({
      url: `data:text/html,<script>localStorage.setItem('${key}','${value}')</script><h1>${value}</h1>`,
      browserId: id,
      reveal: true,
    });
  }, { key: sessionKey, value: marker });

  await page.waitForTimeout(1500);

  // --- Close / reopen task panel twice ---
  for (let i = 0; i < 2; i += 1) {
    await closeTaskPanel(page);
    const afterClose = await page.evaluate(async () => window.eco.getBrowserState());
    const countAfterClose = afterClose?.instances?.length ?? 0;
    if (countAfterClose >= 2) {
      pass(`panel-close cycle ${i + 1}: instances survive`, `count=${countAfterClose}`);
    } else {
      fail(`panel-close cycle ${i + 1}: instances survive`, `count=${countAfterClose}`);
    }
    await ensureTaskPanelOpen(page);
    await page.waitForTimeout(800);
  }

  // --- CDP port for agent-browser ---
  const cdpState = await waitForBrowserInstances(page, 2);
  const cdpPort = cdpState.cdpPort;
  if (typeof cdpPort !== "number" || cdpPort <= 0) {
    fail("thread CDP port available", `cdpPort=${cdpPort}`);
    summarize(1);
    return;
  }
  pass("thread CDP port available", String(cdpPort));

  const abEnv = { AGENT_BROWSER_CDP: String(cdpPort) };

  // tab list
  {
    const r = agentBrowser(["tab", "list"], abEnv);
    if (r.ok && r.stdout.includes("example")) {
      pass("agent-browser tab_list", r.stdout.trim().split("\n")[0] ?? "");
    } else {
      fail("agent-browser tab_list", r.stderr || r.stdout || `exit=${r.status}`);
    }
  }

  // open / navigate focus tab
  {
    const r = agentBrowser(["open", `https://example.com/?ab=${marker}`], abEnv);
    if (r.ok) pass("agent-browser open");
    else fail("agent-browser open", r.stderr || r.stdout);
  }

  // snapshot + click (example.com More information link if present)
  {
    const snap = agentBrowser(["snapshot", "--interactive"], abEnv);
    if (!snap.ok) {
      fail("agent-browser snapshot", snap.stderr || snap.stdout);
    } else {
      pass("agent-browser snapshot");
      const refMatch = snap.stdout.match(/@e\d+/);
      if (refMatch) {
        const click = agentBrowser(["click", refMatch[0]], abEnv);
        if (click.ok) pass("agent-browser click", refMatch[0]);
        else fail("agent-browser click", click.stderr || click.stdout);
      } else {
        fail("agent-browser click", "no @e ref in snapshot");
      }
    }
  }

  // scroll
  {
    const r = agentBrowser(["scroll", "down", "400"], abEnv);
    if (r.ok) pass("agent-browser scroll");
    else fail("agent-browser scroll", r.stderr || r.stdout);
  }

  // eval
  {
    const r = agentBrowser(["eval", `document.title = 'SMOKE_${marker}'; 'ok-${marker}'`], abEnv);
    if (r.ok && (r.stdout.includes(marker) || r.stdout.includes("ok-"))) {
      pass("agent-browser eval", r.stdout.trim());
    } else {
      fail("agent-browser eval", r.stderr || r.stdout);
    }
  }

  // screenshot
  {
    const shotPath = path.join(outDir, "screenshot.png");
    const r = agentBrowser(["screenshot", shotPath], abEnv);
    if (r.ok) pass("agent-browser screenshot", shotPath);
    else fail("agent-browser screenshot", r.stderr || r.stdout);
  }

  // page source (html + read)
  {
    const html = agentBrowser(["html"], abEnv);
    if (html.ok && html.stdout.length > 20) {
      pass("agent-browser html (page source)", `${html.stdout.length} chars`);
      writeFileSync(path.join(outDir, "page.html"), html.stdout);
    } else {
      fail("agent-browser html (page source)", html.stderr || html.stdout);
    }
    const read = agentBrowser(["read"], abEnv);
    if (read.ok && read.stdout.length > 20) {
      pass("agent-browser read (agent text)", `${read.stdout.length} chars`);
      writeFileSync(path.join(outDir, "page-read.txt"), read.stdout);
    } else {
      fail("agent-browser read (agent text)", read.stderr || read.stdout);
    }
  }

  // network capture
  {
    agentBrowser(["network", "requests", "--clear"], abEnv);
    agentBrowser(["open", `https://example.com/?net=${marker}`], abEnv);
    const reqs = agentBrowser(["network", "requests", "--filter", "example.com"], abEnv);
    if (reqs.ok && reqs.stdout.includes("example.com")) {
      pass("agent-browser network requests", reqs.stdout.trim().split("\n")[0] ?? "");
      writeFileSync(path.join(outDir, "network-requests.txt"), reqs.stdout);
    } else {
      fail("agent-browser network requests", reqs.stderr || reqs.stdout);
    }
  }

  // verify navigation stuck after panel cycles
  {
    const url = agentBrowser(["get", "url"], abEnv);
    if (url.ok && url.stdout.includes("example.com")) {
      pass("agent-browser get url", url.stdout.trim());
    } else {
      fail("agent-browser get url", url.stderr || url.stdout);
    }
  }

  // session persistence: localStorage survives panel close
  {
    await closeTaskPanel(page);
    await page.waitForTimeout(600);
    await ensureTaskPanelOpen(page);
    await page.waitForTimeout(800);
    const evalStore = agentBrowser(
      ["eval", `localStorage.getItem('${sessionKey}')`],
      abEnv,
    );
    if (evalStore.ok && evalStore.stdout.includes(marker)) {
      pass("session persistence (localStorage after panel cycles)", evalStore.stdout.trim());
    } else {
      fail("session persistence", evalStore.stderr || evalStore.stdout);
    }
  }

  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  summarize(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize(code) {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n[smoke] done: ${passed} passed, ${failed} failed`);
  process.exit(code);
}

main().catch((error) => {
  fail("unhandled", error instanceof Error ? error.stack ?? error.message : String(error));
  summarize(1);
});
