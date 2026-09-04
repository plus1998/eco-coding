import { describe, expect, test } from "bun:test";
import {
  GATEWAY_LOGICAL_REQUEST_ID_HEADER,
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
} from "../src/provider-router.js";
import type { GatewayConfig, GatewayProvider, GatewayUsageEvent } from "../src/types.js";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";

const ANTHROPIC_STREAM_FIXTURE = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg_stream_1","type":"message","role":"assistant","model":"claude-test","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"output_tokens":3,"cache_read_input_tokens":2,"cache_creation_input_tokens":0}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
  "",
].join("\n");

describe("POST /v1/messages stream usage", () => {
  test("native anthropic stream emits messages onUsage", async () => {
    const provider: GatewayProvider = {
      id: "anthropic_stream",
      name: "Anthropic",
      upstreamKind: "anthropic-messages",
      baseUrl: "http://mock.anthropic.test",
      apiKey: "sk-test",
      upstreamModelId: "claude-test",
      models: ["claude-test"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const usageEvents: GatewayUsageEvent[] = [];
    const handler = createTestGatewayFetchHandler(
      config,
      async () =>
        new Response(ANTHROPIC_STREAM_FIXTURE, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      () => undefined,
      (event) => usageEvents.push(event),
      () => undefined,
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "anthropic_stream",
          [GATEWAY_REQUESTED_MODEL_HEADER]: "eco-planner-alias",
          [GATEWAY_LOGICAL_REQUEST_ID_HEADER]: "req_logical_stream_1",
        },
        body: JSON.stringify({
          model: "claude-test",
          max_tokens: 64,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("message_start");
    expect(text).toContain("message_stop");
    // Allow microtask queue to settle observer
    await Promise.resolve();
    await Promise.resolve();
    expect(usageEvents).toHaveLength(1);
    expect(typeof usageEvents[0]?.ttftMs).toBe("number");
    expect(typeof usageEvents[0]?.generationMs).toBe("number");
    expect(usageEvents[0]).toMatchObject({
      source: "messages",
      providerId: "anthropic_stream",
      requestedModel: "eco-planner-alias",
      upstreamModelId: "claude-test",
      stream: true,
      responseId: "msg_stream_1",
      logicalRequestId: "req_logical_stream_1",
      usage: {
        inputTokens: 12,
        outputTokens: 3,
        cacheReadTokens: 2,
        cacheCreationTokens: 0,
      },
    });
  });

  test("messages→responses stream emits messages onUsage from converted SSE", async () => {
    const provider: GatewayProvider = {
      id: "resp_stream",
      name: "Responses",
      upstreamKind: "responses",
      baseUrl: "http://mock.resp.test",
      apiKey: "sk-test",
      upstreamModelId: "gpt-test",
      models: ["gpt-test"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    const usageEvents: GatewayUsageEvent[] = [];
    // Minimal Completed response as SSE event stream OpenAI style
    const responsesStream = [
      "event: response.created",
      'data: {"type":"response.created","response":{"id":"resp_1","object":"response","status":"in_progress","model":"gpt-test","output":[]}}',
      "",
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","content":[],"status":"in_progress"}}',
      "",
      "event: response.content_part.added",
      'data: {"type":"response.content_part.added","item_id":"msg_1","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}',
      "",
      "event: response.output_text.delta",
      'data: {"type":"response.output_text.delta","item_id":"msg_1","output_index":0,"content_index":0,"delta":"hello"}',
      "",
      "event: response.output_text.done",
      'data: {"type":"response.output_text.done","item_id":"msg_1","output_index":0,"content_index":0,"text":"hello"}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"hello"}],"status":"completed"}}',
      "",
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","status":"completed","model":"gpt-test","output":[{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"hello"}],"status":"completed"}],"usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14}}}',
      "",
      "",
    ].join("\n");

    const handler = createTestGatewayFetchHandler(
      config,
      async () =>
        new Response(responsesStream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "x-request-id": "req_resp_stream",
          },
        }),
      () => undefined,
      (event) => usageEvents.push(event),
      () => undefined,
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "resp_stream",
        },
        body: JSON.stringify({
          model: "gpt-test",
          max_tokens: 64,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_resp_stream");
    // Drain stream so pump finishes and usage settles
    await response.text();
    await Promise.resolve();
    await Promise.resolve();

    expect(usageEvents.length).toBeGreaterThanOrEqual(1);
    const last = usageEvents[usageEvents.length - 1];
    expect(last?.source).toBe("messages");
    expect(last?.providerId).toBe("resp_stream");
    expect(last?.stream).toBe(true);
    expect(typeof last?.ttftMs).toBe("number");
    expect(typeof last?.generationMs).toBe("number");
    expect((last?.usage.inputTokens ?? 0) + (last?.usage.outputTokens ?? 0)).toBeGreaterThan(0);
  });
});
