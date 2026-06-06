import { expect, test } from "bun:test";
import { computeRequestBilling } from "@eco/runtime";
import { readUsageLedgerComputedBilling } from "../src/main/usage-ledger-cost-metadata";
import { buildInterruptedStreamPartialSettlementEvents } from "../src/main/usage-ledger-settlement";
import { buildSingleUsageLedgerEvent } from "../src/main/usage-ledger-adapters";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

test("buildInterruptedStreamPartialSettlementEvents converts interrupted partial usage to final", () => {
  const usage = { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
  const partial = buildSingleUsageLedgerEvent({
    threadId: "thr_settlement",
    role: "coder",
    source: "sdk",
    sourceEventId: "sdk-stream:event_1",
    usageKind: "request_partial",
    usage,
    computedBilling: computeRequestBilling(usage, haikuRates, sonnetRates),
    runAttemptId: "attempt_1",
    agentId: "agent_coder",
    parentToolUseId: "toolu_parent",
    requestKey: "sdk-stream:event_1",
    modelId: "haiku",
    observedAt: "2026-01-01T00:00:00.000Z",
  });

  const [settlement] = buildInterruptedStreamPartialSettlementEvents({
    events: [partial],
    runAttemptId: "attempt_1",
    runStatus: "cancelled",
    observedAt: "2026-01-01T00:00:05.000Z",
  });

  expect(settlement?.usageKind).toBe("request_final");
  expect(settlement?.sourceEventId).toBe("sdk-stream:event_1:settled:cancelled");
  expect(settlement?.agentId).toBe("agent_coder");
  expect(settlement?.parentToolUseId).toBe("toolu_parent");
  expect(settlement?.inputTokens).toBe(10_000);
  expect(settlement?.metadata).toMatchObject({
    path: "settleInterruptedStreamPartialUsage",
    settlement: "interrupted_stream_partial",
    runStatus: "cancelled",
    settledFromEventId: partial.id,
  });
  expect(readUsageLedgerComputedBilling(settlement?.metadata)?.ecoCostUsd).toBeCloseTo(0.012, 4);
});

test("buildInterruptedStreamPartialSettlementEvents is idempotent and scoped to run attempt", () => {
  const partial = buildSingleUsageLedgerEvent({
    threadId: "thr_settlement",
    role: "coder",
    source: "sdk",
    sourceEventId: "sdk-stream:event_1",
    usageKind: "request_partial",
    usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    runAttemptId: "attempt_1",
    agentId: "agent_coder",
  });
  const otherAttempt = buildSingleUsageLedgerEvent({
    threadId: "thr_settlement",
    role: "coder",
    source: "sdk",
    sourceEventId: "sdk-stream:event_2",
    usageKind: "request_partial",
    usage: { inputTokens: 20, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
    runAttemptId: "attempt_2",
    agentId: "agent_coder",
  });
  const [settlement] = buildInterruptedStreamPartialSettlementEvents({
    events: [partial, otherAttempt],
    runAttemptId: "attempt_1",
    runStatus: "failed",
  });

  expect(settlement).toBeDefined();
  expect(
    buildInterruptedStreamPartialSettlementEvents({
      events: [partial, otherAttempt, settlement!],
      runAttemptId: "attempt_1",
      runStatus: "failed",
    }),
  ).toEqual([]);
});
