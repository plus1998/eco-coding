/**
 * Bridge Responses/Chat binding prep must win over pre-set GATEWAY_PROVIDER_ID_HEADER
 * so PI alias body.model is rewritten to concrete upstreamModelId.
 */
import { describe, expect, test } from "bun:test";
import {
  type EcoGatewayServer,
  GATEWAY_BRIDGE_BINDING_ID_HEADER,
  GATEWAY_PROVIDER_ID_HEADER,
  GATEWAY_REQUESTED_MODEL_HEADER,
  GATEWAY_RUN_ATTEMPT_ID_HEADER,
  GATEWAY_THREAD_ID_HEADER,
  GATEWAY_UPSTREAM_KIND_HEADER,
} from "@eco/gateway";
import {
  ECO_BRIDGE_BINDING_ID_HEADER,
  ECO_BRIDGE_RUN_ATTEMPT_ID_HEADER,
} from "../src/main/claude-bridge-binding";
import { createEcoSdkBridgeHandler } from "../src/main/eco-sdk-bridge";

function stubGateway(onRequest: (request: Request) => void | Promise<void>): EcoGatewayServer {
  return {
    port: 0,
    handleRequest: async (request) => {
      await onRequest(request);
      return Response.json({ ok: true });
    },
    stop: () => undefined,
    getProviders: () => [],
    setProviders: () => undefined,
    setUpstreamUserAgent: () => undefined,
    setUpstreamProxyUrl: () => undefined,
    getUpstreamProxyUrl: () => undefined,
  };
}

describe("eco-sdk-bridge binding prep with prebound provider header", () => {
  test("chat_completions: binding prep runs despite GATEWAY_PROVIDER_ID_HEADER and rewrites alias body.model", async () => {
    let gatewayBodyModel = "";
    let gatewayHeaders: Headers | undefined;
    let prepCalled = false;

    const handler = createEcoSdkBridgeHandler({
      gateway: stubGateway(async (request) => {
        gatewayHeaders = new Headers(request.headers);
        const body = (await request.json()) as { model?: string };
        gatewayBodyModel = body.model?.trim() ?? "";
      }),
      prepareGatewayBindingForward: async () => {
        prepCalled = true;
        return {
          kind: "forward",
          resolution: {
            providerId: "llama",
            upstreamModelId: "llama-local",
            upstreamKind: "openai-chat",
          },
          clientModel: "eco_planner__llama__llama-local",
          threadId: "thr_pi",
          bridgeBindingId: "cbb_pi_1",
          runAttemptId: "attempt_9",
          releaseLease: () => undefined,
        };
      },
    });

    const response = await handler(
      new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer binding-cred",
          // PI pre-stamps provider id — must NOT skip binding prep / alias rewrite.
          [GATEWAY_PROVIDER_ID_HEADER]: "llama",
          [GATEWAY_UPSTREAM_KIND_HEADER]: "openai-chat",
          [GATEWAY_REQUESTED_MODEL_HEADER]: "eco_planner__llama__llama-local",
          [ECO_BRIDGE_BINDING_ID_HEADER]: "cbb_stale",
        },
        body: JSON.stringify({
          model: "eco_planner__llama__llama-local",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(prepCalled).toBe(true);
    expect(gatewayBodyModel).toBe("llama-local");
    expect(gatewayBodyModel).not.toBe("eco_planner__llama__llama-local");
    expect(gatewayHeaders?.get(GATEWAY_PROVIDER_ID_HEADER)).toBe("llama");
    expect(gatewayHeaders?.get(GATEWAY_UPSTREAM_KIND_HEADER)).toBe("openai-chat");
    expect(gatewayHeaders?.get(GATEWAY_REQUESTED_MODEL_HEADER)).toBe("eco_planner__llama__llama-local");
    expect(gatewayHeaders?.get(GATEWAY_THREAD_ID_HEADER)).toBe("thr_pi");
    expect(
      gatewayHeaders?.get(GATEWAY_BRIDGE_BINDING_ID_HEADER) ??
        gatewayHeaders?.get(ECO_BRIDGE_BINDING_ID_HEADER),
    ).toBe("cbb_pi_1");
    expect(
      gatewayHeaders?.get(GATEWAY_RUN_ATTEMPT_ID_HEADER) ??
        gatewayHeaders?.get(ECO_BRIDGE_RUN_ATTEMPT_ID_HEADER),
    ).toBe("attempt_9");
  });

  test("chat_completions: PI openai-completions api posts /chat/completions (no /v1 prefix)", async () => {
    let prepFace: string | undefined;
    const handler = createEcoSdkBridgeHandler({
      gateway: stubGateway(async () => {}),
      prepareGatewayBindingForward: async (input) => {
        prepFace = input.face;
        return {
          kind: "forward",
          resolution: {
            providerId: "longcat_chat",
            upstreamModelId: "LongCat-2.0",
            upstreamKind: "openai-chat",
          },
          clientModel: "eco_longcat_chat__LongCat-2.0",
          releaseLease: () => undefined,
        };
      },
    });

    const response = await handler(
      new Request("http://127.0.0.1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer binding-cred" },
        body: JSON.stringify({
          model: "eco_longcat_chat__LongCat-2.0",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(prepFace).toBe("chat_completions");
  });

  test("responses: binding prep rewrites alias even when provider header pre-set", async () => {
    let gatewayBodyModel = "";
    let prepCalled = false;

    const handler = createEcoSdkBridgeHandler({
      gateway: stubGateway(async (request) => {
        const body = (await request.json()) as { model?: string };
        gatewayBodyModel = body.model?.trim() ?? "";
      }),
      prepareGatewayBindingForward: async () => {
        prepCalled = true;
        return {
          kind: "forward",
          resolution: {
            providerId: "openai",
            upstreamModelId: "gpt-5.2",
            upstreamKind: "responses",
          },
          clientModel: "eco_planner__openai__gpt-5.2",
          bridgeBindingId: "cbb_resp",
          releaseLease: () => undefined,
        };
      },
    });

    const response = await handler(
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer binding-cred",
          [GATEWAY_PROVIDER_ID_HEADER]: "openai",
        },
        body: JSON.stringify({
          model: "eco_planner__openai__gpt-5.2",
          input: [],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(prepCalled).toBe(true);
    expect(gatewayBodyModel).toBe("gpt-5.2");
  });

  test("chat_completions: without binding prep hit, prebound concrete model still works", async () => {
    let gatewayBodyModel = "";
    const handler = createEcoSdkBridgeHandler({
      gateway: stubGateway(async (request) => {
        const body = (await request.json()) as { model?: string };
        gatewayBodyModel = body.model?.trim() ?? "";
      }),
      prepareGatewayBindingForward: async () => ({ kind: "miss" }),
    });

    const response = await handler(
      new Request("http://127.0.0.1/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [GATEWAY_PROVIDER_ID_HEADER]: "llama",
          [GATEWAY_UPSTREAM_KIND_HEADER]: "openai-chat",
        },
        body: JSON.stringify({
          model: "llama-local",
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(gatewayBodyModel).toBe("llama-local");
  });
});
