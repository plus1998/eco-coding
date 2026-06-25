import { expect, test } from "bun:test";
import {
  isRequestAttemptAborted,
  resolveAskRunOutcome,
  resolveAutonomousRunOutcome,
  resolveContinuationRunOutcome,
  resolveExecutionRunOutcome,
  resolvePlanningRunOutcome,
  runAttemptPhaseFromThreadMode,
} from "../src/main/thread-run-outcome";

test("resolveAskRunOutcome maps cancelled failed and completed results", () => {
  expect(resolveAskRunOutcome({ ok: false, reason: "stop", aborted: true })).toEqual({
    kind: "cancelled",
    reason: "cancelled by user",
  });
  expect(resolveAskRunOutcome({ ok: false, reason: "upstream failed" })).toEqual({
    kind: "failed",
    reason: "upstream failed",
  });
  expect(resolveAskRunOutcome({ ok: true })).toEqual({
    kind: "completed",
    message: "回答完成。",
  });
});

test("resolveAutonomousRunOutcome only waits for existing pending plans", () => {
  expect(resolveAutonomousRunOutcome({ ok: true }, { hasPendingPlan: true, planCaptured: false })).toEqual({
    kind: "awaiting_plan",
    message: "等待你确认计划。",
  });
  expect(resolveAutonomousRunOutcome({ ok: true }, { hasPendingPlan: false, planCaptured: true })).toEqual({
    kind: "completed",
  });
  expect(resolveAutonomousRunOutcome({ ok: true }, { hasPendingPlan: false, planCaptured: false })).toEqual({
    kind: "completed",
  });
});

test("resolvePlanningRunOutcome returns awaiting plan or idle", () => {
  expect(resolvePlanningRunOutcome({ ok: true }, { hasPendingPlan: true })).toEqual({
    kind: "awaiting_plan",
    message: "等待你确认计划。",
  });
  expect(resolvePlanningRunOutcome({ ok: true }, { hasPendingPlan: false })).toEqual({
    kind: "idle",
    message: "计划阶段已结束。",
  });
});

test("resolveExecutionRunOutcome returns completed on success", () => {
  expect(resolveExecutionRunOutcome({ ok: true })).toEqual({ kind: "completed" });
  expect(resolveExecutionRunOutcome({ ok: false, reason: "blocked" })).toEqual({
    kind: "failed",
    reason: "blocked",
  });
});

test("resolveContinuationRunOutcome keeps mode-specific success decisions", () => {
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "execution", planningPlanCaptured: false }),
  ).toEqual({ kind: "completed" });
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "ask", planningPlanCaptured: false }),
  ).toEqual({
    kind: "completed",
    message: "回答完成。",
  });
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "planning", planningPlanCaptured: true }),
  ).toEqual({
    kind: "awaiting_plan",
    message: "等待你确认计划。",
  });
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "planning", planningPlanCaptured: false }),
  ).toEqual({
    kind: "idle",
    message: "计划阶段已结束。",
  });
});

test("runAttemptPhaseFromThreadMode and isRequestAttemptAborted expose shared run helpers", () => {
  expect(runAttemptPhaseFromThreadMode("ask")).toBe("ask");
  expect(runAttemptPhaseFromThreadMode("planning")).toBe("planning");
  expect(runAttemptPhaseFromThreadMode("execution")).toBe("execution");
  expect(isRequestAttemptAborted({ ok: false, reason: "stop", aborted: true })).toBe(true);
  expect(isRequestAttemptAborted({ ok: false, reason: "failed" })).toBe(false);
});
