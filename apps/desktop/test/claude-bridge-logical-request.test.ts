/**
 * Integration tests for Bridge → Gateway logical request identity and registry wiring.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  type AnthropicProxyUsageInfo,
  emitClaudeGatewayUsageIfSession,
  startAnthropicModelProxy,
} from "../src/main/anthropic-proxy";
import { globalClaudeBridgeBindingRegistry } from "../src/main/claude-bridge-binding";
import { configureEcoGatewayLifecycle, stopGlobalEcoGateway } from "../src/main/eco-gateway-lifecycle";
import { handleGatewayRequestLifecycleEvent } from "../src/main/gateway-request-lifecycle";
import type { ProviderConfigSecret } from "../src/main/provider-store";
import {
  applyLogicalRequestTerminal,
  handleBridgeMessagesRequest,
  recordProviderRequestIdForLogical,
} from "../src/main/thread-live-request-coordinator";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";
import { BUILTIN_VISION_AGENT_ROLE } from "../src/shared/prompt-image-vision";

afterEach(async () => {
  globalClaudeBridgeBindingRegistry.clearAllForTests();
  await stopGlobalEcoGateway();
});

function providerSecret(id: string, name: string, baseUrl: string): ProviderConfigSecret {
  return {
    id,
    name,
    baseUrl,
    requestPath: "",
    version: "v1",
    defaultModel: "x",
    enabled: true,
    hasApiKey: true,
    apiKey: "sk",
    createdAt: "",
    updatedAt: "",
  };
}

function configureLifecycle(
  providers: ReturnType<typeof providerEntry>[],
  onRequestLifecycle?: import("@eco/gateway").GatewayRequestLifecycleObserver,
) {
  configureEcoGatewayLifecycle({
    ecoDataDir: `/tmp/eco-logical-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    gatewayPort: 0,
    listProviders: () => providers,
    onUsage: async (event) => {
      await emitClaudeGatewayUsageIfSession({
        providerId: event.providerId,
        requestedModel: event.requestedModel,
        upstreamModelId: event.upstreamModelId,
        usage: event.usage,
        ...(event.providerRequestId ? { requestId: event.providerRequestId } : {}),
        ...(event.bridgeBindingId ? { bridgeBindingId: event.bridgeBindingId } : {}),
      });
    },
    ...(onRequestLifecycle ? { onRequestLifecycle } : {}),
  });
}
function providerEntry(id: string, baseUrl: string, model: string) {
  return {
    id,
    name: id,
    enabled: true,
    baseUrl,
    apiKey: "sk",
    apiCompat: "anthropic" as const,
    defaultModel: model,
    modelIds: [model],
  };
}

function messageJson(text: string, id = "msg_1") {
  return {
    id,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function createRegistryWiring(threadId: string, emitTimelineActivity = true) {
  const registry = new ThreadLiveRequestRegistry();
  const bridgeLogicalIds: string[] = [];
  const bridgeTimelineFlags: boolean[] = [];
  const gatewayLogicalIds: string[] = [];
  const terminalEvents: Array<{
    logicalRequestId: string;
    stage: string;
    displayRequestId: string;
  }> = [];

  const onMessagesRequest = ({ role }: { role: string; modelId: string }) => {
    const bridgeResult = handleBridgeMessagesRequest(registry, {
      threadId,
      role,
      emitTimelineActivity,
    });
    bridgeLogicalIds.push(bridgeResult.logicalRequestId);
    bridgeTimelineFlags.push(bridgeResult.emitTimelineActivity);
    return { logicalRequestId: bridgeResult.logicalRequestId };
  };

  const emitLogicalTerminal = (
    logicalRequestId: string,
    role: string,
    stage: "completed" | "failed" | "cancelled",
    detail?: string,
  ) => {
    applyLogicalRequestTerminal(
      registry,
      {
        threadId,
        eventRole: role,
        logicalRequestId,
        stage,
        ...(detail ? { detail } : {}),
      },
      ({ displayRequestId, stage }) => {
        terminalEvents.push({ logicalRequestId, stage, displayRequestId });
      },
    );
  };

  const onRequestLifecycle = (event: import("@eco/gateway").GatewayRequestLifecycleEvent) => {
    if (event.type === "upstream.started") {
      gatewayLogicalIds.push(event.logicalRequestId);
    }
    handleGatewayRequestLifecycleEvent(event, {
      onUpstreamRequestId: ({ logicalRequestId, requestId }) => {
        recordProviderRequestIdForLogical(registry, threadId, logicalRequestId, requestId);
      },
      onUpstreamConnectionError: () => {},
      onLogicalCompleted: ({ logicalRequestId, role }) => {
        emitLogicalTerminal(logicalRequestId, role, "completed");
      },
      onLogicalFailed: ({ logicalRequestId, role }) => {
        emitLogicalTerminal(logicalRequestId, role, "failed");
      },
      onLogicalCancelled: ({ logicalRequestId, role }) => {
        emitLogicalTerminal(logicalRequestId, role, "cancelled");
      },
    });
  };

  return {
    registry,
    bridgeLogicalIds,
    bridgeTimelineFlags,
    gatewayLogicalIds,
    terminalEvents,
    onMessagesRequest,
    onRequestLifecycle,
  };
}

describe("Claude Bridge logical request integration", () => {
  test("concurrent /v1/messages on same binding and role produce distinct gateway logical ids", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: async () =>
        Response.json(messageJson("ok"), {
          headers: { "request-id": `provider_${Math.random().toString(36).slice(2, 8)}` },
        }),
    });
    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    try {
      const threadId = "logical-concurrent";
      const wiring = createRegistryWiring(threadId);
      configureLifecycle([providerEntry("pa", baseUrl, "model-a")], wiring.onRequestLifecycle);

      const proxy = await startAnthropicModelProxy(
        [{ role: "coder", provider: providerSecret("pa", "A", baseUrl), modelId: "model-a" }],
        { threadId, onMessagesRequest: wiring.onMessagesRequest },
      );
      const alias = proxy.routes[0]!.aliasModelId;

      await Promise.all([
        fetch(`${proxy.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
          body: JSON.stringify({
            model: alias,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "one" }],
          }),
        }),
        fetch(`${proxy.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
          body: JSON.stringify({
            model: alias,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "two" }],
          }),
        }),
      ]);

      expect(wiring.bridgeLogicalIds).toHaveLength(2);
      expect(new Set(wiring.bridgeLogicalIds).size).toBe(2);
      expect(wiring.gatewayLogicalIds).toHaveLength(2);
      expect(new Set(wiring.gatewayLogicalIds).size).toBe(2);
      expect(wiring.gatewayLogicalIds.sort()).toEqual(wiring.bridgeLogicalIds.sort());

      await proxy.close();
    } finally {
      upstream.stop(true);
    }
  });

  test("interleaved provider rekey and terminal close two concurrent logical requests independently", async () => {
    let seq = 0;
    const upstream = Bun.serve({
      port: 0,
      fetch: async () => {
        const n = ++seq;
        const providerId = n === 1 ? "provider_slow" : "provider_fast";
        if (n === 1) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return Response.json(messageJson(`text-${n}`, `msg_${n}`), {
          headers: { "request-id": providerId },
        });
      },
    });
    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    try {
      const threadId = "logical-rekey";
      const wiring = createRegistryWiring(threadId);
      configureLifecycle([providerEntry("pa", baseUrl, "model-a")], wiring.onRequestLifecycle);

      const proxy = await startAnthropicModelProxy(
        [{ role: "coder", provider: providerSecret("pa", "A", baseUrl), modelId: "model-a" }],
        { threadId, onMessagesRequest: wiring.onMessagesRequest },
      );
      const alias = proxy.routes[0]!.aliasModelId;

      await Promise.all([
        fetch(`${proxy.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
          body: JSON.stringify({
            model: alias,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "slow" }],
          }),
        }),
        fetch(`${proxy.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
          body: JSON.stringify({
            model: alias,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "fast" }],
          }),
        }),
      ]);

      expect(wiring.bridgeLogicalIds).toHaveLength(2);
      const [slowLogical, fastLogical] = wiring.bridgeLogicalIds;
      expect(wiring.terminalEvents.map((event) => event.logicalRequestId)).toEqual(
        expect.arrayContaining([slowLogical, fastLogical]),
      );
      expect(
        wiring.terminalEvents.find((event) => event.logicalRequestId === fastLogical)?.displayRequestId,
      ).toBe(fastLogical);
      expect(
        wiring.terminalEvents.find((event) => event.logicalRequestId === slowLogical)?.displayRequestId,
      ).toBe(slowLogical);
      expect(wiring.registry.listActive(threadId)).toHaveLength(0);
      await proxy.close();
    } finally {
      upstream.stop(true);
    }
  });

  test("transport failure on one concurrent request does not close the other", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const body = (await req.json()) as { messages?: Array<{ content?: string }> };
        const content = body.messages?.[0]?.content;
        if (content === "fail") {
          return Response.json(
            { type: "error", error: { type: "api_error", message: "upstream unavailable" } },
            { status: 503, headers: { "request-id": "provider_fail" } },
          );
        }
        return Response.json(messageJson("ok"), {
          headers: { "request-id": "provider_ok" },
        });
      },
    });
    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    try {
      const threadId = "logical-transport";
      const wiring = createRegistryWiring(threadId);
      configureLifecycle([providerEntry("pa", baseUrl, "model-a")], wiring.onRequestLifecycle);

      const proxy = await startAnthropicModelProxy(
        [{ role: "coder", provider: providerSecret("pa", "A", baseUrl), modelId: "model-a" }],
        { threadId, onMessagesRequest: wiring.onMessagesRequest },
      );
      const alias = proxy.routes[0]!.aliasModelId;

      const [failRes, okRes] = await Promise.all([
        fetch(`${proxy.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
          body: JSON.stringify({
            model: alias,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "fail" }],
          }),
        }),
        fetch(`${proxy.baseUrl}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
          body: JSON.stringify({
            model: alias,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "ok" }],
          }),
        }),
      ]);

      expect(failRes.status).toBeGreaterThanOrEqual(400);
      expect(okRes.status).toBe(200);

      const failedLogical = wiring.terminalEvents.find((event) => event.stage === "failed");
      const completedLogical = wiring.terminalEvents.find((event) => event.stage === "completed");
      expect(failedLogical).toBeDefined();
      expect(completedLogical).toBeDefined();
      expect(failedLogical!.logicalRequestId).not.toBe(completedLogical!.logicalRequestId);
      expect(completedLogical!.displayRequestId).toBe(completedLogical!.logicalRequestId);
      expect(wiring.registry.listActive(threadId)).toHaveLength(0);
      await proxy.close();
    } finally {
      upstream.stop(true);
    }
  });

  test("non-stream vision /v1/messages registers logical id, stamps attempt, and closes registry entry", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: async () =>
        Response.json(messageJson("vision-ok"), {
          headers: { "request-id": "provider_vision" },
        }),
    });
    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    try {
      const threadId = "vision-logical";
      const wiring = createRegistryWiring(threadId);
      const usages: AnthropicProxyUsageInfo[] = [];
      configureLifecycle([providerEntry("pa", baseUrl, "model-a")], wiring.onRequestLifecycle);

      const proxy = await startAnthropicModelProxy(
        [
          {
            role: BUILTIN_VISION_AGENT_ROLE,
            provider: providerSecret("pa", "A", baseUrl),
            modelId: "model-a",
          },
        ],
        {
          threadId,
          runAttemptId: "attempt_old",
          onMessagesRequest: wiring.onMessagesRequest,
          onUsage: (info) => usages.push(info),
        },
      );
      const binding = globalClaudeBridgeBindingRegistry.getByCredential(proxy.apiKey)!;
      expect(binding.runAttemptId).toBe("attempt_old");
      const alias = proxy.routes[0]!.aliasModelId;

      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
        body: JSON.stringify({
          model: alias,
          max_tokens: 16,
          stream: false,
          messages: [{ role: "user", content: "describe image" }],
        }),
      });
      expect(response.status).toBe(200);

      expect(wiring.bridgeLogicalIds).toHaveLength(1);
      const logicalRequestId = wiring.bridgeLogicalIds[0]!;
      expect(usages[0]?.stampedRunAttemptId).toBe("attempt_old");
      expect(wiring.terminalEvents).toEqual([
        {
          logicalRequestId,
          stage: "completed",
          displayRequestId: logicalRequestId,
        },
      ]);
      expect(wiring.registry.listActive(threadId)).toHaveLength(0);

      const models = await fetch(`${proxy.baseUrl}/v1/models`, {
        headers: { "x-api-key": proxy.apiKey },
      });
      expect(models.status).toBe(200);
      expect(wiring.bridgeLogicalIds).toHaveLength(1);

      await proxy.close();
    } finally {
      upstream.stop(true);
    }
  });

  test("silent proxy lifecycle clears registry without terminal UI events", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: async () =>
        Response.json(messageJson("silent-ok"), {
          headers: { "request-id": "provider_silent" },
        }),
    });
    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    try {
      const threadId = "silent-proxy";
      const wiring = createRegistryWiring(threadId, false);
      configureLifecycle([providerEntry("pa", baseUrl, "model-a")], wiring.onRequestLifecycle);

      const proxy = await startAnthropicModelProxy(
        [{ role: "coder", provider: providerSecret("pa", "A", baseUrl), modelId: "model-a" }],
        { threadId, onMessagesRequest: wiring.onMessagesRequest },
      );
      const alias = proxy.routes[0]!.aliasModelId;

      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
        body: JSON.stringify({
          model: alias,
          max_tokens: 16,
          stream: false,
          messages: [{ role: "user", content: "silent" }],
        }),
      });
      expect(response.status).toBe(200);

      expect(wiring.bridgeLogicalIds).toHaveLength(1);
      expect(wiring.bridgeTimelineFlags).toEqual([false]);
      expect(wiring.terminalEvents).toEqual([]);
      expect(wiring.registry.listActive(threadId)).toHaveLength(0);

      await proxy.close();
    } finally {
      upstream.stop(true);
    }
  });

  test("proxy /v1/messages with simulated SDK request.started leaves one registry entry after lifecycle terminal", async () => {
    const upstream = Bun.serve({
      port: 0,
      fetch: async () =>
        Response.json(messageJson("ok"), {
          headers: { "request-id": "provider_sdk_bridge" },
        }),
    });
    const baseUrl = `http://127.0.0.1:${upstream.port}`;
    try {
      const threadId = "sdk-bridge-ownership";
      const wiring = createRegistryWiring(threadId);
      configureLifecycle([providerEntry("pa", baseUrl, "model-a")], wiring.onRequestLifecycle);

      const proxy = await startAnthropicModelProxy(
        [{ role: "coder", provider: providerSecret("pa", "A", baseUrl), modelId: "model-a" }],
        { threadId, onMessagesRequest: wiring.onMessagesRequest },
      );
      const alias = proxy.routes[0]!.aliasModelId;

      expect(wiring.registry.listActive(threadId)).toHaveLength(0);

      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": proxy.apiKey },
        body: JSON.stringify({
          model: alias,
          max_tokens: 16,
          stream: false,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(response.status).toBe(200);

      expect(wiring.bridgeLogicalIds).toHaveLength(1);
      expect(wiring.registry.listActive(threadId)).toHaveLength(0);
      expect(wiring.terminalEvents).toEqual([
        {
          logicalRequestId: wiring.bridgeLogicalIds[0]!,
          stage: "completed",
          displayRequestId: wiring.bridgeLogicalIds[0]!,
        },
      ]);

      await proxy.close();
    } finally {
      upstream.stop(true);
    }
  });
});
