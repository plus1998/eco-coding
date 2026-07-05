import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const marker = process.env.ECO_SMOKE_MARKER ?? `ECO_FEED_LOADING_${Date.now()}`;
const sleepSeconds = Number.parseInt(process.env.ECO_SMOKE_SLEEP_SECONDS ?? "8", 10);
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "60000", 10);
const connectOnly = process.argv.includes("--connect-only") || process.env.ECO_SMOKE_CONNECT_ONLY === "1";
const prompt =
  process.env.ECO_SMOKE_PROMPT ??
  [
    `Run this safe Bash command with the Bash tool: sleep ${sleepSeconds} && echo ${marker}.`,
    "Do not modify files.",
    `After the command completes, reply only with ${marker}.`,
  ].join(" ");

const browser = await chromium.connectOverCDP(cdpUrl);
const page = await findEcoPage(browser);
await page.bringToFront();

if (connectOnly) {
  console.log(`[smoke-feed-loading] connected title=${JSON.stringify(await page.title())} url=${page.url()}`);
  process.exit(0);
}

await fillComposer(page, prompt);
await clickSend(page);

const samples = [];
let approvals = 0;
let sawInlineLoading = false;
const startedAt = Date.now();

while (Date.now() - startedAt < timeoutMs) {
  approvals += await approveBashIfPresent(page);
  const state = await readFeedLoadingState(page);
  samples.push(state);
  if (state.inlineLoading > 0) {
    sawInlineLoading = true;
    break;
  }
  await page.waitForTimeout(500);
}

if (!sawInlineLoading) {
  throw new Error(formatFailure("Timed out waiting for .run-log-inline-loading to appear.", samples));
}

while (Date.now() - startedAt < timeoutMs) {
  approvals += await approveBashIfPresent(page);
  const state = await readFeedLoadingState(page);
  samples.push(state);
  if (state.inlineLoading === 0) {
    const report = {
      ok: true,
      cdpUrl,
      marker,
      approvals,
      sawInlineLoading,
      lastAction: state.latestActions.at(-1),
      lastState: state,
    };
    console.log(`[smoke-feed-loading] ok marker=${marker} approvals=${approvals}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  await page.waitForTimeout(500);
}

throw new Error(formatFailure("Timed out waiting for .run-log-inline-loading to disappear.", samples));

async function findEcoPage(browser) {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const existing =
    pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:5173/")) ??
    pages.find((candidate) => candidate.url().startsWith("http://localhost:5173/")) ??
    pages[0];
  if (!existing) {
    throw new Error("No Electron page is available through CDP.");
  }
  await existing.waitForLoadState("domcontentloaded");
  return existing;
}

async function fillComposer(page, text) {
  const composer = page.locator('.composer-skill-input-control[role="textbox"]').first();
  await composer.waitFor({ state: "visible", timeout: 10_000 });
  await composer.evaluate((node, value) => {
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("insertText", false, value);
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }, text);
  await page.waitForFunction(() => {
    const button = document.querySelector("button.send-button");
    return button instanceof HTMLButtonElement && !button.disabled;
  });
}

async function clickSend(page) {
  await page.locator("button.send-button").click();
}

async function approveBashIfPresent(page) {
  const approveButton = page
    .locator(
      [
        ".bash-approval-dock-shell button.bash-approval-option-row",
        ".bash-approval-panel button.bash-approval-option-row",
      ].join(", "),
    )
    .filter({ hasText: /^是$/ })
    .first();
  if ((await approveButton.count()) === 0) {
    return 0;
  }
  try {
    await approveButton.click({ timeout: 500 });
    return 1;
  } catch {
    return 0;
  }
}

async function readFeedLoadingState(page) {
  return await page.evaluate(() => ({
    elapsedAt: new Date().toISOString(),
    inlineLoading: document.querySelectorAll(".run-log-inline-loading").length,
    inlineDots: Array.from(document.querySelectorAll(".run-log-inline-loading"))
      .map((node) => node.textContent ?? "")
      .join("|"),
    runningActionNodes: document.querySelectorAll(
      ".run-log-action-trigger.is-running, .run-log-tool-group-trigger.is-running",
    ).length,
    latestActions: Array.from(
      document.querySelectorAll(
        [
          ".run-log-action-trigger",
          ".run-log-tool-group-trigger",
          ".run-log-read-target",
          ".run-log-grep-target",
          ".run-log-bash-card",
          ".run-log-file-change-card",
        ].join(", "),
      ),
    )
      .slice(-5)
      .map((node) => ({
        className: String(node.className ?? ""),
        text: (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      })),
  }));
}

function formatFailure(message, samples) {
  return `${message}\n${JSON.stringify({ cdpUrl, marker, samples: samples.slice(-8) }, null, 2)}`;
}
