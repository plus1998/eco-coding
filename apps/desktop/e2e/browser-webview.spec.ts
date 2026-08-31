import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentBrowser } from "../scripts/agent-browser-cli.mjs";
import { expect, test } from "./fixtures/electron-app";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("built-in browser webview and thread CDP integration", async ({ ecoPage: page }) => {
  test.setTimeout(Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "120000", 10));

  const marker = `ECO_BROWSER_SMOKE_${Date.now()}`;
  const outDir = path.join(desktopRoot, ".smoke-artifacts", marker);
  mkdirSync(outDir, { recursive: true });

  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const pass = (name: string, detail = "") => {
    results.push({ name, ok: true, detail });
    console.log(`[PASS] ${name}${detail ? `: ${detail}` : ""}`);
  };
  const fail = (name: string, detail = "") => {
    results.push({ name, ok: false, detail });
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ""}`);
  };

  pass("launch Eco renderer page", page.url());

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

  const tabLabels = await page
    .locator(".subagent-task-panel-tab--browser .subagent-task-panel-tab-label")
    .allTextContents();
  if (tabLabels.length >= 2) {
    pass("multi-page: task panel shows browser tabs", tabLabels.join(" | "));
  } else {
    fail("multi-page: task panel shows browser tabs", `labels=${JSON.stringify(tabLabels)}`);
  }

  const sessionKey = `eco_smoke_${marker}`;
  await page.evaluate(
    async ({ key, value }) => {
      const state = await window.eco.getBrowserState();
      const id = state.focusedBrowserId ?? state.instances.at(-1)?.id;
      if (!id) {
        throw new Error("no browser id");
      }
      await window.eco.browserNavigate({
        url: `data:text/html,<script>localStorage.setItem('${key}','${value}')</script><h1>${value}</h1>`,
        browserId: id,
        reveal: true,
      });
    },
    { key: sessionKey, value: marker },
  );
  await page.waitForTimeout(1500);

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

  const cdpState = await waitForBrowserInstances(page, 2);
  const cdpPort = cdpState.cdpPort;
  if (typeof cdpPort !== "number" || cdpPort <= 0) {
    fail("thread CDP port available", `cdpPort=${cdpPort}`);
    writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
    expect(results.every((entry) => entry.ok)).toBe(true);
    return;
  }
  pass("thread CDP port available", String(cdpPort));

  const abEnv = { AGENT_BROWSER_CDP: String(cdpPort) };

  {
    const r = runAgentBrowser(["tab", "list"], abEnv);
    if (r.ok && r.stdout.includes("example")) {
      pass("agent-browser tab_list", r.stdout.trim().split("\n")[0] ?? "");
    } else {
      fail("agent-browser tab_list", r.stderr || r.stdout || `exit=${r.status}`);
    }
  }

  {
    const r = runAgentBrowser(["open", `https://example.com/?ab=${marker}`], abEnv);
    if (r.ok) pass("agent-browser open");
    else fail("agent-browser open", r.stderr || r.stdout);
  }

  {
    const snap = runAgentBrowser(["snapshot", "--interactive"], abEnv);
    if (!snap.ok) {
      fail("agent-browser snapshot", snap.stderr || snap.stdout);
    } else {
      pass("agent-browser snapshot");
      const refMatch = snap.stdout.match(/@e\d+/);
      if (refMatch) {
        const click = runAgentBrowser(["click", refMatch[0]], abEnv);
        if (click.ok) pass("agent-browser click", refMatch[0]);
        else fail("agent-browser click", click.stderr || click.stdout);
      } else {
        fail("agent-browser click", "no @e ref in snapshot");
      }
    }
  }

  {
    const r = runAgentBrowser(["scroll", "down", "400"], abEnv);
    if (r.ok) pass("agent-browser scroll");
    else fail("agent-browser scroll", r.stderr || r.stdout);
  }

  {
    const r = runAgentBrowser(["eval", `document.title = 'SMOKE_${marker}'; 'ok-${marker}'`], abEnv);
    if (r.ok && (r.stdout.includes(marker) || r.stdout.includes("ok-"))) {
      pass("agent-browser eval", r.stdout.trim());
    } else {
      fail("agent-browser eval", r.stderr || r.stdout);
    }
  }

  {
    const shotPath = path.join(outDir, "screenshot.png");
    const r = runAgentBrowser(["screenshot", shotPath], abEnv);
    if (r.ok) pass("agent-browser screenshot", shotPath);
    else fail("agent-browser screenshot", r.stderr || r.stdout);
  }

  {
    const html = runAgentBrowser(["html"], abEnv);
    if (html.ok && html.stdout.length > 20) {
      pass("agent-browser html (page source)", `${html.stdout.length} chars`);
      writeFileSync(path.join(outDir, "page.html"), html.stdout);
    } else {
      fail("agent-browser html (page source)", html.stderr || html.stdout);
    }
    const read = runAgentBrowser(["read"], abEnv);
    if (read.ok && read.stdout.length > 20) {
      pass("agent-browser read (agent text)", `${read.stdout.length} chars`);
      writeFileSync(path.join(outDir, "page-read.txt"), read.stdout);
    } else {
      fail("agent-browser read (agent text)", read.stderr || read.stdout);
    }
  }

  {
    runAgentBrowser(["network", "requests", "--clear"], abEnv);
    runAgentBrowser(["open", `https://example.com/?net=${marker}`], abEnv);
    const reqs = runAgentBrowser(["network", "requests", "--filter", "example.com"], abEnv);
    if (reqs.ok && reqs.stdout.includes("example.com")) {
      pass("agent-browser network requests", reqs.stdout.trim().split("\n")[0] ?? "");
      writeFileSync(path.join(outDir, "network-requests.txt"), reqs.stdout);
    } else {
      fail("agent-browser network requests", reqs.stderr || reqs.stdout);
    }
  }

  {
    const url = runAgentBrowser(["get", "url"], abEnv);
    if (url.ok && url.stdout.includes("example.com")) {
      pass("agent-browser get url", url.stdout.trim());
    } else {
      fail("agent-browser get url", url.stderr || url.stdout);
    }
  }

  {
    await closeTaskPanel(page);
    await page.waitForTimeout(600);
    await ensureTaskPanelOpen(page);
    await page.waitForTimeout(800);
    const evalStore = runAgentBrowser(["eval", `localStorage.getItem('${sessionKey}')`], abEnv);
    if (evalStore.ok && evalStore.stdout.includes(marker)) {
      pass("session persistence (localStorage after panel cycles)", evalStore.stdout.trim());
    } else {
      fail("session persistence", evalStore.stderr || evalStore.stdout);
    }
  }

  writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((entry) => !entry.ok).length;
  console.log(`\n[browser-webview] done: ${results.length - failed} passed, ${failed} failed`);
  expect(failed, results.filter((entry) => !entry.ok).map((entry) => `${entry.name}: ${entry.detail}`).join("; ")).toBe(0);
});

async function waitForBrowserInstances(page: import("@playwright/test").Page, min = 1) {
  const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "120000", 10);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await page.evaluate(async () => window.eco.getBrowserState());
    if ((state?.instances?.length ?? 0) >= min) {
      return state;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for ${min} browser instance(s).`);
}

async function ensureTaskPanelOpen(page: import("@playwright/test").Page): Promise<void> {
  const btn = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  if ((await btn.getAttribute("aria-expanded")) !== "true") {
    await btn.click();
    await page.waitForTimeout(600);
  }
}

async function closeTaskPanel(page: import("@playwright/test").Page): Promise<void> {
  const btn = page.locator('.codex-main-toolbar-button[aria-controls="task-panel"]').first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  if ((await btn.getAttribute("aria-expanded")) === "true") {
    await btn.click();
    await page.waitForTimeout(900);
  }
}
