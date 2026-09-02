#!/usr/bin/env node
/**
 * Capture README screenshots from the ECO_DEMO Electron window via Playwright.
 *
 * Usage:
 *   bun run --cwd apps/desktop readme:screenshots:demo
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDir = path.join(repoRoot, "docs/assets");
const previewDir = path.join(repoRoot, "docs/assets/readme-demo-preview");
const envFile = path.join(desktopRoot, ".e2e-env.json");

mkdirSync(outputDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

function runBuild(script) {
  const result = spawnSync("bun", ["run", script], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`bun run ${script} exited with ${result.status ?? 1}`);
  }
}

function readRendererUrl() {
  if (existsSync(envFile)) {
    const env = JSON.parse(readFileSync(envFile, "utf8"));
    if (env.rendererUrl) {
      return env.rendererUrl;
    }
  }
  const rendererPort = Number.parseInt(process.env.ECO_RENDERER_PORT ?? "5173", 10);
  return `http://127.0.0.1:${rendererPort}/`;
}

runBuild("build:demo-main");
runBuild("build:preload");

const rendererUrl = readRendererUrl();
const electronApp = await electron.launch({
  cwd: desktopRoot,
  args: ["dist/demo-main/demo.js", "--enable-logging"],
  env: {
    ...process.env,
    ECO_DEMO: "1",
    VITE_DEV_SERVER_URL: rendererUrl,
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

try {
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => Boolean(document.body?.innerText?.length > 20), null, {
    timeout: 30_000,
  });

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

  const threadRow = page
    .locator(".sidebar-thread, button, [role='button']")
    .filter({
      hasText: "Supabase Center 配对 UI",
    })
    .first();
  await threadRow.waitFor({ timeout: 20_000 });
  await threadRow.click({ force: true });
  await page.waitForSelector("text=三个子代理已完成", { timeout: 20_000 });
  await page.waitForTimeout(800);

  await capture(page, "eco-product-overview-dark");

  await openSettingsSection(page, "运行配置");
  await page.waitForTimeout(500);
  const settings = page.locator(".settings-page");
  await settings.waitFor({ state: "visible", timeout: 10_000 });

  const subagentTab = settings
    .locator("button")
    .filter({ hasText: /^子代理$/ })
    .first();
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

  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(200);
  const backBtn = settings
    .locator("button")
    .filter({ hasText: /^返回$/ })
    .first();
  if ((await backBtn.count()) > 0) {
    await backBtn.click({ force: true });
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  await page.waitForTimeout(400);
  await page
    .locator(".settings-page")
    .waitFor({ state: "hidden", timeout: 8_000 })
    .catch(async () => {
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(300);
    });

  await page
    .locator("text=Supabase Center 配对 UI")
    .first()
    .click({ force: true })
    .catch(() => undefined);
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
  await electronApp.close();
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
    await page
      .getByRole("button", { name: /设置|Settings|模型|Models/ })
      .first()
      .click();
  }
  await page.waitForSelector(".settings-page, [aria-label='设置'], [aria-label='Settings']", {
    timeout: 15_000,
  });
  await page.locator(".settings-nav-item, button").filter({ hasText: label }).first().click();
}
