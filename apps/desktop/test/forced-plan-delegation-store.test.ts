import { expect, test } from "bun:test";
import {
  ForcedPlanDelegationStore,
  normalizeDelegationAgentKey,
} from "../src/main/forced-plan-delegation-store";

test("normalizeDelegationAgentKey strips the eco_ prefix and lowercases", () => {
  expect(normalizeDelegationAgentKey("eco_Coder")).toBe("coder");
  expect(normalizeDelegationAgentKey("  reviewer ")).toBe("reviewer");
  expect(normalizeDelegationAgentKey(undefined)).toBe("");
});

test("claimSpawn succeeds once for the armed role and claims the tool use id", () => {
  const store = new ForcedPlanDelegationStore();
  store.arm({
    threadId: "t1",
    coreKind: "claude",
    agentKey: "coder",
    canonicalTask: "task",
    runAttemptId: "run1",
    now: "2026-01-01T00:00:00.000Z",
  });

  const claim = store.claimSpawn({ threadId: "t1", agentKey: "eco_coder", toolUseId: "tu1" });
  expect(claim.ok).toBe(true);
  if (claim.ok) {
    expect(claim.attempt.status).toBe("spawned");
    expect(claim.attempt.spawnToolUseId).toBe("tu1");
  }

  const duplicate = store.claimSpawn({ threadId: "t1", agentKey: "coder", toolUseId: "tu2" });
  expect(duplicate.ok).toBe(false);
  expect(store.get("t1")?.status).toBe("violated");
});

test("claimSpawn fails loudly for a wrong role", () => {
  const store = new ForcedPlanDelegationStore();
  store.arm({
    threadId: "t1",
    coreKind: "codex",
    agentKey: "coder",
    canonicalTask: "task",
    runAttemptId: "run1",
  });

  const claim = store.claimSpawn({ threadId: "t1", agentKey: "reviewer" });
  expect(claim.ok).toBe(false);
  if (!claim.ok) {
    expect(claim.reason).toContain("reviewer");
  }
  expect(store.get("t1")?.status).toBe("violated");
});

test("claimSpawn rejects a mismatched run attempt id", () => {
  const store = new ForcedPlanDelegationStore();
  store.arm({
    threadId: "t1",
    coreKind: "pi",
    agentKey: "coder",
    canonicalTask: "task",
    runAttemptId: "run1",
  });
  const claim = store.claimSpawn({ threadId: "t1", agentKey: "coder", runAttemptId: "run2" });
  expect(claim.ok).toBe(false);
});

test("complete refuses an attempt that never spawned", () => {
  const store = new ForcedPlanDelegationStore();
  store.arm({ threadId: "t1", coreKind: "claude", agentKey: "coder", canonicalTask: "x" });
  expect(store.complete("t1")?.status).toBe("armed");
});

test("complete marks a spawned attempt and release clears the record", () => {
  const store = new ForcedPlanDelegationStore();
  store.arm({ threadId: "t1", coreKind: "claude", agentKey: "coder", canonicalTask: "x" });
  store.claimSpawn({ threadId: "t1", agentKey: "coder" });
  expect(store.complete("t1")?.status).toBe("completed");
  store.release("t1");
  expect(store.get("t1")).toBeUndefined();
});

test("fail records the reason and a violated attempt is preserved", () => {
  const store = new ForcedPlanDelegationStore();
  store.arm({ threadId: "t1", coreKind: "claude", agentKey: "coder", canonicalTask: "x" });
  store.claimSpawn({ threadId: "t1", agentKey: "coder" });
  const failed = store.fail("t1", "boom");
  expect(failed?.status).toBe("failed");
  expect(failed?.failureReason).toBe("boom");
  store.release("t1");
  expect(store.get("t1")).toBeUndefined();
});
