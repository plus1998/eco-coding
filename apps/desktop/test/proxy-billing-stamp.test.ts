import { expect, test } from "bun:test";
import {
  ProxyBillingStampRegistry,
  readProxyBillingStampFromHeaders,
  ECO_PROXY_BILLING_HEADERS,
} from "../src/main/proxy-billing-stamp";
import { resolveProxyUsageBilling } from "../src/main/proxy-usage-billing";
import { SubagentMetricsRegistry } from "../src/main/subagent-metrics-registry";
import type { SubagentMetricsPersistenceStore } from "../src/main/subagent-metrics-persistence";

const metricsStoreStub: SubagentMetricsPersistenceStore = {
  listSubagentMetrics: () => [],
  upsertSubagentMetrics: () => {},
  clearSubagentMetrics: () => {},
};

test("ProxyBillingStampRegistry resolves stamp when one active agent matches route role", () => {
  const registry = new ProxyBillingStampRegistry();
  registry.register("thr_stamp", {
    agentId: "agent_coder_a",
    role: "coder",
    runAttemptId: "attempt_1",
  });

  expect(registry.resolveForRoute("thr_stamp", "coder")).toEqual({
    agentId: "agent_coder_a",
    routeRole: "coder",
    billingRole: "coder",
    runAttemptId: "attempt_1",
  });
});

test("ProxyBillingStampRegistry returns undefined when multiple agents share route role", () => {
  const registry = new ProxyBillingStampRegistry();
  registry.register("thr_stamp", { agentId: "agent_coder_a", role: "coder" });
  registry.register("thr_stamp", { agentId: "agent_coder_b", role: "coder" });

  expect(registry.resolveForRoute("thr_stamp", "coder")).toBeUndefined();
});

test("readProxyBillingStampFromHeaders parses eco billing headers", () => {
  expect(
    readProxyBillingStampFromHeaders({
      [ECO_PROXY_BILLING_HEADERS.agentId]: "agent_explore_1",
      [ECO_PROXY_BILLING_HEADERS.billingRole]: "explore",
      [ECO_PROXY_BILLING_HEADERS.parentToolUseId]: "toolu_1",
    }),
  ).toEqual({
    agentId: "agent_explore_1",
    billingRole: "explore",
    parentToolUseId: "toolu_1",
  });
});

test("resolveProxyUsageBilling uses stamped agentId before pending attribution", () => {
  const metrics = new SubagentMetricsRegistry(metricsStoreStub);

  const resolved = resolveProxyUsageBilling({
    info: {
      threadId: "thr_stamp_billing",
      role: "coder",
      providerId: "provider",
      providerName: "Provider",
      providerBaseUrl: "https://api.example.test",
      modelId: "haiku",
      apiCompat: "anthropic",
      usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0 },
    },
    resolver: metrics,
    stampedAgentId: "agent_stamped",
  });

  expect(resolved.subagentAgentId).toBe("agent_stamped");
  expect(resolved.attributionPending).toBe(false);
});
