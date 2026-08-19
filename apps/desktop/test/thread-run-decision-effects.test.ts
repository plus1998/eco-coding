import { expect, test } from "bun:test";
import {
  applyThreadRunDecisionEffects,
  type ThreadRunDecisionStatusPatch,
} from "../src/main/thread-run-decision-effects";

function createUpdateCapture() {
  const updates: Array<{ threadId: string; patch: ThreadRunDecisionStatusPatch }> = [];
  return {
    updates,
    effects: {
      updateThread: (threadId: string, patch: ThreadRunDecisionStatusPatch) => {
        updates.push({ threadId, patch });
      },
    },
  };
}

test("applyThreadRunDecisionEffects delegates cancelled and failed decisions", async () => {
  const { effects, updates } = createUpdateCapture();
  const calls: string[] = [];

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "cancelled", reason: "cancelled by user" },
      effects,
      onCancelled: async (reason) => {
        calls.push(`cancelled:${reason}`);
      },
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "failed", reason: "upstream failed" },
      effects,
      onFailed: (reason) => {
        calls.push(`failed:${reason}`);
      },
    }),
  ).toBe(true);

  expect(calls).toEqual(["cancelled:cancelled by user", "failed:upstream failed"]);
  expect(updates).toEqual([]);
});

test("applyThreadRunDecisionEffects prefers onUnstarted then onFailed", async () => {
  const { effects } = createUpdateCapture();
  const calls: string[] = [];

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "unstarted", reason: "zero output" },
      effects,
      onUnstarted: (reason) => {
        calls.push(`unstarted:${reason}`);
      },
      onFailed: (reason) => {
        calls.push(`failed:${reason}`);
      },
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "unstarted", reason: "zero output" },
      effects,
      onFailed: (reason) => {
        calls.push(`fallback:${reason}`);
      },
    }),
  ).toBe(true);

  expect(calls).toEqual(["unstarted:zero output", "fallback:zero output"]);
});

test("applyThreadRunDecisionEffects applies default status updates", async () => {
  const { effects, updates } = createUpdateCapture();

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "incomplete", reason: "任务尚未完成。" },
      effects,
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "awaiting_plan", message: "" },
      effects,
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "idle", message: "" },
      effects,
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "completed" },
      effects,
    }),
  ).toBe(true);

  expect(updates).toEqual([
    {
      threadId: "thr_decision",
      patch: { status: "blocked", message: "任务尚未完成。" },
    },
    {
      threadId: "thr_decision",
      patch: { status: "awaiting_plan", message: "" },
    },
    {
      threadId: "thr_decision",
      patch: { status: "idle", message: "" },
    },
    {
      threadId: "thr_decision",
      patch: { status: "completed", message: "" },
    },
  ]);
});

test("applyThreadRunDecisionEffects lets callers override success handlers", async () => {
  const { effects, updates } = createUpdateCapture();
  const calls: string[] = [];

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "completed" },
      effects,
      onCompleted: (message) => {
        calls.push(`completed:${message ?? "none"}`);
      },
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "awaiting_plan", message: "" },
      effects,
      onAwaitingPlan: (message) => {
        calls.push(`awaiting:${message || "empty"}`);
      },
    }),
  ).toBe(true);

  expect(calls).toEqual(["completed:none", "awaiting:empty"]);
  expect(updates).toEqual([]);
});

test("applyThreadRunDecisionEffects returns false when no handler can own a decision", async () => {
  const { effects, updates } = createUpdateCapture();

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "cancelled", reason: "cancelled by user" },
      effects,
    }),
  ).toBe(false);
  expect(updates).toEqual([]);
});

test("applyThreadRunDecisionEffects awaits async handlers before returning", async () => {
  const { effects } = createUpdateCapture();
  const calls: string[] = [];

  const handled = await applyThreadRunDecisionEffects({
    threadId: "thr_decision",
    decision: { kind: "failed", reason: "blocked" },
    effects,
    onFailed: async (reason) => {
      calls.push(`start:${reason}`);
      await Promise.resolve();
      calls.push(`finish:${reason}`);
    },
  });

  expect(handled).toBe(true);
  expect(calls).toEqual(["start:blocked", "finish:blocked"]);
});
