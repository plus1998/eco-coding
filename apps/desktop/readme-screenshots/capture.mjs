#!/usr/bin/env node
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
const port = 5199;
const baseUrl = `http://127.0.0.1:${port}/`;

const scenes = [
  { scene: "product-overview", output: "eco-product-overview-dark.jpg" },
  { scene: "agent-team", output: "eco-agent-team-dark.jpg" },
  { scene: "cost-cache", output: "eco-cost-cache-dark.jpg" },
];

mkdirSync(outputDir, { recursive: true });
mkdirSync(previewDir, { recursive: true });

const vite = spawn(
  "bun",
  ["x", "vite", "--config", "readme-screenshots/vite.config.ts", "--host", "127.0.0.1", "--port", String(port)],
  {
    cwd: desktopRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  },
);

vite.stdout.on("data", (chunk) => process.stdout.write(chunk));
vite.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForUrl(baseUrl, 30_000);
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  for (const entry of scenes) {
    const url = `${baseUrl}?scene=${entry.scene}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.getElementById("root")?.dataset.readmeDemoReady === "true");
    await page.waitForTimeout(400);

    const previewPath = path.join(previewDir, entry.output.replace(/\.jpg$/, ".png"));
    const outputPath = path.join(outputDir, entry.output);

    await page.screenshot({ path: previewPath, type: "png" });
    await page.screenshot({ path: outputPath, type: "jpeg", quality: 92 });
    console.log(`[readme-screenshots] ${entry.scene} -> ${outputPath}`);
  }

  await browser.close();
  console.log(`[readme-screenshots] preview copies -> ${previewDir}`);
} finally {
  vite.kill("SIGTERM");
  await delay(300);
  if (!vite.killed) {
    vite.kill("SIGKILL");
  }
}

async function launchBrowser() {
  const attempts = [
    { channel: "chrome" },
    { channel: "msedge" },
    { channel: "chromium" },
    {},
  ];
  let lastError;
  for (const options of attempts) {
    try {
      return await chromium.launch({ headless: true, ...options });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("Unable to launch a Chromium-based browser for screenshots.");
}

async function waitForUrl(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
