import { expect, test } from "./fixtures/electron-app";

test("resolving a missing bash approval is idempotent success", async ({ ecoPage: page }) => {
  const ghostToolUseId = `tool_idempotent_ghost_${Date.now()}`;

  const result = await page.evaluate(async (toolUseId) => {
    try {
      return await window.eco.resolveBashApproval({
        toolUseId,
        decision: "approved",
      });
    } catch (error) {
      return {
        threw: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, ghostToolUseId);

  expect(result, "stale/missing approval must not throw").toEqual({
    ok: true,
    alreadyResolved: true,
  });
});

test("live bash approval can be resolved twice without error", async ({ ecoPage: page }) => {
  const codexThread = await page.evaluate(async () => {
    const threads = await window.eco.listThreads();
    return threads.find(
      (thread) =>
        thread.coreKind === "codex" && thread.status !== "running" && thread.status !== "queued",
    );
  });

  test.skip(!codexThread, "No idle Codex thread available for live double-resolve.");

  const marker = `IDEM_APPROVAL_${Date.now()}`;
  await page.evaluate(
    async ({ threadId, prompt }) => window.eco.continueThread({ threadId, prompt }),
    {
      threadId: codexThread!.id,
      prompt: [
        `Run this shell command: sleep 1 && printf ${marker}.`,
        "Do not modify files.",
        `After it completes, reply only with ${marker}.`,
      ].join(" "),
    },
  );

  const timeoutMs = 90_000;
  const startedAt = Date.now();
  let approval: { toolUseId: string } | undefined;
  while (Date.now() - startedAt < timeoutMs) {
    const pending = await page.evaluate(
      async (threadId) => window.eco.getPendingBashApproval(threadId),
      codexThread!.id,
    );
    if (pending?.toolUseId) {
      approval = pending;
      break;
    }
    const status = await page.evaluate(async (threadId) => window.eco.getThread(threadId), codexThread!.id);
    if (status?.status === "failed" || status?.status === "interrupted") {
      throw new Error(`Run ended before approval: ${status.status}`);
    }
    await page.waitForTimeout(250);
  }

  expect(approval, "Timed out waiting for pending bash approval").toBeTruthy();

  const first = await page.evaluate(
    async (toolUseId) => window.eco.resolveBashApproval({ toolUseId, decision: "approved" }),
    approval!.toolUseId,
  );
  expect(first).toMatchObject({ ok: true });

  const second = await page.evaluate(async (toolUseId) => {
    try {
      return await window.eco.resolveBashApproval({ toolUseId, decision: "approved" });
    } catch (error) {
      return {
        threw: true,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }, approval!.toolUseId);

  expect(second).toEqual({ ok: true, alreadyResolved: true });
});
