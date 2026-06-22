import { expect, test } from "bun:test";
import { resolveOrphanedThreadRecoveryAction } from "../src/main/thread-orphan-recovery";

test("resolveOrphanedThreadRecoveryAction restores awaiting_plan when pending plan survives crash", () => {
  expect(
    resolveOrphanedThreadRecoveryAction({
      status: "running",
      hasActiveRun: false,
      hasPendingPlan: true,
    }),
  ).toBe("awaiting_plan");
  expect(
    resolveOrphanedThreadRecoveryAction({
      status: "idle",
      hasActiveRun: false,
      hasPendingPlan: true,
    }),
  ).toBe("awaiting_plan");
});

test("resolveOrphanedThreadRecoveryAction preserves execution_failed retry state", () => {
  expect(
    resolveOrphanedThreadRecoveryAction({
      status: "execution_failed",
      hasActiveRun: false,
      hasPendingPlan: true,
    }),
  ).toBe("none");
});

test("resolveOrphanedThreadRecoveryAction idles orphaned running threads without pending plan", () => {
  expect(
    resolveOrphanedThreadRecoveryAction({
      status: "running",
      hasActiveRun: false,
      hasPendingPlan: false,
    }),
  ).toBe("idle");
});
