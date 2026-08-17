import { expect, test } from "bun:test";
import { resolveThreadApprovePlanRoute } from "../src/main/thread-approve-plan-route";

test("acp with pending bridge routes to bridge (not Claude execution)", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "acp",
      hasPendingBridge: true,
    }),
  ).toEqual({ kind: "bridge" });
});

test("cursor with pending bridge routes to bridge", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "cursor",
      hasPendingBridge: true,
    }),
  ).toEqual({ kind: "bridge" });
});

test("claude with pending bridge routes to bridge", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "claude",
      hasPendingBridge: true,
    }),
  ).toEqual({ kind: "bridge" });
});

test("claude without bridge falls through to Claude execution", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "claude",
      hasPendingBridge: false,
    }),
  ).toEqual({ kind: "claude_execution" });
});

test("acp without bridge uses continuation (reload/recovery), not silent Claude fallback", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "acp",
      hasPendingBridge: false,
    }),
  ).toEqual({ kind: "acp_continuation" });
});

test("cursor without bridge uses continuation", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "cursor",
      hasPendingBridge: false,
    }),
  ).toEqual({ kind: "acp_continuation" });
});

test("codex and pi keep their dedicated routes even with a bridge flag", () => {
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "codex",
      hasPendingBridge: true,
    }),
  ).toEqual({ kind: "codex" });
  expect(
    resolveThreadApprovePlanRoute({
      coreKind: "pi",
      hasPendingBridge: false,
    }),
  ).toEqual({ kind: "pi" });
});
