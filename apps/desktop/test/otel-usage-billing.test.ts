import { expect, test } from "bun:test";
import type { OtelUsageUpdate } from "@eco/runtime";
import {
  normalizeTelemetryBillingRole,
  resolveOtelUsageBilling,
} from "../src/main/otel-usage-billing";

function otelUsage(input: Partial<OtelUsageUpdate> = {}): OtelUsageUpdate {
  return {
    threadId: "thr_otel",
    role: "coder",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    modelId: "haiku",
    ...input,
  };
}

test("normalizeTelemetryBillingRole maps non-agent telemetry roles to planner", () => {
  expect(normalizeTelemetryBillingRole("system")).toBe("planner");
  expect(normalizeTelemetryBillingRole("thinking")).toBe("planner");
  expect(normalizeTelemetryBillingRole("tool")).toBe("planner");
  expect(normalizeTelemetryBillingRole("unknown")).toBe("planner");
  expect(normalizeTelemetryBillingRole("coder")).toBe("coder");
});

test("resolveOtelUsageBilling builds request keys observations and billing input", () => {
  const resolved = resolveOtelUsageBilling({
    usage: otelUsage({ costUsd: 0.25 }),
    currentRequestSeq: 5,
    runAttemptId: "attempt_1",
    plannerAgentId: "planner_attempt_1",
  });

  expect(resolved.nextRequestSeq).toBe(6);
  expect(resolved.dedupId).toBe("6");
  expect(resolved.billingRole).toBe("coder");
  expect(resolved.hasTokens).toBe(true);
  expect(resolved.requestKey).toBe("otel:coder:100:20:3:4:haiku:6");
  expect(resolved.observation).toMatchObject({
    source: "otel",
    role: "coder",
    requestKey: "otel:coder:100:20:3:4:haiku:6",
    modelId: "haiku",
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    },
  });
  expect(resolved.billingInput).toMatchObject({
    threadId: "thr_otel",
    role: "coder",
    source: "otel",
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    otelCostUsd: 0.25,
    modelId: "haiku",
    runAttemptId: "attempt_1",
    plannerAgentId: "planner_attempt_1",
    requestKey: "otel:coder:100:20:3:4:haiku:6",
    otelDedupId: "6",
    reconciliationOnly: true,
    updateContext: false,
  });
});

test("resolveOtelUsageBilling omits observations for cost-only records", () => {
  const resolved = resolveOtelUsageBilling({
    usage: otelUsage({
      role: "system",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0.01,
    }),
  });

  expect(resolved.billingRole).toBe("planner");
  expect(resolved.hasTokens).toBe(false);
  expect(resolved.observation).toBeUndefined();
  expect(resolved.billingInput).toMatchObject({
    role: "planner",
    otelCostUsd: 0.01,
    reconciliationOnly: true,
    updateContext: false,
  });
});
