import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const marker = process.env.ECO_SMOKE_MARKER ?? `CODEX_APPROVAL_${Date.now()}`;
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "120000", 10);
const requestedThreadId = process.env.ECO_SMOKE_THREAD_ID?.trim();

const browser = await chromium.connectOverCDP(cdpUrl);
const page = await findEcoPage(browser);
const codexThread = await page.evaluate(async (threadId) => {
  const threads = await window.eco.listThreads();
  const candidates = threads.filter(
    (thread) => thread.coreKind === "codex" && (!threadId || thread.id === threadId),
  );
  return candidates.find((thread) => thread.status !== "running" && thread.status !== "queued");
}, requestedThreadId);

if (!codexThread) {
  throw new Error(
    requestedThreadId
      ? `Codex thread ${requestedThreadId} is missing or busy.`
      : "No idle Codex thread is available for approval smoke testing.",
  );
}

await page.evaluate(
  async ({ threadId, prompt }) => window.eco.continueThread({ threadId, prompt }),
  {
    threadId: codexThread.id,
    prompt: [
      `Run this shell command: sleep 2 && printf ${marker}.`,
      "Do not modify files.",
      `After it completes, reply only with ${marker}.`,
    ].join(" "),
  },
);

const startedAt = Date.now();
let approval;
while (Date.now() - startedAt < timeoutMs) {
  approval = await page.evaluate(
    async (threadId) => window.eco.getPendingBashApproval(threadId),
    codexThread.id,
  );
  if (approval) {
    break;
  }
  const status = await page.evaluate(async (threadId) => window.eco.getThread(threadId), codexThread.id);
  if (status?.status === "failed" || status?.status === "interrupted") {
    throw new Error(`Codex run ended before approval: ${status.status} ${status.message ?? ""}`);
  }
  await page.waitForTimeout(250);
}

if (!approval) {
  throw new Error(`Timed out waiting for Codex approval on ${codexThread.id}.`);
}

await page.evaluate(
  async (toolUseId) => window.eco.resolveBashApproval({ toolUseId, decision: "approved" }),
  approval.toolUseId,
);

let completedThread;
let projection;
while (Date.now() - startedAt < timeoutMs) {
  [completedThread, projection] = await page.evaluate(async (threadId) =>
    Promise.all([window.eco.getThread(threadId), window.eco.getThreadRunProjection(threadId)]),
  codexThread.id);
  if (completedThread?.status !== "running" && completedThread?.status !== "queued") {
    break;
  }
  await page.waitForTimeout(250);
}

const projectionText = JSON.stringify(projection ?? {});
if (completedThread?.status !== "completed" || !projectionText.includes(marker)) {
  throw new Error(
    `Codex approval smoke did not complete with marker: ${JSON.stringify({
      thread: completedThread,
      projection,
    })}`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      threadId: codexThread.id,
      marker,
      approval: {
        toolUseId: approval.toolUseId,
        command: approval.command,
        kind: approval.kind,
      },
      status: completedThread.status,
    },
    null,
    2,
  ),
);
await browser.close();

async function findEcoPage(browserInstance) {
  const pages = browserInstance.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
  if (!page) {
    throw new Error("No Eco Electron page is available through CDP.");
  }
  await page.waitForLoadState("domcontentloaded");
  return page;
}
