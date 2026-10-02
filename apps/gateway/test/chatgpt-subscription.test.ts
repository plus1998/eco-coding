import { describe, expect, test } from "bun:test";
import { validateChatGptResponsesRequest } from "../src/chatgpt-responses-policy.js";
import { GATEWAY_PROVIDER_ID_HEADER } from "../src/provider-router.js";
import { createGatewayFetchHandler } from "../src/server.js";
import { reportRouteCredentialResult, resolveRouteCredential } from "../src/route-credentials.js";
import type { GatewayConfig, GatewayProvider, ResolvedProviderRoute } from "../src/types.js";

const provider = {
  id: "eco-coding-chatgpt",
  name: "ChatGPT 订阅",
  upstreamKind: "responses" as const,
  baseUrl: "https://api.openai.com",
  apiKey: "local-unused",
  authMethod: "chatgpt_subscription" as const,
  credentialPoolId: "chatgpt-default",
  upstreamModelId: "gpt-5",
  models: ["gpt-5"],
};

const validBody = {
  model: "gpt-5",
  input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
  store: false,
  stream: true,
};

describe("ChatGPT subscription gateway adapter", () => {
  test("accepts the supported Responses preview shape", () => {
    expect(validateChatGptResponsesRequest(provider, validBody as never)).toBeUndefined();
  });

  test("rejects required preview violations before upstream fetch", () => {
    expect(validateChatGptResponsesRequest(provider, { ...validBody, stream: false } as never)).toContain("stream:true");
    expect(validateChatGptResponsesRequest(provider, { ...validBody, store: true } as never)).toContain("store:false");
    expect(validateChatGptResponsesRequest(provider, { ...validBody, temperature: 0 } as never)).toContain("temperature");
    expect(validateChatGptResponsesRequest(provider, { ...validBody, previous_response_id: "resp_1" } as never)).toContain("previous_response_id");
  });

  test("resolves a token at request time and reports the selected account", async () => {
    const route: ResolvedProviderRoute = {
      provider,
      upstreamKind: "responses",
      requestedModel: "gpt-5",
      upstreamModelId: "gpt-5",
    };
    const reports: unknown[] = [];
    const config: GatewayConfig = {
      host: "127.0.0.1",
      port: 18765,
      providers: [provider],
      resolveCredential: async () => ({ accessToken: "oauth-access", accountId: "account-1" }),
      reportCredentialResult: (result) => reports.push(result),
    };
    const resolved = await resolveRouteCredential(route, config);
    expect(resolved.provider.apiKey).toBe("oauth-access");
    expect(resolved.credentialAccountId).toBe("account-1");
    await reportRouteCredentialResult(resolved, config, new Response(null, { status: 429 }));
    expect(reports).toHaveLength(1);
    expect((reports[0] as { accountId: string; statusCode: number }).accountId).toBe("account-1");
    expect((reports[0] as { accountId: string; statusCode: number }).statusCode).toBe(429);
  });

  test("Messages 转 Responses 时提前移除 max_output_tokens 并保留 stream", async () => {
    const chatgptProvider: GatewayProvider = {
      ...provider,
      apiKey: "local-unused",
      models: ["gpt-5"],
    };
    let upstreamBody: Record<string, unknown> | undefined;
    const handler = createGatewayFetchHandler(
      {
        host: "127.0.0.1",
        port: 0,
        providers: [chatgptProvider],
        resolveCredential: async () => ({ accessToken: "oauth-access", accountId: "account-1" }),
      },
      async (_input, init) => {
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: "resp_1",
          object: "response",
          status: "completed",
          model: "gpt-5",
          output: [
            {
              type: "message",
              id: "msg_1",
              role: "assistant",
              content: [{ type: "output_text", text: "ok" }],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "eco-coding-chatgpt",
        },
        body: JSON.stringify({
          model: "gpt-5",
          max_tokens: 32768,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamBody).toBeDefined();
    expect(upstreamBody?.stream).toBe(true);
    expect(upstreamBody).not.toHaveProperty("max_output_tokens");
  });

  test("流式上游 403 保留原状态并报告订阅资格错误", async () => {
    const reports: Array<{ accountId?: string; statusCode: number; errorCode?: string }> = [];
    let upstreamCalls = 0;
    const handler = createGatewayFetchHandler(
      {
        host: "127.0.0.1",
        port: 0,
        providers: [{ ...provider, models: ["gpt-5"] }],
        resolveCredential: async () => ({ accessToken: "oauth-access", accountId: "account-1" }),
        reportCredentialResult: (result) => reports.push(result),
      },
      async () => {
        upstreamCalls += 1;
        return new Response(
          JSON.stringify({
            error: {
              message: "The ChatGPT user is not eligible for subscription sharing.",
              code: "subscription_sharing_user_not_eligible",
            },
          }),
          { status: 403, headers: { "content-type": "text/plain" } },
        );
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "eco-coding-chatgpt",
        },
        body: JSON.stringify({
          model: "gpt-5",
          max_tokens: 128,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-eco-upstream-error-code")).toBe("subscription_sharing_user_not_eligible");
    expect(await response.text()).toContain("not eligible for subscription sharing");
    expect(upstreamCalls).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      accountId: "account-1",
      statusCode: 403,
      errorCode: "subscription_sharing_user_not_eligible",
    });
  });

  test("原生 Responses 请求移除 max_output_tokens 后透传上游 403", async () => {
    let upstreamBody: Record<string, unknown> | undefined;
    const handler = createGatewayFetchHandler(
      {
        host: "127.0.0.1",
        port: 0,
        providers: [{ ...provider, models: ["gpt-5"] }],
        resolveCredential: async () => ({ accessToken: "oauth-access", accountId: "account-1" }),
      },
      async (_input, init) => {
        upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          error: {
            message: "The ChatGPT user is not eligible for subscription sharing.",
            code: "subscription_sharing_user_not_eligible",
          },
        }, { status: 403 });
      },
    );

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "eco-coding-chatgpt",
        },
        body: JSON.stringify({ ...validBody, max_output_tokens: 128 }),
      }),
    );

    expect(response.status).toBe(403);
    expect(upstreamBody).toBeDefined();
    expect(upstreamBody).not.toHaveProperty("max_output_tokens");
  });
});
