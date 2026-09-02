import { describe, expect, test } from "bun:test";
import { GATEWAY_PROVIDER_ID_HEADER, GATEWAY_REQUESTED_MODEL_HEADER } from "../src/provider-router.js";
import type { GatewayConfig, GatewayProvider } from "../src/types.js";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";

describe("POST /v1/messages openai-chat face", () => {
  test("non-stream Anthropic Messages body converts via chat completions", async () => {
    const provider: GatewayProvider = {
      id: "chat",
      name: "Chat",
      upstreamKind: "openai-chat",
      baseUrl: "http://mock.chat.test",
      apiKey: "sk-test",
      upstreamModelId: "chat-model",
      models: ["chat-model"],
    };
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 0,
      providers: [provider],
    };
    let upstreamUrl = "";
    let upstreamBody: Record<string, unknown> | undefined;
    const handler = createTestGatewayFetchHandler(config, async (input, init) => {
      upstreamUrl = String(input);
      upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "chatcmpl-msg",
        object: "chat.completion",
        created: 1,
        model: "chat-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hi from chat" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      });
    });

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "chat",
          [GATEWAY_REQUESTED_MODEL_HEADER]: "eco-coder-alias",
        },
        body: JSON.stringify({
          model: "chat-model",
          max_tokens: 64,
          stream: false,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamUrl).toBe("http://mock.chat.test/v1/chat/completions");
    expect(upstreamBody?.model).toBe("chat-model");
    expect(Array.isArray(upstreamBody?.messages)).toBe(true);
    const json = (await response.json()) as {
      type: string;
      role: string;
      content: Array<{ type: string; text: string }>;
    };
    expect(json.type).toBe("message");
    expect(json.role).toBe("assistant");
    expect(JSON.stringify(json.content)).toContain("hi from chat");
  });
});
