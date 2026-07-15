import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  anthropicEventToResponsesEvents,
  finalizeAnthropicResponsesStream,
  newAnthropicEventToResponsesState,
  responsesEventToSse,
} from "@eco/openai-anthropic-bridge";
import { buildCodexGatewayModelAlias } from "@eco/shared";
import { createGatewayFetchHandler } from "../src/server.js";
import { parseAnthropicStreamEventBlock, splitSseBlocks } from "../src/sse.js";
import { collectResponsesSseEvents } from "../src/upstream/responses-passthrough.js";
import type { GatewayConfig, GatewayProvider, GatewayUsageEvent } from "../src/types.js";

const FIXTURE = readFileSync(
  join(import.meta.dirname, "fixtures", "anthropic-text-stream.sse"),
  "utf8",
);

function anthropicFixtureToResponsesEventTypes(): string[] {
  const state = newAnthropicEventToResponsesState();
  const eventTypes: string[] = [];
  const { blocks } = splitSseBlocks(FIXTURE);
  for (const block of blocks) {
    const evt = parseAnthropicStreamEventBlock(block);
    if (!evt) {
      continue;
    }
    for (const responsesEvent of anthropicEventToResponsesEvents(evt, state)) {
      eventTypes.push(responsesEvent.type);
    }
  }
  for (const responsesEvent of finalizeAnthropicResponsesStream(state)) {
    eventTypes.push(responsesEvent.type);
  }
  return eventTypes;
}

