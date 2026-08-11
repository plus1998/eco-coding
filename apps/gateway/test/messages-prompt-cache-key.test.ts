import { describe, expect, test } from "bun:test";
import {
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_THREAD_ID_HEADER,
  applyGatewayResponsesPromptCacheHints,
  buildGatewayPromptCacheKey,
} from "../src/provider-router.js";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";
import type { GatewayConfig, GatewayProvider } from "../src/types.js";

describe("messages→responses prompt cache key", () => {
  test("buildGatewayPromptCacheKey sanitizes thread id", () => {
    expect(buildGatewayPromptCacheKey("thread 123")).toBe("eco_thread_thread_123");
    expect(buildGatewayPromptCacheKey("")).toBeUndefined();
  });

  test("applyGatewayResponsesPromptCacheHints sets key and OpenRouter session_id", () => {
    const openRouterBody: Record<string, unknown> = {};
    applyGatewayResponsesPromptCacheHints(openRouterBody, {
      providerBaseUrl: "https://openrouter.ai/api/v1",
      threadId: "thr_abc",
    });
    expect(openRouterBody.prompt_cache_key).toBe("eco_thread_thr_abc");
    expect(openRouterBody.session_id).toBe("eco_thread_thr_abc");
  });

  test("POST /v1/messages via responses attaches prompt_cache_key from thread header", async () => {
    const provider: GatewayProvider = {
      id: "resp_cache",
      name: "Responses",
      upstreamKind: "responses",
      baseUrl: "http://mock.resp.test",
      apiKey: "sk-test",
      upstreamModelId: "gpt-test",
      models: ["gpt-test"],
    };
    const config: GatewayConfig = { host: "127.0.0.1", port: 0, providers: [provider] };
    let capturedBody: Record<string, unknown> | undefined;

    const responsesStream = [
      "event: response.completed",
      'data: {"type":"response.completed","response":{"id":"resp_1","object":"response","status":"completed","model":"gpt-test","output":[{"type":"message","id":"msg_1","role":"assistant","content":[{"type":"output_text","text":"ok"}],"status":"completed"}],"usage":{"input_tokens":10,"output_tokens":1,"total_tokens":11,"input_tokens_details":{"cached_tokens":8}}}}',
      "",
      "",
    ].join("\n");

    const handler = createTestGatewayFetchHandler(
      config,
      async (_input, init) => {
        if (typeof init?.body === "string") {
          capturedBody = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response(responsesStream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "resp_cache",
          [GATEWAY_THREAD_ID_HEADER]: "thr_pi_demo",
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
    await response.text();
    expect(capturedBody?.prompt_cache_key).toBe("eco_thread_thr_pi_demo");
  });
});
