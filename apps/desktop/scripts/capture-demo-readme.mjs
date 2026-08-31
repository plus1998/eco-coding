#!/usr/bin/env node
/**
 * Capture README screenshots from the real ECO_DEMO Electron window via CDP.
 *
 * Usage:
 *   bun run --cwd apps/desktop readme:screenshots:demo
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDir = path.join(repoRoot, "docs/assets");
const previewDir = path.join(repoRoot, "docs/assets/readme-demo-preview");
const cdpPort = Number.parseInt(process.env.ECO_DEMO_CDP_PORT ?? "9333", 10);
const cdpUrl = `http://127.0.0.1:${cdpPort}`;

mkdirSync(outputDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

pkillDemo();
await delay(400);

const demo = spawn("bun", ["run", "dev:demo", `--remote-debugging-port=${cdpPort}`], {
  cwd: desktopRoot,
  env: {
    ...process.env,
    ECO_REMOTE_DEBUGGING_PORT: String(cdpPort),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

demo.stdout.on("data", (chunk) => process.stdout.write(chunk));
demo.stderr.on("data", (chunk) => process.stderr.write(chunk));

let browser;
try {
  await waitForCdp(cdpUrl, 45_000);
  browser = await chromium.connectOverCDP(cdpUrl);
  const page = await waitForDemoPage(browser, 30_000);

  // Force dark theme for README assets (user OS may be light). Avoid reload —
  // pending-thread open is already consumed after first paint.
  await page.evaluate(() => {
    try {
      localStorage.setItem("eco.app-theme", "dark");
    } catch {
      // ignore
    }
    document.documentElement.dataset.theme = "dark";
  });
  await page.evaluate(async () => {
    await window.eco?.setAppThemeSource?.("dark").catch(() => undefined);
  });
  await page.waitForTimeout(300);

  // Ensure the demo thread is selected even if auto-open raced a remount.
  const threadRow = page.locator(".sidebar-thread, button, [role='button']").filter({
    hasText: "Supabase Center 配对 UI",
  }).first();
  await threadRow.waitFor({ timeout: 20_000 });
  await threadRow.click({ force: true });
  await page.waitForSelector("text=三个子代理已完成", { timeout: 20_000 });
  await page.waitForTimeout(800);

  // ── product overview ──────────────────────────────────────────────
  await capture(page, "eco-product-overview-dark");

  // ── agent team ────────────────────────────────────────────────────
  await openSettingsSection(page, "运行配置");
  await page.waitForTimeout(500);
  const settings = page.locator(".settings-page");
  await settings.waitFor({ state: "visible", timeout: 10_000 });

  // Tab labels in ModelsSettingsPanel agentBuilder mode.
  const subagentTab = settings.locator("button").filter({ hasText: /^子代理$/ }).first();
  if ((await subagentTab.count()) > 0) {
    await subagentTab.click({ force: true });
    await page.waitForTimeout(500);
  }

  const editOrchestration = settings
    .locator("button[aria-label*='Demo Team Subagents'], button[aria-label^='编辑 ']")
    .first();
  if ((await editOrchestration.count()) > 0) {
    await editOrchestration.click({ force: true });
    await page.waitForTimeout(900);
  }
  await capture(page, "eco-agent-team-dark");

  // Close settings before cost capture.
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(200);
  const backBtn = settings.locator("button").filter({ hasText: /^返回$/ }).first();
  if ((await backBtn.count()) > 0) {
    await backBtn.click({ force: true });
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  await page.waitForTimeout(400);
  await page.locator(".settings-page").waitFor({ state: "hidden", timeout: 8_000 }).catch(async () => {
    await page.keyboard.press("Escape").catch(() => undefined);
    await page.waitForTimeout(300);
  });

  // ── cost / cache ──────────────────────────────────────────────────
  await page.locator("text=Supabase Center 配对 UI").first().click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(500);
  const costTarget = page.locator('button[aria-label*="计费"], button[aria-label*="$0.48"]').first();
  await costTarget.waitFor({ timeout: 10_000 });
  await costTarget.click({ force: true });
  await page.waitForTimeout(900);

  const billingRoot = page
    .locator(
      ".usage-breakdown-cost, .thread-info-billing, .composer-codex-popover, .thread-info-float-panel, [role='dialog']",
    )
    .filter({ hasText: /\$0\.48|节省|缓存|cache|Luna|Sol|未编排/i })
    .first();
  if ((await billingRoot.count()) > 0) {
    await captureElement(page, billingRoot, "eco-cost-cache-dark");
  } else {
    await capture(page, "eco-cost-cache-dark");
  }

  console.log(`[readme-demo] wrote screenshots to ${outputDir}`);
  console.log(`[readme-demo] preview copies -> ${previewDir}`);
} finally {
  if (browser) {
    await browser.close().catch(() => undefined);
  }
  demo.kill("SIGTERM");
  await delay(500);
  pkillDemo();
}

async function capture(page, basename) {
  const jpg = path.join(outputDir, `${basename}.jpg`);
  const png = path.join(previewDir, `${basename}.png`);
  await page.screenshot({ path: png, type: "png" });
  await page.screenshot({ path: jpg, type: "jpeg", quality: 92 });
  console.log(`[readme-demo] ${basename} -> ${jpg}`);
}

async function captureElement(page, locator, basename) {
  const jpg = path.join(outputDir, `${basename}.jpg`);
  const png = path.join(previewDir, `${basename}.png`);
  const box = await locator.boundingBox();
  if (!box) {
    await capture(page, basename);
    return;
  }
  const padding = 20;
  const clip = {
    x: Math.max(0, Math.floor(box.x - padding)),
    y: Math.max(0, Math.floor(box.y - padding)),
    width: Math.ceil(box.width + padding * 2),
    height: Math.ceil(box.height + padding * 2),
  };
  await page.screenshot({ path: png, type: "png", clip });
  await page.screenshot({ path: jpg, type: "jpeg", quality: 92, clip });
  console.log(`[readme-demo] ${basename} (clip) -> ${jpg}`);
}

async function openSettingsSection(page, label) {
  const settingsBtn = page.locator("button.sidebar-settings-action").first();
  if ((await settingsBtn.count()) > 0) {
    await settingsBtn.click();
  } else {
    await page.getByRole("button", { name: /设置|Settings|模型|Models/ }).first().click();
  }
  await page.waitForSelector(".settings-page, [aria-label='设置'], [aria-label='Settings']", {
    timeout: 15_000,
  });
  await page.locator(".settings-nav-item, button").filter({ hasText: label }).first().click();
}

async function waitForDemoPage(browser, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (url.includes("127.0.0.1:5173") || url.includes("localhost:5173") || url.startsWith("file:")) {
          try {
            await page.waitForFunction(() => Boolean(document.body?.innerText?.length > 20), null, {
              timeout: 2_000,
            });
            return page;
          } catch {
            // keep waiting
          }
        }
      }
    }
    await delay(400);
  }
  throw new Error("Demo Electron page not found on CDP.");
}

async function waitForCdp(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/json/version`);
      if (response.ok) return;
      lastError = new Error(`CDP status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw lastError ?? new Error(`CDP not ready at ${url}`);
}

function pkillDemo() {
  try {
    spawn("pkill", ["-f", "dist/demo-main/demo.js"], { stdio: "ignore" });
  } catch {
    // ignore
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
