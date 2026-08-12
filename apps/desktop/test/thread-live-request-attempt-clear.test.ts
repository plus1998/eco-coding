import { expect, test } from "bun:test";
import type { StartedAnthropicProxy } from "../src/main/anthropic-proxy";
import type { RuntimeRoute } from "../src/main/billing-resolver";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import {
  applyLogicalRequestTerminal,
  clearFinalizedLiveRequestsForAttempt,
  handleBridgeMessagesRequest,
} from "../src/main/thread-live-request-coordinator";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";
import { runThreadRequestWithRuntimeProxy } from "../src/main/thread-runtime-proxy-attempt";
import type { AgentRole } from "../src/shared/ipc";

function provider(id: string): ProviderConfigSecret {
  return {
    id,
    name: `Provider ${id}`,
    baseUrl: `https://${id}.example.test`,
    requestPath: "/v1/messages",
    version: "v1",
    apiCompat: "anthropic",
    defaultModel: "claude-test",
    enabled: true,
    hasApiKey: true,
    apiKeyPreview: "sk-...",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    apiKey: "secret",
  };
}

function runtimeRoute(role: AgentRole): RuntimeRoute {
  return {
    role,
    provider: provider("p1"),
    modelId: `${role}-model`,
    apiCompat: "anthropic",
  };
}

function startedProxy(closeEvents: string[]): StartedAnthropicProxy {
  return {
    apiKey: "local-key",
    baseUrl: "http://127.0.0.1:41234",
    bindingId: "cbb_test",
    routes: [{ ...runtimeRoute("coder"), aliasModelId: "eco-coder" }],
    async close() {
      closeEvents.push("closed");
    },
  };
}

test("runThreadRequestWithRuntimeProxy onAttemptSettled clears finalized tombstones after proxy close", async () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_attempt_clear";
  const runAttemptId = "attempt_clear_1";
  const closeEvents: string[] = [];
  const settleOrder: string[] = [];

  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: true,
  });
  applyLogicalRequestTerminal(registry, {
    threadId,
    logicalRequestId: snapshot.logicalRequestId,
    stage: "completed",
    eventRole: "coder",
    runAttemptId,
  });
  expect(registry.listFinalized(threadId)).toHaveLength(1);
  expect(registry.listFinalized(threadId)[0]?.runAttemptId).toBe(runAttemptId);

  await runThreadRequestWithRuntimeProxy({
    context: { threadId, runAttemptId, phase: "execution" },
    resolveRuntimeConfig: () => ({
      ok: true,
      routes: [runtimeRoute("coder")],
    }),
    recordRouteFingerprint: () => {},
    startRuntimeProxy: async () => startedProxy(closeEvents),
    onAttemptSettled: (context) => {
      settleOrder.push("settled");
      clearFinalizedLiveRequestsForAttempt(registry, context.threadId, context.runAttemptId);
    },
    run: async () => {
      settleOrder.push("run");
      return { ok: true };
    },
  });

  expect(closeEvents).toEqual(["closed"]);
  expect(settleOrder).toEqual(["run", "settled"]);
  expect(registry.listFinalized(threadId)).toHaveLength(0);
});
