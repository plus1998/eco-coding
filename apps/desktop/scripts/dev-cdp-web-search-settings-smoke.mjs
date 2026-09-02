/**
 * CDP smoke: PI Web Search settings UI + IPC (Integrated + model native toggle).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const cdpUrl = process.env.ECO_DEV_CDP_URL ?? "http://127.0.0.1:9344";
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".smoke-artifacts");
mkdirSync(outDir, { recursive: true });

const failures = [];

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error("[web-search-smoke] FAIL:", message);
    return false;
  }
  console.log("[web-search-smoke] OK:", message);
  return true;
}

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const context = browser.contexts()[0];
  const page = context?.pages().find((p) => p.url().includes("5173")) ?? context?.pages()[0];
  if (!page) {
    throw new Error("No Eco page from CDP");
  }

  console.log("[web-search-smoke] page:", page.url());
  await page.waitForFunction(() => typeof window.eco !== "undefined", undefined, { timeout: 30_000 });

  const ipc = await page.evaluate(async () => {
    const eco = window.eco;
    if (!eco?.getIntegratedWebSearchSettings) {
      return { hasIntegratedApi: false };
    }
    const settings = await eco.getIntegratedWebSearchSettings();
    return {
      hasIntegratedApi: true,
      settings,
    };
  });
  assert(ipc.hasIntegratedApi, "preload exposes getIntegratedWebSearchSettings");
  assert(
    ipc.settings?.provider === "brave" ||
      ipc.settings?.provider === "tavily" ||
      ipc.settings?.provider === "doubao",
    "integrated provider is brave, tavily, or doubao",
  );
  assert(typeof ipc.settings?.enabled === "boolean", "integrated settings has enabled boolean");
  assert(typeof ipc.settings?.hasApiKey === "boolean", "integrated settings has hasApiKey boolean");

  const settingsBtn = page.locator("button.sidebar-settings-action").first();
  const settingsPage = page.locator(".settings-page");
  if (await settingsPage.isVisible().catch(() => false)) {
    assert(true, "settings already open from prior run");
  } else {
    await settingsBtn.waitFor({ state: "visible", timeout: 15_000 });
    await settingsBtn.click();
    await settingsPage.waitFor({ state: "visible", timeout: 10_000 });
    assert(true, "opened settings via sidebar");
  }

  const proxyBridgeTab = page.getByRole("tab", { name: /代理桥|Proxy bridge/i });
  await proxyBridgeTab.waitFor({ state: "visible", timeout: 10_000 });
  await proxyBridgeTab.click();

  const integratedSection = page.locator(".models-integrated-web-search-section");
  await integratedSection.waitFor({ state: "visible", timeout: 10_000 });
  assert(await integratedSection.isVisible(), "Integrated Web Search section visible on proxy bridge tab");

  const integratedLabel = page.getByText(/Integrated Web Search|启用 Integrated Web Search/i);
  assert(await integratedLabel.first().isVisible(), "Integrated Web Search label visible");

  const nativeCheckbox = page.getByText(/Provider 原生 Web Search|Provider-native Web Search/i);
  const nativeVisible = await nativeCheckbox.first().isVisible().catch(() => false);
  if (!nativeVisible) {
    console.log("[web-search-smoke] SKIP: native web search checkbox not on providers root (open candidate model manually if needed)");
  } else {
    assert(true, "Provider native Web Search label visible in model spec area");
  }

  await page.screenshot({ path: path.join(outDir, "cdp-web-search-settings.png"), fullPage: false });
  console.log("[web-search-smoke] screenshot:", path.join(outDir, "cdp-web-search-settings.png"));

  if (failures.length > 0) {
    throw new Error(`${failures.length} assertion(s) failed:\n- ${failures.join("\n- ")}`);
  }
  console.log("[web-search-smoke] PASS");
} finally {
  await browser.close();
}
