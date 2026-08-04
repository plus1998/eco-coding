import { describe, expect, test } from "bun:test";
import { buildCodexGatewayModelAlias } from "@eco/shared";
import { createGatewayFetchHandler } from "../src/server.js";
import { collectResponsesSseEvents } from "../src/upstream/responses-passthrough.js";
import type {
  GatewayConfig,
  GatewayProvider,
  GatewayUsageEvent,
} from "../src/types.js";

const UPSTREAM_SSE = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_up","model":"gpt-4.1","status":"in_progress","output":[]}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hi"}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_up","model":"gpt-4.1","status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":1,"total_tokens":4}}}',
  "",
].join("\n");

describe("responses passthrough", () => {
  test("malformed reserved V1 aliases return 400 without reaching upstream", async () => {
    const malformed = "eco_route_v1.bad";
    const provider: GatewayProvider = {
      id: "custom",
      name: "Custom mock",
      upstreamKind: "responses",
      baseUrl: "https://mock.custom.test",
      apiKey: "test-key",
      upstreamModelId: "vendor-model",
      models: [malformed],
    };
    let fetched = false;
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async () => {
        fetched = true;
        return Response.json({});
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: malformed, stream: false, input: [] }),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetched).toBe(false);
    expect(await response.json()).toMatchObject({
      error: {
        message: expect.stringContaining("Invalid gateway route alias"),
      },
    });
  });

  test("V1 route alias overrides an Anthropic provider to Responses for this request", async () => {
    const provider: GatewayProvider = {
      id: "mixed-wire",
      name: "Mixed wire mock",
      upstreamKind: "anthropic-messages",
      baseUrl: "https://mock.mixed.test",
      apiKey: "test-key",
      upstreamModelId: "claude-default",
      models: ["claude-default"],
    };
    const alias = buildCodexGatewayModelAlias(
      provider.id,
      "responses/model.__v1",
      "openai_responses",
    );
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (input, init) => {
        expect(String(input)).toBe("https://mock.mixed.test/v1/responses");
        expect(JSON.parse(String(init?.body))).toMatchObject({
          model: "responses/model.__v1",
          stream: false,
        });
        return Response.json({
          id: "resp_override",
          object: "response",
          model: "responses/model.__v1",
          status: "completed",
          output: [],
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: alias, stream: false, input: [] }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "resp_override" });
  });

  test("POST /v1/responses forwards to upstream /v1/responses and streams SSE", async () => {
    const provider: GatewayProvider = {
      id: "openai",
      name: "OpenAI mock",
      upstreamKind: "responses",
      baseUrl: "https://mock.openai.test",
      apiKey: "test-key",
      upstreamModelId: "gpt-4.1",
      models: ["gpt-4.1"],
    };
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 0,
      providers: [provider],
    };

    const mockFetch: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://mock.openai.test/v1/responses");
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        stream: boolean;
      };
      expect(body.model).toBe("gpt-4.1");
      expect(body.stream).toBe(true);
      expect(init?.headers).toMatchObject({
        authorization: "Bearer test-key",
      });
      return new Response(UPSTREAM_SSE, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const usageEvents: GatewayUsageEvent[] = [];
    const handler = createGatewayFetchHandler(
      config,
      mockFetch,
      () => undefined,
      (event) => {
        usageEvents.push(event);
      },
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex_root",
            turn_id: "turn_stream",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "gpt-4.1",
          stream: true,
          input: "[]",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    const eventTypes = await collectResponsesSseEvents(response.body!);
    expect(eventTypes).toEqual([
      "response.created",
      "response.output_text.delta",
      "response.completed",
    ]);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      source: "responses",
      sourceEventId: "responses:openai:response:resp_up",
      providerId: "openai",
      requestedModel: "gpt-4.1",
      upstreamModelId: "gpt-4.1",
      stream: true,
      responseId: "resp_up",
      codexTurnMetadata: {
        threadId: "codex_root",
        turnId: "turn_stream",
        requestKind: "turn",
      },
      usage: {
        inputTokens: 3,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        modelId: "gpt-4.1",
      },
    });
  });

  test("POST /v1/responses observes non-stream JSON usage", async () => {
    const provider: GatewayProvider = {
      id: "custom",
      name: "Custom mock",
      upstreamKind: "responses",
      baseUrl: "https://mock.custom.test",
      apiKey: "test-key",
      upstreamModelId: "vendor-model",
      models: ["eco_custom__vendor-model"],
    };
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 0,
      providers: [provider],
    };

    const mockFetch: typeof fetch = async () =>
      Response.json(
        {
          id: "resp_json",
          object: "response",
          model: "vendor-model",
          status: "completed",
          output: [],
          usage: {
            input_tokens: 8,
            output_tokens: 2,
            total_tokens: 10,
            input_tokens_details: { cached_tokens: 3 },
          },
        },
        {
          headers: { "x-request-id": "req_json_1" },
        },
      );

    const usageEvents: GatewayUsageEvent[] = [];
    const handler = createGatewayFetchHandler(
      config,
      mockFetch,
      () => undefined,
      (event) => {
        usageEvents.push(event);
      },
    );
    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "codex_child",
            turn_id: "turn_json",
            parent_thread_id: "codex_root",
            subagent_kind: "collab_spawn",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "eco_custom__vendor-model",
          stream: false,
          input: "[]",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "resp_json" });
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({
      sourceEventId: "responses:custom:response:resp_json",
      providerId: "custom",
      requestedModel: "eco_custom__vendor-model",
      upstreamModelId: "vendor-model",
      stream: false,
      responseId: "resp_json",
      providerRequestId: "req_json_1",
      codexTurnMetadata: {
        threadId: "codex_child",
        turnId: "turn_json",
        parentThreadId: "codex_root",
        subagentKind: "collab_spawn",
        requestKind: "turn",
      },
      usage: {
        inputTokens: 5,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 0,
        modelId: "vendor-model",
      },
    });
  });

  test("Responses route passthrough preserves custom apply_patch tools", async () => {
    const provider: GatewayProvider = {
      id: "responses-provider",
      name: "Responses mock",
      upstreamKind: "responses",
      baseUrl: "https://mock.responses.test",
      apiKey: "test-key",
      upstreamModelId: "gpt-5.2",
      models: ["gpt-5.2"],
    };
    const alias = buildCodexGatewayModelAlias(
      provider.id,
      "gpt-5.2",
      "openai_responses",
    );
    let upstreamBody: {
      tools?: { type?: string; name?: string }[];
      model?: string;
    } = {};
    const handler = createGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (_input, init) => {
        upstreamBody = JSON.parse(String(init?.body)) as typeof upstreamBody;
        return Response.json({
          id: "resp_custom",
          object: "response",
          model: "gpt-5.2",
          status: "completed",
          output: [
            {
              type: "custom_tool_call",
              id: "item_1",
              call_id: "call_1",
              name: "apply_patch",
              input: "*** Begin Patch\n*** End Patch",
              status: "completed",
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: alias,
          stream: false,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "patch" }],
            },
          ],
          tools: [
            {
              type: "custom",
              name: "apply_patch",
              description: "Apply freeform patch",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamBody.model).toBe("gpt-5.2");
    expect(upstreamBody.tools?.[0]).toMatchObject({
      type: "custom",
      name: "apply_patch",
    });
    const body = (await response.json()) as {
      output?: { type?: string; name?: string }[];
    };
    expect(body.output?.[0]).toMatchObject({
      type: "custom_tool_call",
      name: "apply_patch",
    });
  });
});
