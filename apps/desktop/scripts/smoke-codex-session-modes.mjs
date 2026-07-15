import { chromium } from "playwright-core";

const cdpUrl = process.env.ECO_CDP_URL ?? "http://127.0.0.1:9222";
const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "180000", 10);
const markerSuffix = process.env.ECO_SMOKE_MARKER_SUFFIX ?? String(Date.now());
const askMarker = `CODEX_ASK_LIVE_OK_${markerSuffix}`;
const planMarker = `CODEX_PLAN_LIVE_OK_${markerSuffix}`;

const browser = await chromium.connectOverCDP(cdpUrl);
try {
  const page = findEcoPage(browser);
  await page.waitForLoadState("domcontentloaded");
  const template = await page.evaluate(async () => {
    const threads = await window.eco.listThreads();
    return threads.find(
      (thread) =>
        thread.coreKind === "codex" &&
        thread.runtimeConfig &&
        thread.status !== "running" &&
        thread.status !== "queued",
    );
  });
  if (!template?.runtimeConfig) {
    throw new Error("No idle Codex thread with a persisted runtime config is available.");
  }

  const ask = await startModeThread(page, {
    workspacePath: template.workspacePath,
    runtimeConfig: { ...template.runtimeConfig, sessionMode: "ask" },
    prompt: `Reply exactly ${askMarker}. Do not call tools or modify files.`,
  });
  const askResult = await waitForThread(page, ask.thread.id, ["completed"], timeoutMs);
  assertModeResult(askResult, {
    expectedMode: "ask",
    marker: askMarker,
    expectedStatus: "completed",
  });

  const plan = await startModeThread(page, {
    workspacePath: template.workspacePath,
    runtimeConfig: { ...template.runtimeConfig, sessionMode: "plan" },
    prompt: [
      "Create a concise implementation plan without calling tools or modifying files.",
      `Include the exact marker ${planMarker} in the plan.`,
    ].join(" "),
  });
  const planResult = await waitForThread(page, plan.thread.id, ["awaiting_plan"], timeoutMs);
  assertModeResult(planResult, {
    expectedMode: "plan",
    marker: planMarker,
    expectedStatus: "awaiting_plan",
    requirePendingPlan: true,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        ask: summarizeResult(askResult, askMarker),
        plan: summarizeResult(planResult, planMarker),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

function findEcoPage(browserInstance) {
  const pages = browserInstance.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
  if (!page) throw new Error("No Eco Electron page is available through CDP.");
  return page;
}

async function startModeThread(page, input) {
  return page.evaluate(async (request) => window.eco.startThread({ ...request, coreKind: "codex" }), input);
}

async function waitForThread(page, threadId, expectedStatuses, waitMs) {
  const startedAt = Date.now();
  let result;
  while (Date.now() - startedAt < waitMs) {
    result = await page.evaluate(async (id) => {
      const [thread, projection, pendingPlan] = await Promise.all([
        window.eco.getThread(id),
        window.eco.getThreadRunProjection(id),
        window.eco.getPendingPlan(id),
      ]);
      return { thread, projection, pendingPlan };
    }, threadId);
    const status = result.thread?.status;
    if (status && expectedStatuses.includes(status)) return result;
    if (status === "blocked" || status === "failed") {
      throw new Error(
        `Codex ${result.thread?.runtimeConfig?.sessionMode ?? "unknown"} smoke failed: ${status} ${result.thread?.message ?? ""}`,
      );
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for Codex thread ${threadId}: ${JSON.stringify(result?.thread ?? {})}`);
}

function assertModeResult(result, expected) {
  const projectionText = JSON.stringify(result.projection ?? {});
  if (result.thread?.coreKind !== "codex") throw new Error("Smoke thread is not bound to Codex Core.");
  if (result.thread?.runtimeConfig?.sessionMode !== expected.expectedMode) {
    throw new Error(
      `Expected ${expected.expectedMode} session mode, received ${result.thread?.runtimeConfig?.sessionMode ?? "missing"}.`,
    );
  }
  if (result.thread?.status !== expected.expectedStatus) {
    throw new Error(`Expected ${expected.expectedStatus}, received ${result.thread?.status ?? "missing"}.`);
  }
  if (!projectionText.includes(expected.marker)) {
    throw new Error(`Codex ${expected.expectedMode} projection is missing ${expected.marker}.`);
  }
  if (!projectionText.includes('"codexMethod"')) {
    throw new Error(`Codex ${expected.expectedMode} projection has no app-server event evidence.`);
  }
  if (expected.requirePendingPlan && !result.pendingPlan?.plan?.includes(expected.marker)) {
    throw new Error(`Codex plan handoff is missing ${expected.marker}.`);
  }
  const toolEvents = (result.projection?.timeline ?? []).filter((item) =>
    ["tool.started", "tool.completed", "tool.failed"].includes(item.eventType),
  );
  if (toolEvents.length > 0) {
    throw new Error(`Codex ${expected.expectedMode} smoke unexpectedly called ${toolEvents.length} tools.`);
  }
}

function summarizeResult(result, marker) {
  return {
    threadId: result.thread.id,
    coreKind: result.thread.coreKind,
    sessionMode: result.thread.runtimeConfig.sessionMode,
    status: result.thread.status,
    marker,
    timelineItems: result.projection?.timeline?.length ?? 0,
    pendingPlan: Boolean(result.pendingPlan),
  };
}
