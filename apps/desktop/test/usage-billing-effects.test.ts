import { expect, test } from "bun:test";
import type { ModelPricingLookup, ParsedUsage } from "@eco/runtime";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import type { RuntimeRoute } from "../src/main/billing-resolver";
import { ThreadUsageAccumulator } from "../src/main/thread-usage-accumulator";
import { InMemoryUsageLedger, type AgentInstanceRecord, type UsageLedgerEvent } from "../src/main/usage-ledger";
import { UsageLedgerCoordinator, type UsageLedgerCoordinatorStore } from "../src/main/usage-ledger-coordinator";
import {
  resolveSingleUsageBillingArtifacts,
  type UsageBillingPricingRoute,
} from "../src/main/usage-billing-artifacts";
import {
  applySingleUsageBillingEffects,
  type UsageBillingEffectsServices,
  type UsageBillingUpdatedEvent,
} from "../src/main/usage-billing-effects";

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
  { role: "planner", provider, modelId: "sonnet", apiCompat: "anthropic" },
  { role: "coder", provider, modelId: "haiku", apiCompat: "anthropic" },
];

async function lookupPricing(route: UsageBillingPricingRoute): Promise<ModelPricingLookup> {
  return {
    providerKey: "test",
    modelId: route.modelId,
    rates: route.modelId === "haiku" ? haikuRates : sonnetRates,
    displayName: route.modelId === "haiku" ? "Claude Haiku" : "Claude Sonnet",
  };
}

function createLedgerCoordinator() {
  const ledger = new InMemoryUsageLedger();
  const store: UsageLedgerCoordinatorStore = {
    appendUsageLedgerEvent(event: UsageLedgerEvent) {
      return ledger.appendUsageEvent(event).inserted;
    },
    listUsageLedgerEvents(threadId: string) {
      return ledger.listUsageEvents(threadId);
    },
    listAgentInstances(threadId: string): AgentInstanceRecord[] {
      return ledger.listAgentInstances(threadId);
    },
  };
  const coordinator = new UsageLedgerCoordinator({
    store,
    metrics: {
      listEntries: () => [],
    },
    writeError: (message) => {
      throw new Error(message);
    },
  });
  return { ledger, coordinator };
}

test("applySingleUsageBillingEffects applies ledger context accumulator metrics and event side effects", async () => {
  const subagentMetricCalls: Array<Parameters<UsageBillingEffectsServices["subagentMetrics"]["recordSdkUsage"]>[1]> = [];
  const subagentMetrics: UsageBillingEffectsServices["subagentMetrics"] = {
    recordSdkUsage: (_threadId, input) => {
      subagentMetricCalls.push(input);
      return undefined;
    },
  };
  const { ledger, coordinator } = createLedgerCoordinator();
  const contextUpdates: Array<{ threadId: string; usage: ParsedUsage; options: unknown }> = [];
  const emitted: UsageBillingUpdatedEvent[] = [];
  const persisted: string[] = [];
  const liveContext: string[] = [];
  const services: UsageBillingEffectsServices = {
    contextMonitor: {
      async updateFromUsage(threadId, usage, options) {
        contextUpdates.push({ threadId, usage, options });
      },
      getSnapshot: () => undefined,
    },
    usageLedger: coordinator,
    accumulator: new ThreadUsageAccumulator(),
    subagentMetrics,
    emitUsageUpdated: (event) => emitted.push(event),
    schedulePersistThreadMetrics: (threadId) => persisted.push(threadId),
    emitLiveContext: (threadId) => liveContext.push(threadId),
  };
  const artifacts = await resolveSingleUsageBillingArtifacts({
    threadId: "thr_effects",
    role: "coder",
    source: "proxy",
    usage: usage(),
    runtimeRoutes: routes,
    lookupPricing,
    agentId: "agent_coder",
    requestKey: "proxy:coder:req_1",
  });

  const billing = await applySingleUsageBillingEffects(services, {
    threadId: "thr_effects",
    artifacts,
    updateContext: true,
    agentId: "agent_coder",
    reconciliationOnly: true,
    fillSdkPrimaryForSubagent: true,
  });

  expect(ledger.listUsageEvents("thr_effects")).toHaveLength(1);
  expect(contextUpdates).toHaveLength(1);
  expect(subagentMetricCalls).toHaveLength(1);
  expect(subagentMetricCalls[0]).toMatchObject({
    role: "coder",
    agentId: "agent_coder",
    requestKey: "proxy:coder:req_1",
    modelId: "haiku",
  });
  expect(billing.primarySource).toBe("sdk");
  expect(billing.sourceBreakdown?.proxy).toBeDefined();
  expect(billing.sourceBreakdown?.sdk).toBeDefined();
  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.payload.billing.primarySource).toBe("sdk");
  expect(persisted).toEqual(["thr_effects"]);
  expect(liveContext).toEqual(["thr_effects"]);
});