describe("anthropic-messages golden SSE", () => {
  test("V1 route alias overrides a Responses provider to Anthropic for this request", async () => {
    const provider: GatewayProvider = {
      id: "mixed-wire",
      name: "Mixed wire mock",
      upstreamKind: "responses",
      baseUrl: "https://mock.mixed.test",
      apiKey: "test-key",
      upstreamModelId: "responses-default",
      models: ["responses-default"],
    };
    const alias = buildCodexGatewayModelAlias(
      provider.id,
      "claude/model.__v1",
      "anthropic",
    );
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (input, init) => {
        expect(String(input)).toBe("https://mock.mixed.test/v1/messages");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: "claude/model.__v1",
          stream: true,
        });
        return new Response(FIXTURE, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: alias,
          stream: true,
          input: JSON.stringify([
            {
              type: "message",
              role: "user",
              content: JSON.stringify([{ type: "input_text", text: "Hi" }]),
            },
          ]),
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    if (!response.body) {
      throw new Error("Expected Anthropic override response body");
    }
    expect(await collectResponsesSseEvents(response.body)).toContain("response.completed");
  });

  test("fixture converts to Responses lifecycle events", () => {
    const types = anthropicFixtureToResponsesEventTypes();
    expect(types).toContain("response.created");
    expect(types).toContain("response.output_text.delta");
    expect(types).toContain("response.completed");
    expect(types.filter((t) => t === "response.output_text.delta").length).toBeGreaterThanOrEqual(2);
  });

  test("POST /v1/responses streams converted Responses SSE from mock Anthropic upstream", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const usageEvents: GatewayUsageEvent[] = [];

    const mockFetch: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://mock.anthropic.test/v1/messages");
      const body = JSON.parse(String(init?.body)) as { model: string; stream: boolean };
      expect(body.model).toBe("claude-sonnet-4-20250514");
      expect(body.stream).toBe(true);
      return new Response(FIXTURE, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "request-id": "req_anthropic_stream_01",
        },
      });
    };

    const handler = createGatewayFetchHandler(
      config,
      mockFetch,
      () => undefined,
      (event) => usageEvents.push(event),
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex-root-stream",
            turn_id: "turn-stream-01",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          stream: true,
          input: JSON.stringify([
            {
              type: "message",
              role: "user",
              content: JSON.stringify([{ type: "input_text", text: "Hi" }]),
            },
          ]),
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).not.toBeNull();

    const eventTypes = await collectResponsesSseEvents(response.body!);
    expect(eventTypes).toContain("response.created");
    expect(eventTypes).toContain("response.output_text.delta");
    expect(eventTypes).toContain("response.completed");
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      source: "responses",
      sourceEventId: "anthropic:anthropic:response:msg_golden01",
      providerId: "anthropic",
      requestedModel: "claude-sonnet-4-20250514",
      upstreamModelId: "claude-sonnet-4-20250514",
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        modelId: "claude-sonnet-4-20250514",
      },
      stream: true,
      responseId: "msg_golden01",
      providerRequestId: "req_anthropic_stream_01",
      codexTurnMetadata: {
        threadId: "codex-root-stream",
        turnId: "turn-stream-01",
        requestKind: "turn",
      },
    });
  });

  test("non-stream Anthropic usage preserves cache counters and child turn metadata", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const usageEvents: GatewayUsageEvent[] = [];
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: "msg_json01",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-20250514",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 21,
            output_tokens: 7,
            cache_read_input_tokens: 13,
            cache_creation_input_tokens: 5,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "request-id": "req_anthropic_json_01",
          },
        },
      );
    const handler = createGatewayFetchHandler(
      config,
      mockFetch,
      () => undefined,
      (event) => usageEvents.push(event),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex-child-json",
            turn_id: "turn-json-01",
            parent_thread_id: "codex-root-json",
            subagent_kind: "reviewer",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          stream: false,
          input: JSON.stringify("Hi"),
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()) as { id?: string }).toMatchObject({ id: "msg_json01" });
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      sourceEventId: "anthropic:anthropic:response:msg_json01",
      usage: {
        inputTokens: 21,
        outputTokens: 7,
        cacheReadTokens: 13,
        cacheCreationTokens: 5,
        modelId: "claude-sonnet-4-20250514",
      },
      stream: false,
      responseId: "msg_json01",
      providerRequestId: "req_anthropic_json_01",
      codexTurnMetadata: {
        threadId: "codex-child-json",
        turnId: "turn-json-01",
        parentThreadId: "codex-root-json",
        subagentKind: "reviewer",
        requestKind: "turn",
      },
    });
  });

  test("truncated Anthropic SSE is explicit and never emits partial usage", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const usageEvents: GatewayUsageEvent[] = [];
    const logs: string[] = [];
    const messageStopIndex = FIXTURE.indexOf("event: message_stop");
    expect(messageStopIndex).toBeGreaterThan(0);
    const truncatedFixture = FIXTURE.slice(0, messageStopIndex);
    const handler = createGatewayFetchHandler(
      config,
      async () =>
        new Response(truncatedFixture, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      (message) => logs.push(message),
      (event) => usageEvents.push(event),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex-root-truncated",
            turn_id: "turn-truncated-01",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          stream: true,
          input: JSON.stringify("Hi"),
        }),
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(usageEvents).toHaveLength(0);
    expect(logs.some((message) => message.includes("reason=missing_message_stop"))).toBe(true);
    expect(logs.some((message) => message.includes("usage will not be billed"))).toBe(true);
  });

  test("successful Anthropic status without a body fails explicitly", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const handler = createGatewayFetchHandler(
      config,
      async () =>
        new Response(null, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          stream: true,
          input: JSON.stringify("Hi"),
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("successful response without a body");
  });

  test("reasoning none disables thinking in the Anthropic upstream request", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };

    const mockFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        thinking?: { type?: string };
        output_config?: { effort?: string };
      };
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.output_config).toBeUndefined();
      return new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const handler = createGatewayFetchHandler(config, mockFetch);
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          stream: true,
          input: JSON.stringify("Hi"),
          reasoning: { effort: "none" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
  });

  test("null reasoning is accepted for an Anthropic upstream request", async () => {
    const provider: GatewayProvider = {
      id: "anthropic",
      name: "Anthropic mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.anthropic.test",
      apiKey: "test-key",
      upstreamModelId: "claude-sonnet-4-20250514",
      models: ["claude-sonnet-4-20250514"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };

    const mockFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        thinking?: unknown;
        output_config?: unknown;
      };
      expect(body.thinking).toBeUndefined();
      expect(body.output_config).toBeUndefined();
      return new Response(FIXTURE, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const handler = createGatewayFetchHandler(config, mockFetch);
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          stream: true,
          input: JSON.stringify("Hi"),
          reasoning: null,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
  });

  test("golden wire: fixture SSE lines match expected Responses event types", () => {
    const expectedTypes = anthropicFixtureToResponsesEventTypes();
    const sseLines = expectedTypes.map((type) => {
      const state = newAnthropicEventToResponsesState();
      const { blocks } = splitSseBlocks(FIXTURE);
      const collected: string[] = [];
      for (const block of blocks) {
        const evt = parseAnthropicStreamEventBlock(block);
        if (!evt) {
          continue;
        }
        for (const responsesEvent of anthropicEventToResponsesEvents(evt, state)) {
          if (responsesEvent.type === type) {
            collected.push(responsesEventToSse(responsesEvent).split("\n")[0] ?? "");
          }
        }
      }
      return collected[0];
    });
    expect(sseLines.filter(Boolean).length).toBeGreaterThan(0);
  });
});
