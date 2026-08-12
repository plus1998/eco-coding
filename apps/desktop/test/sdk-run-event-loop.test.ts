import { expect, test } from "bun:test";
import { consumeSdkRunEvents, type SdkRunEventLike } from "../src/main/sdk-run-event-loop";

async function* events(items: SdkRunEventLike[]): AsyncIterable<SdkRunEventLike> {
  for (const item of items) {
    yield item;
  }
}

function createHarness() {
  const calls: string[] = [];
  return {
    calls,
    onUsageRecorded(threadId: string, event: SdkRunEventLike) {
      calls.push(`usage:${threadId}:${event.type}`);
    },
    captureSession(threadId: string, event: SdkRunEventLike, worktreePath: string) {
      calls.push(`capture:${threadId}:${event.type}:${worktreePath}`);
    },
    emitActivity(threadId: string, event: SdkRunEventLike) {
      calls.push(`activity:${threadId}:${event.type}`);
    },
  };
}

test("consumeSdkRunEvents treats usage.recorded as billing-only when run.terminal is present", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "usage.recorded",
        payload: { type: "result", subtype: "error", result: "upstream failed" },
      },
      {
        type: "run.terminal",
        payload: { status: "failed", error: "upstream failed" },
      },
    ]),
    threadId: "thr_usage",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: false, reason: "upstream failed" });
  expect(harness.calls).toEqual(["usage:thr_usage:usage.recorded"]);
});

test("consumeSdkRunEvents keeps legacy result-shaped usage outcome without run.terminal", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "usage.recorded",
        payload: { type: "result", subtype: "error", result: "legacy fail" },
      },
    ]),
    threadId: "thr_legacy",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: false, reason: "legacy fail" });
});

test("consumeSdkRunEvents ignores post-terminal usage and diagnostics", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      { type: "run.terminal", payload: { status: "completed" } },
      {
        type: "usage.recorded",
        payload: { type: "sdk_context_usage", ecoSdkContextUsage: { used: 1 } },
      },
      { type: "agent.started", payload: { label: "diag" } },
    ]),
    threadId: "thr_post",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: true });
  expect(harness.calls).toEqual([
    "usage:thr_post:usage.recorded",
    "capture:thr_post:agent.started:/tmp/worktree",
    "activity:thr_post:agent.started",
  ]);
});

test("consumeSdkRunEvents succeeds from explicit run.terminal completed", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "usage.recorded",
        payload: { type: "sdk_context_usage", ecoSdkContextUsage: {} },
      },
      { type: "run.terminal", payload: { status: "completed" } },
    ]),
    threadId: "thr_ok",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: true });
  expect(harness.calls).toEqual(["usage:thr_ok:usage.recorded"]);
});

test("consumeSdkRunEvents fails incomplete when Claude emits incomplete run.terminal", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "usage.recorded",
        payload: { type: "sdk_context_usage", ecoSdkContextUsage: {} },
      },
      {
        type: "run.terminal",
        payload: {
          status: "incomplete",
          reason: "Claude run ended without a terminal result.",
        },
      },
    ]),
    threadId: "thr_incomplete",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({
    ok: false,
    reason: "Claude run ended without a terminal result.",
    incomplete: true,
  });
});

test("resolveClaudeRunAttemptFromTerminalState marks running as incomplete", async () => {
  const { resolveClaudeRunAttemptFromTerminalState } = await import("../src/main/claude-run-terminal");
  expect(
    resolveClaudeRunAttemptFromTerminalState({ kind: "running" }, new AbortController().signal),
  ).toEqual({
    ok: false,
    reason: "Claude run ended without a terminal result.",
    incomplete: true,
  });
});

test("consumeSdkRunEvents preserves resumable incomplete terminal results", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "run.terminal",
        payload: {
          status: "incomplete",
          reason: "模型输出达到 max_tokens 上限，响应已被截断；执行尚未完成，请继续执行或提高模型输出上限。",
        },
      },
    ]),
    threadId: "thr_truncated",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toMatchObject({ ok: false, incomplete: true });
  if (!result.ok) {
    expect(result.reason).toContain("max_tokens");
  }
});

test("consumeSdkRunEvents abort wins over run.terminal completed", async () => {
  const harness = createHarness();
  const controller = new AbortController();
  controller.abort();

  const result = await consumeSdkRunEvents({
    events: events([{ type: "run.terminal", payload: { status: "completed" } }]),
    threadId: "thr_abort_win",
    worktreePath: "/tmp/worktree",
    signal: controller.signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: false, reason: "cancelled by user", aborted: true });
});

test("consumeSdkRunEvents uses last run.terminal for multi-turn Query results", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      // Mid-turn / streaming-input: each SDK turn may emit a result → run.terminal.
      { type: "run.terminal", payload: { status: "completed" } },
      { type: "run.terminal", payload: { status: "failed", error: "second turn failed" } },
    ]),
    threadId: "thr_multi_turn",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({
    ok: false,
    reason: "second turn failed",
  });
});

test("consumeSdkRunEvents last completed run.terminal succeeds after earlier turn", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      { type: "run.terminal", payload: { status: "failed", error: "first turn" } },
      { type: "run.terminal", payload: { status: "completed" } },
    ]),
    threadId: "thr_multi_turn_ok",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: true });
});

test("consumeSdkRunEvents captures sessions, runs custom handler, then emits activity", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      { type: "plan.ready", payload: { plan: "do it" } },
      { type: "run.terminal", payload: { status: "completed" } },
    ]),
    threadId: "thr_plan",
    worktreePath: "/tmp/worktree",
    signal: new AbortController().signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: harness.captureSession,
    emitActivity: harness.emitActivity,
    onEvent: (event) => {
      harness.calls.push(`custom:${event.type}`);
    },
  });

  expect(result).toEqual({ ok: true });
  expect(harness.calls).toEqual([
    "capture:thr_plan:plan.ready:/tmp/worktree",
    "custom:plan.ready",
    "activity:thr_plan:plan.ready",
    "custom:run.terminal",
  ]);
});

test("consumeSdkRunEvents reports cancelled when signal is aborted after stream", async () => {
  const harness = createHarness();
  const controller = new AbortController();

  const result = await consumeSdkRunEvents({
    events: events([
      { type: "session.captured", payload: { sessionId: "s1", cwd: "/tmp/worktree" } },
      { type: "run.terminal", payload: { status: "completed" } },
    ]),
    threadId: "thr_cancel",
    worktreePath: "/tmp/worktree",
    signal: controller.signal,
    onUsageRecorded: harness.onUsageRecorded,
    captureSession: (...args) => {
      harness.captureSession(...args);
      controller.abort();
    },
    emitActivity: harness.emitActivity,
  });

  expect(result).toEqual({ ok: false, reason: "cancelled by user", aborted: true });
  expect(harness.calls).toEqual([
    "capture:thr_cancel:session.captured:/tmp/worktree",
    "activity:thr_cancel:session.captured",
  ]);
});
