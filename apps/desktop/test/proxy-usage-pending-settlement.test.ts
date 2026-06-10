import { expect, test } from "bun:test";
import { computeRequestBilling, type ParsedUsage } from "@eco/runtime";
import { SubagentMetricsRegistry } from "../src/main/subagent-metrics-registry";
import type { SubagentMetricsPersistenceStore } from "../src/main/subagent-metrics-persistence";
import { resolveProxyUsageBilling } from "../src/main/proxy-usage-billing";
import { resolveSingleUsageBillingArtifacts } from "../src/main/usage-billing-artifacts";
import {
  ProxyUsagePendingRegistry,
  PROXY_PENDING_ATTRIBUTION_REASON,
} from "../src/main/proxy-usage-pending-settlement";
import {
  UsageLedgerCoordinator,
  type UsageLedgerCoordinatorStore,
} from "../src/main/usage-ledger-coordinator";
import {
  InMemoryUsageLedger,
  type AgentInstanceRecord,
  type UsageLedgerEvent,
} from "../src/main/usage-ledger";
import { projectBillingFromUsageLedger } from "../src/main/billing-projector";

const sonnetRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const haikuRates = { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 };

const provider = {
  id: "provider_test",
  name: "Test Provider",
  baseUrl: "https://api.example.test",
  apiKey: "test-key",
};

const routes = [
  { role: "planner" as const, provider, modelId: "sonnet", apiCompat: "anthropic" as const },
  { role: "coder" as const, provider, modelId: "haiku", apiCompat: "anthropic" as const },
];

