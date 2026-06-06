import { expect, test } from "bun:test";
import type { ModelPricingLookup, ParsedUsage } from "@eco/runtime";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import type { RuntimeRoute } from "../src/main/billing-resolver";
import {
  resolveSdkRunBillingModels,
  resolveSdkStreamPartialBillingArtifacts,
  resolveSingleUsageBillingArtifacts,
  type UsageBillingPricingRoute,
} from "../src/main/usage-billing-artifacts";
import { readUsageLedgerComputedBilling } from "../src/main/usage-ledger-cost-metadata";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

function usage(inputTokens = 10_000): ParsedUsage {
  return { inputTokens, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

const provider: ProviderConfigSecret = {
  id: "provider_test",
  name: "Test Provider",
  baseUrl: "https://api.example.test",
  requestPath: "/v1/messages",
  apiCompat: "anthropic",
  defaultModel: "sonnet",
  enabled: true,
  hasApiKey: true,
  apiKeyPreview: "sk-...",
  apiKey: "sk-test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const routes: RuntimeRoute[] = [
  {
    role: "planner",
    provider,
    modelId: "sonnet",
    apiCompat: "anthropic",
  },
  {
    role: "coder",
    provider,
    modelId: "haiku",
    apiCompat: "anthropic",
  },
];

async function lookupPricing(route: UsageBillingPricingRoute): Promise<ModelPricingLookup> {
  return {
    providerKey: "test",
    modelId: route.modelId,
    rates: route.modelId === "haiku" ? haikuRates : sonnetRates,
    displayName: route.modelId === "haiku" ? "Claude Haiku" : "Claude Sonnet",
  };
}

test("resolveSingleUsageBillingArtifacts builds assistant fallback ledger and billing fields", async () => {
  const artifacts = await resolveSingleUsageBillingArtifacts({
    threadId: "thr_artifacts",
    role: "coder",
    source: "sdk",
    usage: usage(),
    runtimeRoutes: routes,
    lookupPricing,
    messageId: "msg_1",
    agentId: "agent_coder",
    plannerAgentId: "planner_attempt_1",
    requestKey: "assistant:msg_1",
  });

  expect(artifacts.billingRole).toBe("coder");
  expect(artifacts.resolvedModelId).toBe("haiku");
  expect(artifacts.plannerModelLabel).toBe("Claude Sonnet · Test Provider");
  expect(artifacts.requestBilling.ecoCostUsd).toBeCloseTo(0.012, 6);
  expect(artifacts.ledgerEvent).toMatchObject({
    usageKind: "assistant_fallback",
    source: "sdk",
    sdkMessageId: "msg_1",
    agentId: "agent_coder",
    modelId: "haiku",
  });
  expect(readUsageLedgerComputedBilling(artifacts.ledgerEvent.metadata)?.ecoCostUsd).toBeCloseTo(0.012, 6);
  expect(artifacts.contextUpdate).toMatchObject({
    role: "coder",
    modelId: "haiku",
    providerBaseUrl: "https://api.example.test",
  });
});

test("resolveSdkStreamPartialBillingArtifacts builds partial ledger and context update", async () => {
  const artifacts = await resolveSdkStreamPartialBillingArtifacts({
    threadId: "thr_artifacts",
    eventId: "evt_stream",
    role: "coder",
    usage: usage(1_000),
    modelId: "haiku",
    runtimeRoutes: routes,
    lookupPricing,
    runAttemptId: "attempt_1",
    subagentAgentId: "agent_coder",
  });

  expect(artifacts.resolvedModelId).toBe("haiku");
  expect(artifacts.ledgerEvent).toMatchObject({
    usageKind: "request_partial",
    sourceEventId: "sdk-stream:evt_stream",
    runAttemptId: "attempt_1",
    agentId: "agent_coder",
    modelId: "haiku",
    metadata: expect.objectContaining({ settlement: "partial" }),
  });
  expect(artifacts.contextUpdate).toMatchObject({
    role: "coder",
    modelId: "haiku",
  });
});

test("resolveSdkRunBillingModels resolves model rates and computed billing", async () => {
  const result = await resolveSdkRunBillingModels({
    role: "coder",
    models: [
      {
        modelId: "haiku",
        usage: usage(2_000),
        sdkCostUsd: 0.01,
      },
    ],
    runtimeRoutes: routes,
    lookupPricing,
  });

  expect(result.plannerModelLabel).toBe("Claude Sonnet · Test Provider");
  expect(result.models).toHaveLength(1);
  expect(result.models[0]).toMatchObject({
    role: "coder",
    modelId: "haiku",
    sdkCostUsd: 0.01,
  });
  expect(result.models[0]?.actualRates).toEqual(haikuRates);
  expect(result.models[0]?.plannerRates).toEqual(sonnetRates);
  expect(result.models[0]?.computedBilling.ecoCostUsd).toBeCloseTo(0.0056, 6);
});
