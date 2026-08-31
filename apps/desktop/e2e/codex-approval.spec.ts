import { expect, test } from "./fixtures/electron-app";

test("Codex bash approval completes thread with marker", async ({ ecoPage: page }) => {
  const marker = process.env.ECO_SMOKE_MARKER ?? `CODEX_APPROVAL_${Date.now()}`;
  const timeoutMs = Number.parseInt(process.env.ECO_SMOKE_TIMEOUT_MS ?? "120000", 10);
  const requestedThreadId = process.env.ECO_SMOKE_THREAD_ID?.trim();

  const codexThread = await page.evaluate(async (threadId) => {
    const threads = await window.eco.listThreads();
    const candidates = threads.filter(
      (thread) => thread.coreKind === "codex" && (!threadId || thread.id === threadId),
    );
    return candidates.find((thread) => thread.status !== "running" && thread.status !== "queued");
  }, requestedThreadId);

  expect(
    codexThread,
    requestedThreadId
      ? `Codex thread ${requestedThreadId} is missing or busy.`
      : "No idle Codex thread is available for approval smoke testing.",
  ).toBeTruthy();

  await page.evaluate(
    async ({ threadId, prompt }) => window.eco.continueThread({ threadId, prompt }),
    {
      threadId: codexThread!.id,
      prompt: [
        `Run this shell command: sleep 2 && printf ${marker}.`,
        "Do not modify files.",
        `After it completes, reply only with ${marker}.`,
      ].join(" "),
    },
  );

  const startedAt = Date.now();
  let approval: Awaited<ReturnType<typeof page.evaluate<unknown, string>>> | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    approval = await page.evaluate(
      async (threadId) => window.eco.getPendingBashApproval(threadId),
      codexThread!.id,
    );
    if (approval) {
      break;
    }
    const status = await page.evaluate(async (threadId) => window.eco.getThread(threadId), codexThread!.id);
    if (status?.status === "failed" || status?.status === "interrupted") {
      throw new Error(`Codex run ended before approval: ${status.status} ${status.message ?? ""}`);
    }
    await page.waitForTimeout(250);
  }

  expect(approval, `Timed out waiting for Codex approval on ${codexThread!.id}.`).toBeTruthy();

  await page.evaluate(
    async (toolUseId) => window.eco.resolveBashApproval({ toolUseId, decision: "approved" }),
    (approval as { toolUseId: string }).toolUseId,
  );

  let completedThread: Awaited<ReturnType<typeof page.evaluate<unknown, string>>> | undefined;
  let projection: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    [completedThread, projection] = await page.evaluate(async (threadId) =>
      Promise.all([window.eco.getThread(threadId), window.eco.getThreadRunProjection(threadId)]),
    codexThread!.id);
    if (
      (completedThread as { status?: string } | undefined)?.status !== "running" &&
      (completedThread as { status?: string } | undefined)?.status !== "queued"
    ) {
      break;
    }
    await page.waitForTimeout(250);
  }

  const projectionText = JSON.stringify(projection ?? {});
  expect(completedThread).toMatchObject({ status: "completed" });
  expect(projectionText).toContain(marker);

  console.log(
    JSON.stringify(
      {
        ok: true,
        threadId: codexThread!.id,
        marker,
        approval: {
          toolUseId: (approval as { toolUseId: string }).toolUseId,
          command: (approval as { command?: string }).command,
          kind: (approval as { kind?: string }).kind,
        },
        status: (completedThread as { status: string }).status,
      },
      null,
      2,
    ),
  );
});
