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

test("consumeSdkRunEvents records usage failures without emitting activity", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "usage.recorded",
        payload: { type: "result", subtype: "error", result: "upstream failed" },
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

test("consumeSdkRunEvents preserves resumable incomplete terminal results", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([
      {
        type: "usage.recorded",
        payload: {
          type: "result",
          subtype: "success",
          stop_reason: "max_tokens",
          terminal_reason: "completed",
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
  expect(harness.calls).toEqual(["usage:thr_truncated:usage.recorded"]);
});

test("consumeSdkRunEvents captures sessions, runs custom handler, then emits activity", async () => {
  const harness = createHarness();

  const result = await consumeSdkRunEvents({
    events: events([{ type: "plan.ready", payload: { plan: "do it" } }]),
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
  ]);
});

test("consumeSdkRunEvents reports cancelled when signal is aborted after stream", async () => {
  const harness = createHarness();
  const controller = new AbortController();

  const result = await consumeSdkRunEvents({
    events: events([{ type: "session.captured", payload: { sessionId: "s1", cwd: "/tmp/worktree" } }]),
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
