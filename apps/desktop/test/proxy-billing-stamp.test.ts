import { expect, test } from "bun:test";
import {
  CLAUDE_CODE_ATTRIBUTION_HEADERS,
  ECO_PROXY_BILLING_HEADERS,
  ProxyBillingStampRegistry,
  readClaudeCodeAgentIdFromRequestHeaders,
  readProxyBillingStampFromHeaders,
} from "../src/main/proxy-billing-stamp";
import { resolveProxyUsageBilling } from "../src/main/proxy-usage-billing";
import type { SubagentMetricsPersistenceStore } from "../src/main/subagent-metrics-persistence";
import { SubagentMetricsRegistry } from "../src/main/subagent-metrics-registry";
import {
  finalizeLiveRequest,
  handleBridgeMessagesRequest,
  resolveFrozenLiveRequestAttribution,
} from "../src/main/thread-live-request-coordinator";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";

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

test("readClaudeCodeAgentIdFromRequestHeaders parses Claude instance header", () => {
  expect(
    readClaudeCodeAgentIdFromRequestHeaders(
      new Headers({ [CLAUDE_CODE_ATTRIBUTION_HEADERS.agentId]: "agent_from_claude" }),
    ),
  ).toBe("agent_from_claude");
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

test("logicalRequestId frozen stamp attributes concurrent same-role usage without resolveForRoute", () => {
  const live = new ThreadLiveRequestRegistry();
  const billing = new ProxyBillingStampRegistry();
  const threadId = "thr_logical_stamp";
  billing.register(threadId, { agentId: "agent_coder_a", role: "coder" });
  billing.register(threadId, { agentId: "agent_coder_b", role: "coder" });
  expect(billing.resolveForRoute(threadId, "coder")).toBeUndefined();

  const a = handleBridgeMessagesRequest(live, {
    threadId,
    role: "coder",
    agentId: "agent_coder_a",
    emitTimelineActivity: true,
  });
  const b = handleBridgeMessagesRequest(live, {
    threadId,
    role: "coder",
    agentId: "agent_coder_b",
    emitTimelineActivity: true,
  });

  const metrics = new SubagentMetricsRegistry(metricsStoreStub);
  const frozenA = resolveFrozenLiveRequestAttribution(live, threadId, a.logicalRequestId);
  const frozenB = resolveFrozenLiveRequestAttribution(live, threadId, b.logicalRequestId);
  expect(frozenA?.agentId).toBe("agent_coder_a");
  expect(frozenB?.agentId).toBe("agent_coder_b");

  const resolvedA = resolveProxyUsageBilling({
    info: {
      threadId,
      role: "coder",
      providerId: "provider",
      providerName: "Provider",
      providerBaseUrl: "https://api.example.test",
      modelId: "haiku",
      apiCompat: "anthropic",
      usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    },
    resolver: metrics,
    stampedAgentId: frozenA!.agentId,
  });
  const resolvedB = resolveProxyUsageBilling({
    info: {
      threadId,
      role: "coder",
      providerId: "provider",
      providerName: "Provider",
      providerBaseUrl: "https://api.example.test",
      modelId: "haiku",
      apiCompat: "anthropic",
      usage: { inputTokens: 20, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0 },
    },
    resolver: metrics,
    stampedAgentId: frozenB!.agentId,
  });
  expect(resolvedA.subagentAgentId).toBe("agent_coder_a");
  expect(resolvedB.subagentAgentId).toBe("agent_coder_b");
  expect(resolvedA.attributionPending).toBe(false);
  expect(resolvedB.attributionPending).toBe(false);

  finalizeLiveRequest(live, threadId, a.logicalRequestId);
  expect(resolveFrozenLiveRequestAttribution(live, threadId, a.logicalRequestId)?.agentId).toBe(
    "agent_coder_a",
  );
});

test("same-role concurrent without stamp stays attributionPending", () => {
  const metrics = new SubagentMetricsRegistry(metricsStoreStub);
  metrics.onSubagentStart("thr_pending", { agentId: "agent_a", role: "coder" });
  metrics.onSubagentStart("thr_pending", { agentId: "agent_b", role: "coder" });

  const resolved = resolveProxyUsageBilling({
    info: {
      threadId: "thr_pending",
      role: "coder",
      providerId: "provider",
      providerName: "Provider",
      providerBaseUrl: "https://api.example.test",
      modelId: "haiku",
      apiCompat: "anthropic",
      usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    },
    resolver: metrics,
  });
  expect(resolved.subagentAgentId).toBeUndefined();
  expect(resolved.attributionPending).toBe(true);
});
