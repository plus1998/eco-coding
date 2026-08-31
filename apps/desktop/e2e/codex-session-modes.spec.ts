import { expect, test } from "./fixtures/electron-app";

test("Codex ask and plan session modes behave correctly", async ({ ecoPage: page }) => {
  const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "180000", 10);
  const markerSuffix = process.env.ECO_SMOKE_MARKER_SUFFIX ?? String(Date.now());
  const askMarker = `CODEX_ASK_LIVE_OK_${markerSuffix}`;
  const planMarker = `CODEX_PLAN_LIVE_OK_${markerSuffix}`;

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

  expect(template?.runtimeConfig, "No idle Codex thread with a persisted runtime config is available.").toBeTruthy();

  const ask = await page.evaluate(
    async (request) => window.eco.startThread({ ...request, coreKind: "codex" }),
    {
      workspacePath: template!.workspacePath,
      runtimeConfig: { ...template!.runtimeConfig!, sessionMode: "ask" },
      prompt: `Reply exactly ${askMarker}. Do not call tools or modify files.`,
    },
  );

  const askResult = await waitForThread(page, ask.thread.id, ["completed"], timeoutMs);
  assertModeResult(askResult, {
    expectedMode: "ask",
    marker: askMarker,
    expectedStatus: "completed",
  });

  const plan = await page.evaluate(
    async (request) => window.eco.startThread({ ...request, coreKind: "codex" }),
    {
      workspacePath: template!.workspacePath,
      runtimeConfig: { ...template!.runtimeConfig!, sessionMode: "plan" },
      prompt: [
        "Create a concise implementation plan without calling tools or modifying files.",
        `Include the exact marker ${planMarker} in the plan.`,
      ].join(" "),
    },
  );

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
});

type ModeResult = {
  thread?: {
    id: string;
    coreKind?: string;
    status?: string;
    message?: string;
    runtimeConfig?: { sessionMode?: string };
  };
  projection?: { timeline?: Array<{ eventType?: string }> };
  pendingPlan?: { plan?: string };
};

async function waitForThread(
  page: import("@playwright/test").Page,
  threadId: string,
  expectedStatuses: string[],
  waitMs: number,
): Promise<ModeResult> {
  const startedAt = Date.now();
  let result: ModeResult | undefined;
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
    if (status && expectedStatuses.includes(status)) {
      return result;
    }
    if (status === "blocked" || status === "failed") {
      throw new Error(
        `Codex ${result.thread?.runtimeConfig?.sessionMode ?? "unknown"} smoke failed: ${status} ${result.thread?.message ?? ""}`,
      );
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Timed out waiting for Codex thread ${threadId}: ${JSON.stringify(result?.thread ?? {})}`);
}

function assertModeResult(
  result: ModeResult,
  expected: {
    expectedMode: string;
    marker: string;
    expectedStatus: string;
    requirePendingPlan?: boolean;
  },
): void {
  const projectionText = JSON.stringify(result.projection ?? {});
  expect(result.thread?.coreKind).toBe("codex");
  expect(result.thread?.runtimeConfig?.sessionMode).toBe(expected.expectedMode);
  expect(result.thread?.status).toBe(expected.expectedStatus);
  expect(projectionText).toContain(expected.marker);
  expect(projectionText).toContain('"codexMethod"');
  if (expected.requirePendingPlan) {
    expect(result.pendingPlan?.plan).toContain(expected.marker);
  }
  const toolEvents = (result.projection?.timeline ?? []).filter((item) =>
    ["tool.started", "tool.completed", "tool.failed"].includes(item.eventType ?? ""),
  );
  expect(toolEvents.length).toBe(0);
}

function summarizeResult(result: ModeResult, marker: string) {
  return {
    threadId: result.thread!.id,
    coreKind: result.thread!.coreKind,
    sessionMode: result.thread!.runtimeConfig!.sessionMode,
    status: result.thread!.status,
    marker,
    timelineItems: result.projection?.timeline?.length ?? 0,
    pendingPlan: Boolean(result.pendingPlan),
  };
}
