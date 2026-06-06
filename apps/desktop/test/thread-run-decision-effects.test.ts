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

test("applyThreadRunDecisionEffects applies default status updates", async () => {
  const { effects, updates } = createUpdateCapture();

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "awaiting_plan", message: "等待你确认计划。" },
      effects,
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "idle", message: "计划阶段已结束。" },
      effects,
    }),
  ).toBe(true);
  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "completed", message: "回答完成。" },
      effects,
    }),
  ).toBe(true);

  expect(updates).toEqual([
    {
      threadId: "thr_decision",
      patch: { status: "awaiting_plan", message: "等待你确认计划。" },
    },
    {
      threadId: "thr_decision",
      patch: { status: "idle", message: "计划阶段已结束。" },
    },
    {
      threadId: "thr_decision",
      patch: { status: "completed", message: "回答完成。" },
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
      decision: { kind: "awaiting_plan", message: "等待你确认计划。" },
      effects,
      onAwaitingPlan: (message) => {
        calls.push(`awaiting:${message}`);
      },
    }),
  ).toBe(true);

  expect(calls).toEqual(["completed:none", "awaiting:等待你确认计划。"]);
  expect(updates).toEqual([]);
});

test("applyThreadRunDecisionEffects returns false when no handler can own a decision", async () => {
  const { effects, updates } = createUpdateCapture();

  expect(
    await applyThreadRunDecisionEffects({
      threadId: "thr_decision",
      decision: { kind: "completed" },
      effects,
    }),
  ).toBe(false);
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
