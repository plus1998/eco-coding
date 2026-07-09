import { expect, test } from "bun:test";
import {
  clearOpenAIResponsesUnsupportedParameterMemory,
  dropUnsupportedOpenAIResponsesParameter,
  extractUnsupportedOpenAIResponsesParameter,
  postJsonWithOpenAIResponsesUnsupportedParameterRetry,
} from "../src/main/openai-responses-compat";

test("extractUnsupportedOpenAIResponsesParameter reads nested error strings", () => {
  expect(
    extractUnsupportedOpenAIResponsesParameter(
      JSON.stringify({ detail: "Unsupported parameter: max_output_tokens" }),
    ),
  ).toBe("max_output_tokens");
  expect(
    extractUnsupportedOpenAIResponsesParameter(
      JSON.stringify({ error: { message: "Unrecognized request argument supplied: text.verbosity" } }),
    ),
  ).toBe("text.verbosity");
});

test("dropUnsupportedOpenAIResponsesParameter only drops optional Responses fields", () => {
  const body: Record<string, unknown> = {
    model: "gpt-5.5",
    input: [],
    max_output_tokens: 128000,
    text: { verbosity: "medium" },
    tools: [],
  };

  expect(dropUnsupportedOpenAIResponsesParameter(body, "max_output_tokens")).toEqual({
    dropped: true,
    key: "max_output_tokens",
  });
  expect(body).not.toHaveProperty("max_output_tokens");

  expect(dropUnsupportedOpenAIResponsesParameter(body, "text.verbosity")).toEqual({
    dropped: true,
    key: "text",
  });
  expect(body).not.toHaveProperty("text");

  expect(dropUnsupportedOpenAIResponsesParameter(body, "tools")).toMatchObject({
    dropped: false,
    key: "tools",
    reason: "not_droppable",
  });
  expect(body).toHaveProperty("tools");
});

test("postJsonWithOpenAIResponsesUnsupportedParameterRetry drops unsupported optional params and retries", async () => {
  clearOpenAIResponsesUnsupportedParameterMemory();
  const sentBodies: Array<Record<string, unknown>> = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    sentBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (sentBodies.length === 1) {
      return new Response(JSON.stringify({ detail: "Unsupported parameter: max_output_tokens" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "resp_1", object: "response", output: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await postJsonWithOpenAIResponsesUnsupportedParameterRetry({
    fetcher,
    url: "https://api.example.com/v1/responses",
    headers: { "content-type": "application/json" },
    body: {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      max_output_tokens: 128000,
    },
  });

  expect(result.response.ok).toBe(true);
  expect(result.droppedParams).toEqual(["max_output_tokens"]);
  expect(sentBodies).toHaveLength(2);
  expect(sentBodies[0]).toHaveProperty("max_output_tokens", 128000);
  expect(sentBodies[1]).not.toHaveProperty("max_output_tokens");
});

test("postJsonWithOpenAIResponsesUnsupportedParameterRetry learns repeated unsupported params per endpoint", async () => {
  clearOpenAIResponsesUnsupportedParameterMemory();
  const firstBodies: Array<Record<string, unknown>> = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    firstBodies.push(body);
    if (Object.hasOwn(body, "max_output_tokens")) {
      return new Response(JSON.stringify({ detail: "Unsupported parameter: max_output_tokens" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (Object.hasOwn(body, "cache_control")) {
      return new Response(JSON.stringify({ detail: "Unsupported parameter: cache_control" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "resp_1", object: "response", output: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const body = {
    model: "gpt-5.5",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    max_output_tokens: 128000,
    cache_control: { type: "ephemeral" },
  };

  const first = await postJsonWithOpenAIResponsesUnsupportedParameterRetry({
    fetcher,
    url: "https://api.example.com/v1/responses",
    headers: { "content-type": "application/json" },
    body,
    logContext: { providerId: "codex-whtqjz" },
  });

  expect(first.response.ok).toBe(true);
  expect(first.droppedParams).toEqual(["max_output_tokens", "cache_control"]);
  expect(firstBodies).toHaveLength(3);
  expect(firstBodies[0]).toHaveProperty("max_output_tokens");
  expect(firstBodies[1]).not.toHaveProperty("max_output_tokens");
  expect(firstBodies[1]).toHaveProperty("cache_control");
  expect(firstBodies[2]).not.toHaveProperty("max_output_tokens");
  expect(firstBodies[2]).not.toHaveProperty("cache_control");

  const secondBodies: Array<Record<string, unknown>> = [];
  const learnedFetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    secondBodies.push(sent);
    return new Response(JSON.stringify({ id: "resp_2", object: "response", output: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const second = await postJsonWithOpenAIResponsesUnsupportedParameterRetry({
    fetcher: learnedFetcher,
    url: "https://api.example.com/v1/responses",
    headers: { "content-type": "application/json" },
    body,
    logContext: { providerId: "codex-whtqjz" },
  });

  expect(second.response.ok).toBe(true);
  expect(second.droppedParams).toEqual(["cache_control", "max_output_tokens"]);
  expect(secondBodies).toHaveLength(1);
  expect(secondBodies[0]).not.toHaveProperty("max_output_tokens");
  expect(secondBodies[0]).not.toHaveProperty("cache_control");
});
