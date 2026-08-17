import { expect, test } from "bun:test";
import { resolveAcpThreadRunDecision } from "../src/main/acp-runtime-run";

test("ACP plan mode keeps awaiting_plan when Cursor drops after create_plan", () => {
  expect(
    resolveAcpThreadRunDecision({
      mode: "plan",
      result: { ok: false, reason: "ACP process exited" },
      hasPendingPlan: true,
    }),
  ).toEqual({ kind: "awaiting_plan", message: "" });
});

test("ACP plan mode does not mark completed when a pending plan remains", () => {
  expect(
    resolveAcpThreadRunDecision({
      mode: "plan",
      result: { ok: true },
      hasPendingPlan: true,
    }),
  ).toEqual({ kind: "awaiting_plan", message: "" });
});

test("ACP plan mode without a pending plan stays idle on success", () => {
  expect(
    resolveAcpThreadRunDecision({
      mode: "plan",
      result: { ok: true },
      hasPendingPlan: false,
    }),
  ).toEqual({ kind: "idle", message: "" });
});

test("ACP agent continuation completes when there is no pending plan", () => {
  expect(
    resolveAcpThreadRunDecision({
      mode: "agent",
      result: { ok: true },
      hasPendingPlan: false,
    }),
  ).toEqual({ kind: "completed" });
});
