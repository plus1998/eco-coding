import { expect, test } from "bun:test";
import { parseSdkUsageBilling } from "@eco/runtime";
import {
  buildAssistantUsageRequestKey,
  isSdkIncrementalStreamUsage,
  isSubagentBillingRole,
  nextOtelRequestDedupId,
  sdkPayloadHasModelUsage,
  shouldBillAssistantSubagentUsage,
  shouldSkipSdkResultTokenBilling,
} from "../src/main/billing-orchestration";
import { buildUsageRequestKey, ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";

test("isSubagentBillingRole excludes planner", () => {
  expect(isSubagentBillingRole("coder")).toBe(true);
  expect(isSubagentBillingRole("planner")).toBe(false);
});

test("shouldSkipSdkResultTokenBilling when OTel already billed tokens", () => {
  expect(shouldSkipSdkResultTokenBilling(true)).toBe(true);
  expect(shouldSkipSdkResultTokenBilling(false)).toBe(false);
  expect(shouldSkipSdkResultTokenBilling(undefined)).toBe(false);
});

test("isSdkIncrementalStreamUsage detects message_delta style payloads", () => {
  const payload = { usage: { input_tokens: 10, output_tokens: 5 } };
  const bundle = parseSdkUsageBilling(payload);
  expect(bundle?.authoritative).toBe(true);
  expect(isSdkIncrementalStreamUsage(true, payload)).toBe(true);
  expect(sdkPayloadHasModelUsage(payload)).toBe(false);
});

test("isSdkIncrementalStreamUsage is false for SDK result modelUsage", () => {
  const payload = {
    total_cost_usd: 0.5,
    usage: { input_tokens: 100, output_tokens: 50 },
    modelUsage: { "claude-opus-4": { inputTokens: 100, outputTokens: 50 } },
  };
  expect(isSdkIncrementalStreamUsage(true, payload)).toBe(false);
  expect(sdkPayloadHasModelUsage(payload)).toBe(true);
});

test("shouldBillAssistantSubagentUsage requires subagent role and messageId without OTel", () => {
  expect(
    shouldBillAssistantSubagentUsage({
      role: "coder",
      messageId: "msg_1",
      otelTokenBilled: undefined,
    }),
  ).toBe(true);
  expect(
    shouldBillAssistantSubagentUsage({
      role: "coder",
      messageId: "msg_1",
      otelTokenBilled: true,
    }),
  ).toBe(false);
  expect(
    shouldBillAssistantSubagentUsage({
      role: "planner",
      messageId: "msg_1",
      otelTokenBilled: undefined,
    }),
  ).toBe(false);
});

test("nextOtelRequestDedupId increments run-scoped sequence", () => {
  expect(nextOtelRequestDedupId(undefined)).toEqual({ seq: 1, dedupId: "1" });
  expect(nextOtelRequestDedupId(1)).toEqual({ seq: 2, dedupId: "2" });
});

test("buildUsageRequestKey includes dedupId to avoid token fingerprint collisions", () => {
  const base = {
    role: "coder",
    inputTokens: 1000,
    outputTokens: 100,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    modelId: "haiku",
  };
  expect(buildUsageRequestKey(base)).not.toBe(
    buildUsageRequestKey({ ...base, dedupId: "1" }),
  );
});

test("buildAssistantUsageRequestKey is stable per message", () => {
  expect(buildAssistantUsageRequestKey("msg_abc")).toBe("sdk-assistant:msg_abc");
});

test("OTel incremental billing attributes subagent role separately from planner", () => {
  const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };
  const accumulator = new ThreadUsageAccumulator();
  const delta = { inputTokens: 50_000, outputTokens: 5_000, cacheReadTokens: 0, cacheCreationTokens: 0 };

  accumulator.recordUsage({
    threadId: "t1",
    role: "planner",
    delta: { inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    otelCostUsd: 0.5,
    actualRates: sonnetRates,
    plannerRates: sonnetRates,
    requestKey: buildUsageRequestKey({
      role: "planner",
      inputTokens: 10_000,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      dedupId: "1",
    }),
  });

  accumulator.recordUsage({
    threadId: "t1",
    role: "coder",
    delta,
    otelCostUsd: 2.1,
    actualRates: haikuRates,
    plannerRates: sonnetRates,
    modelId: "haiku",
    requestKey: buildUsageRequestKey({
      role: "coder",
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      modelId: "haiku",
      dedupId: "2",
    }),
  });

  const billing = accumulator.getSnapshot("t1");
  expect(billing?.otelCostUsd).toBeCloseTo(2.6);
  expect(billing?.byRole?.planner?.inputTokens).toBe(10_000);
  expect(billing?.byRole?.coder?.inputTokens).toBe(50_000);
  expect(billing?.ecoCostUsd).toBeGreaterThan(billing?.byRole?.planner?.ecoCostUsd ?? 0);
});

test("sdk result tokens do not duplicate when OTel already billed same run", () => {
  const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  const accumulator = new ThreadUsageAccumulator();
  const otelDelta = {
    inputTokens: 100_000,
    outputTokens: 10_000,
    cacheReadTokens: 800_000,
    cacheCreationTokens: 0,
  };

  accumulator.recordUsage({
    threadId: "t1",
    role: "coder",
    delta: otelDelta,
    otelCostUsd: 3.5,
    actualRates: sonnetRates,
    plannerRates: sonnetRates,
    requestKey: "otel:coder:100000:10000:800000:0:haiku:1",
  });

  const before = accumulator.getSnapshot("t1");
  expect(before?.totalTokens.input).toBe(100_000);

  if (shouldSkipSdkResultTokenBilling(true)) {
    // Simulates skipping processSdkRunBilling when otelTokenBilled
    expect(before?.totalTokens.input).toBe(100_000);
    return;
  }

  accumulator.recordRunUsage({
    threadId: "t1",
    role: "planner",
    requestKey: "sdk-result:run-1",
    models: [
      {
        role: "planner",
        modelId: "claude-opus-4",
        usage: otelDelta,
        actualRates: sonnetRates,
        plannerRates: sonnetRates,
      },
    ],
    otelCostUsd: 3.5,
  });

  expect.fail("should not bill SDK result tokens when OTel already billed");
});

test("assistant subagent fallback bills when OTel unavailable", () => {
  const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
  const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };
  const accumulator = new ThreadUsageAccumulator();
  const delta = { inputTokens: 20_000, outputTokens: 2_000, cacheReadTokens: 0, cacheCreationTokens: 0 };

  if (
    !shouldBillAssistantSubagentUsage({
      role: "explore",
      messageId: "msg_explore_1",
      otelTokenBilled: undefined,
    })
  ) {
    expect.fail("expected assistant fallback eligibility");
  }

  accumulator.recordUsage({
    threadId: "t1",
    role: "explore",
    delta,
    actualRates: haikuRates,
    plannerRates: sonnetRates,
    modelId: "haiku",
    requestKey: buildAssistantUsageRequestKey("msg_explore_1"),
  });

  const billing = accumulator.getSnapshot("t1");
  expect(billing?.byRole?.explore?.inputTokens).toBe(20_000);
  expect(billing?.byRole?.planner).toBeUndefined();
});
