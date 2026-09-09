import { expect, test } from "bun:test";
import {
  resolveOrphanedThreadRecoveryAction,
  shouldClearGhostAcpActiveRun,
} from "../src/main/thread-orphan-recovery";

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

test("shouldClearGhostAcpActiveRun only for ACP with ActiveRun but no in-flight turn", () => {
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "acp",
      status: "running",
      hasActiveRun: true,
      acpTurnInFlight: false,
      hasPendingPlan: false,
    }),
  ).toBe(true);
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "acp",
      status: "running",
      hasActiveRun: true,
      acpTurnInFlight: true,
      hasPendingPlan: false,
    }),
  ).toBe(false);
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "claude",
      status: "running",
      hasActiveRun: true,
      acpTurnInFlight: false,
      hasPendingPlan: false,
    }),
  ).toBe(false);
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "acp",
      status: "running",
      hasActiveRun: false,
      acpTurnInFlight: false,
      hasPendingPlan: false,
    }),
  ).toBe(false);
});

test("shouldClearGhostAcpActiveRun preserves awaiting_plan / pending-plan holds", () => {
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "acp",
      status: "awaiting_plan",
      hasActiveRun: true,
      acpTurnInFlight: false,
      hasPendingPlan: true,
    }),
  ).toBe(false);
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "acp",
      status: "running",
      hasActiveRun: true,
      acpTurnInFlight: false,
      hasPendingPlan: true,
    }),
  ).toBe(false);
  expect(
    shouldClearGhostAcpActiveRun({
      coreKind: "acp",
      status: "running",
      hasActiveRun: true,
      acpTurnInFlight: false,
      hasPendingPlan: false,
      hasPendingPlanBridge: true,
    }),
  ).toBe(false);
});
