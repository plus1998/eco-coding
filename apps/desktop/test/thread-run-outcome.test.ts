import { expect, test } from "bun:test";
import {
  isRequestAttemptAborted,
  resolveAskRunOutcome,
  resolveAutonomousRunOutcome,
  resolveContinuationRunOutcome,
  resolveExecutionRunOutcome,
  resolvePlanningRunOutcome,
  resolvePlanSessionRunOutcome,
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
  expect(
    resolveAskRunOutcome({
      ok: false,
      reason: "Error: RetriableError: [resource_exhausted] Error",
      unstarted: true,
    }),
  ).toEqual({
    kind: "unstarted",
    reason: "Error: RetriableError: [resource_exhausted] Error",
  });
  expect(resolveAskRunOutcome({ ok: true })).toEqual({
    kind: "completed",
  });
});

test("resolveAutonomousRunOutcome only waits for existing pending plans", () => {
  expect(resolveAutonomousRunOutcome({ ok: true }, { hasPendingPlan: true, planCaptured: false })).toEqual({
    kind: "awaiting_plan",
    message: "",
  });
  expect(resolveAutonomousRunOutcome({ ok: true }, { hasPendingPlan: false, planCaptured: true })).toEqual({
    kind: "completed",
  });
  expect(resolveAutonomousRunOutcome({ ok: true }, { hasPendingPlan: false, planCaptured: false })).toEqual({
    kind: "completed",
  });
});

test("resolvePlanningRunOutcome returns awaiting plan or idle on success", () => {
  expect(resolvePlanningRunOutcome({ ok: true }, { hasPendingPlan: true })).toEqual({
    kind: "awaiting_plan",
    message: "",
  });
  expect(resolvePlanningRunOutcome({ ok: true }, { hasPendingPlan: false })).toEqual({
    kind: "idle",
    message: "",
  });
});

test("resolvePlanningRunOutcome keeps awaiting_plan when upstream fails after plan capture", () => {
  expect(
    resolvePlanningRunOutcome({ ok: false, reason: "ACP process exited" }, { hasPendingPlan: true }),
  ).toEqual({ kind: "awaiting_plan", message: "" });
  expect(
    resolvePlanningRunOutcome({ ok: false, reason: "stop", aborted: true }, { hasPendingPlan: true }),
  ).toEqual({ kind: "cancelled", reason: "cancelled by user" });
});

test("resolveAutonomousRunOutcome keeps awaiting_plan on non-cancel failure with pending plan", () => {
  expect(
    resolveAutonomousRunOutcome(
      { ok: false, reason: "disconnected" },
      { hasPendingPlan: true, planCaptured: true },
    ),
  ).toEqual({ kind: "awaiting_plan", message: "" });
});

test("resolvePlanSessionRunOutcome treats an approved in-session plan as execution", () => {
  expect(
    resolvePlanSessionRunOutcome({ ok: true }, { hasPendingPlan: false, enteredExecution: true }),
  ).toEqual({ kind: "completed" });
  expect(
    resolvePlanSessionRunOutcome({ ok: true }, { hasPendingPlan: true, enteredExecution: false }),
  ).toEqual({ kind: "awaiting_plan", message: "" });
});

test("resolveExecutionRunOutcome returns completed on success", () => {
  expect(resolveExecutionRunOutcome({ ok: true })).toEqual({ kind: "completed" });
  expect(resolveExecutionRunOutcome({ ok: false, reason: "blocked" })).toEqual({
    kind: "failed",
    reason: "blocked",
  });
  expect(resolveExecutionRunOutcome({ ok: false, reason: "tasks remain", incomplete: true })).toEqual({
    kind: "incomplete",
    reason: "tasks remain",
  });
});

test("resolveContinuationRunOutcome keeps mode-specific success decisions", () => {
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "execution", planningPlanCaptured: false }),
  ).toEqual({ kind: "completed" });
  expect(resolveContinuationRunOutcome({ ok: true }, { mode: "ask", planningPlanCaptured: false })).toEqual({
    kind: "completed",
  });
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "planning", planningPlanCaptured: true }),
  ).toEqual({
    kind: "awaiting_plan",
    message: "",
  });
  expect(
    resolveContinuationRunOutcome({ ok: true }, { mode: "planning", planningPlanCaptured: false }),
  ).toEqual({
    kind: "idle",
    message: "",
  });
});

test("runAttemptPhaseFromThreadMode and isRequestAttemptAborted expose shared run helpers", () => {
  expect(runAttemptPhaseFromThreadMode("ask")).toBe("ask");
  expect(runAttemptPhaseFromThreadMode("planning")).toBe("planning");
  expect(runAttemptPhaseFromThreadMode("execution")).toBe("execution");
  expect(isRequestAttemptAborted({ ok: false, reason: "stop", aborted: true })).toBe(true);
  expect(isRequestAttemptAborted({ ok: false, reason: "failed" })).toBe(false);
});
