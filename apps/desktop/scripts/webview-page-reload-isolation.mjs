/**
 * Prove Eco's Page.reload isolation against Electron <webview>.
 * Spawns two Electron processes:
 *   A) raw debugger Page.reload
 *   B) guest.reload() — Eco fix path
 *
 * Usage: cd apps/desktop && node scripts/webview-page-reload-isolation.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const outDir = path.join(desktopRoot, ".smoke-artifacts", `reload-iso-${Date.now()}`);
mkdirSync(outDir, { recursive: true });

const embedderHtml = `<!doctype html>
<html>
  <body style="margin:0;font:14px sans-serif">
    <div id="mark"></div>
    <webview id="guest" src="https://example.com/" style="width:480px;height:320px;display:block"></webview>
    <script>
      window.__EMBEDDER_MARK = "alive-" + Date.now();
      document.getElementById("mark").textContent = window.__EMBEDDER_MARK;
    </script>
  </body>
</html>`;
const pageUrl = "data:text/html;charset=utf-8," + encodeURIComponent(embedderHtml);

function writeRunner(mode) {
  const runnerPath = path.join(outDir, `runner-${mode}.cjs`);
  writeFileSync(
    runnerPath,
    `
const { app, BrowserWindow } = require("electron");
const pageUrl = ${JSON.stringify(pageUrl)};
const mode = ${JSON.stringify(mode)};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitGuest(win, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("did-attach-webview timeout")), timeoutMs);
    win.webContents.once("did-attach-webview", (_e, guest) => {
      clearTimeout(timer);
      resolve(guest);
    });
  });
}

async function readEmbedderMark(win) {
  try {
    return await win.webContents.executeJavaScript("window.__EMBEDDER_MARK");
  } catch (error) {
    return "ERROR:" + (error && error.message ? error.message : String(error));
  }
}

async function readGuestTitle(guest) {
  try {
    return await guest.executeJavaScript("document.title || ''");
  } catch (error) {
    return "ERROR:" + (error && error.message ? error.message : String(error));
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 640,
    height: 480,
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const guestPromise = waitGuest(win);
  await win.loadURL(pageUrl);
  const guest = await guestPromise;
  for (let i = 0; i < 80; i++) {
    const title = await readGuestTitle(guest);
    if (title && !String(title).startsWith("ERROR") && String(title).length > 0) break;
    await sleep(100);
  }

  const before = await readEmbedderMark(win);
  let guestBefore = await readGuestTitle(guest);

  if (mode === "raw") {
    if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
    await guest.debugger.sendCommand("Page.reload", {});
  } else {
    await guest.executeJavaScript("document.title = 'dirty-guest'; window.__GUEST_DIRTY = true;");
    guestBefore = await readGuestTitle(guest);
    guest.reload();
  }

  await sleep(2500);
  const after = await readEmbedderMark(win);
  const guestAfter = await readGuestTitle(guest);
  const embedderSurvived = before === after && typeof after === "string" && after.startsWith("alive-");
  const guestReloaded = mode === "raw"
    ? true
    : guestAfter === "Example Domain";

  const result = {
    mode,
    electron: process.versions.electron,
    embedderBefore: before,
    embedderAfter: after,
    guestBefore,
    guestAfter,
    embedderSurvived,
    guestReloaded,
  };
  console.log("RESULT_JSON:" + JSON.stringify(result));
  // Always exit 0 if we produced a result — parent judges pass/fail.
  process.exit(0);
}).catch((error) => {
  console.error("FATAL:" + String(error && error.stack ? error.stack : error));
  process.exit(2);
});
`,
  );
  return runnerPath;
}

function runElectron(runnerPath) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, [runnerPath], {
      cwd: desktopRoot,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      const s = c.toString("utf8");
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (c) => {
      const s = c.toString("utf8");
      stderr += s;
      process.stderr.write(s);
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseResult(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith("RESULT_JSON:"));
  if (!line) return null;
  return JSON.parse(line.slice("RESULT_JSON:".length));
}

const rawRunner = writeRunner("raw");
const fixRunner = writeRunner("fix");

console.log("[reload-iso] electron=", electronPath);
console.log("[reload-iso] outDir=", outDir);

const rawRun = await runElectron(rawRunner);
const fixRun = await runElectron(fixRunner);

const raw = parseResult(rawRun.stdout);
const fix = parseResult(fixRun.stdout);

const summary = {
  ok: Boolean(fix?.embedderSurvived && fix?.guestReloaded),
  rawCdpPageReload: raw,
  webContentsReload: fix,
  exitCodes: { raw: rawRun.code, fix: fixRun.code },
};

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