function usage(inputTokens = 10_000): ParsedUsage {
  return { inputTokens, outputTokens: 1_000, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

const metricsStoreStub: SubagentMetricsPersistenceStore = {
  listSubagentMetrics: () => [],
  upsertSubagentMetrics: () => {},
  clearSubagentMetrics: () => {},
};

function lookupPricing() {
  return Promise.resolve({
    displayName: "Haiku",
    rates: haikuRates,
  });
}

function createCoordinatorStore(ledger: InMemoryUsageLedger): UsageLedgerCoordinatorStore {
  return {
    appendUsageLedgerEvent(event: UsageLedgerEvent) {
      return ledger.appendUsageEvent(event).inserted;
    },
    listUsageLedgerEvents(threadId: string) {
      return ledger.listUsageEvents(threadId);
    },
    listAgentInstances(_threadId: string): AgentInstanceRecord[] {
      return [];
    },
    updateUsageLedgerEventAttribution(eventId, update) {
      return Boolean(ledger.updateUsageEventAttribution(eventId, update));
    },
  };
}

test("resolveProxyUsageBilling marks subagent usage pending before onSubagentStart", () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  const resolved = resolveProxyUsageBilling({
    info: {
      threadId: "thr_pending",
      role: "coder",
      modelId: "haiku",
      requestId: "req_pending_1",
      usage: usage(),
    },
    resolver: registry,
  });

  expect(resolved.attributionPending).toBe(true);
  expect(resolved.attributionAttempted).toBe(true);
  expect(resolved.subagentAgentId).toBeUndefined();
  expect(resolved.billingInput.attributionPending).toBe(true);
});

test("pending proxy ledger event settles on onSubagentStart", async () => {
  const registry = new SubagentMetricsRegistry(metricsStoreStub);
  const ledger = new InMemoryUsageLedger();
  const settledThreads: string[] = [];
  const coordinator = new UsageLedgerCoordinator({
    store: createCoordinatorStore(ledger),
    metrics: registry,
    onProxyAttributionSettled: (threadId) => settledThreads.push(threadId),
  });

  const resolved = resolveProxyUsageBilling({
    info: {
      threadId: "thr_pending_settle",
      role: "coder",
      modelId: "haiku",
      requestId: "req_pending_settle",
      usage: usage(),
    },
    resolver: registry,
  });
  const artifacts = await resolveSingleUsageBillingArtifacts({
    threadId: "thr_pending_settle",
    role: resolved.billingRole,
    source: "proxy",
    usage: usage(),
    runtimeRoutes: routes,
    lookupPricing,
    requestKey: resolved.requestKey,
    sourceEventId: resolved.requestKey,
    modelId: "haiku",
    routeRole: resolved.billingInput.routeRole,
    attributionPending: true,
  });

  expect(artifacts.ledgerEvent.attribution).toEqual({
    status: "pending",
    reason: PROXY_PENDING_ATTRIBUTION_REASON,
  });
  coordinator.appendEvents([artifacts.ledgerEvent]);
  coordinator.registerProxyPendingAttribution("thr_pending_settle", {
    eventId: artifacts.ledgerEvent.id,
    requestKey: artifacts.requestKey,
    routeRole: "coder",
    billingRole: "coder",
    observedAt: artifacts.ledgerEvent.observedAt,
  });

  registry.onSubagentStart("thr_pending_settle", { agentId: "agent_coder_a", role: "coder" });
  const settled = coordinator.settleProxyPendingForSubagentStart("thr_pending_settle", {
    agentId: "agent_coder_a",
    role: "coder",
  });

  expect(settled).toBe(1);
  expect(settledThreads).toEqual(["thr_pending_settle"]);
  const events = ledger.listUsageEvents("thr_pending_settle");
  expect(events[0]?.attribution).toEqual({ status: "attributed", agentId: "agent_coder_a" });
  expect(events[0]?.agentId).toBe("agent_coder_a");

  const projection = projectBillingFromUsageLedger({ events });
  expect(projection.pendingEvents).toHaveLength(0);
  expect(projection.byAgent.agent_coder_a?.inputTokens).toBe(10_000);
});

test("ProxyUsagePendingRegistry consumes earliest pending per role for concurrent coders", () => {
  const registry = new ProxyUsagePendingRegistry();
  registry.register("thr_dual", {
    eventId: "evt_a",
    requestKey: "proxy:coder:a",
    routeRole: "coder",
    billingRole: "coder",
    observedAt: "2026-01-01T00:00:01.000Z",
  });
  registry.register("thr_dual", {
    eventId: "evt_b",
    requestKey: "proxy:coder:b",
    routeRole: "coder",
    billingRole: "coder",
    observedAt: "2026-01-01T00:00:02.000Z",
  });

  const first = registry.consumeNextForRole("thr_dual", "coder", "agent_coder_a");
  const second = registry.consumeNextForRole("thr_dual", "coder", "agent_coder_b");

  expect(first?.eventId).toBe("evt_a");
  expect(second?.eventId).toBe("evt_b");
  expect(registry.listPending("thr_dual")).toHaveLength(0);
});

test("settleProxyPendingTimeouts marks remaining pending as unattributed", async () => {
  const ledger = new InMemoryUsageLedger();
  const coordinator = new UsageLedgerCoordinator({
    store: createCoordinatorStore(ledger),
    metrics: { listEntries: () => [] },
  });
  const artifacts = await resolveSingleUsageBillingArtifacts({
    threadId: "thr_timeout",
    role: "coder",
    source: "proxy",
    usage: usage(),
    runtimeRoutes: routes,
    lookupPricing,
    requestKey: "proxy:coder:timeout",
    sourceEventId: "proxy:coder:timeout",
    modelId: "haiku",
    routeRole: "coder",
    attributionPending: true,
  });

  coordinator.appendEvents([artifacts.ledgerEvent]);
  coordinator.registerProxyPendingAttribution("thr_timeout", {
    eventId: artifacts.ledgerEvent.id,
    requestKey: artifacts.requestKey,
    routeRole: "coder",
    billingRole: "coder",
    observedAt: artifacts.ledgerEvent.observedAt,
  });

  expect(coordinator.settleProxyPendingTimeouts("thr_timeout")).toBe(1);
  const events = ledger.listUsageEvents("thr_timeout");
  expect(events[0]?.attribution.status).toBe("unattributed");
  expect(events[0]?.attribution.reason).toBe("pending_agent_settlement_timeout");
});

test("settleProxyPendingTimeouts attributes pending when active agent exists for role", async () => {
  const ledger = new InMemoryUsageLedger();
  const coordinator = new UsageLedgerCoordinator({
    store: createCoordinatorStore(ledger),
    metrics: {
      listEntries: () => [],
      resolveAgentId: () => "agent_researcher_a",
    },
  });
  const artifacts = await resolveSingleUsageBillingArtifacts({
    threadId: "thr_timeout_resolve",
    role: "researcher",
    source: "proxy",
    usage: usage(),
    runtimeRoutes: routes,
    lookupPricing,
    requestKey: "proxy:researcher:timeout",
    sourceEventId: "proxy:researcher:timeout",
    modelId: "haiku",
    routeRole: "researcher",
    attributionPending: true,
  });

  coordinator.appendEvents([artifacts.ledgerEvent]);
  coordinator.registerProxyPendingAttribution("thr_timeout_resolve", {
    eventId: artifacts.ledgerEvent.id,
    requestKey: artifacts.requestKey,
    routeRole: "researcher",
    billingRole: "researcher",
    observedAt: artifacts.ledgerEvent.observedAt,
  });

  expect(coordinator.settleProxyPendingTimeouts("thr_timeout_resolve")).toBe(1);
  const events = ledger.listUsageEvents("thr_timeout_resolve");
  expect(events[0]?.attribution).toEqual({ status: "attributed", agentId: "agent_researcher_a" });
  expect(events[0]?.agentId).toBe("agent_researcher_a");
});
