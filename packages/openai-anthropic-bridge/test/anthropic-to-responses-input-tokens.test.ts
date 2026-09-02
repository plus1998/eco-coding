import { describe, expect, test } from "bun:test";
import {
  anthropicToResponsesInputTokensBody,
  responsesInputTokensToAnthropicCount,
} from "../src/anthropic-to-responses-input-tokens.js";

describe("anthropic → responses input_tokens", () => {
  test("builds input_tokens body from anthropic count_tokens request", () => {
    const body = anthropicToResponsesInputTokensBody({
      model: "gpt-5",
      max_tokens: 1024,
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "get_weather",
          description: "Weather",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    });

    expect(body.model).toBe("gpt-5");
    expect(body.input).toBeDefined();
    expect(body.stream).toBeUndefined();
    expect(body.max_output_tokens).toBeUndefined();
    expect(Array.isArray(body.tools)).toBe(true);
  });

  test("maps OpenAI input_tokens response to anthropic count shape", () => {
    expect(
      responsesInputTokensToAnthropicCount({
        object: "response.input_tokens",
        input_tokens: 2095,
      }),
    ).toEqual({ input_tokens: 2095 });
  });

  test("maps full responses.create payload when provider omits input_tokens envelope", () => {
    expect(
      responsesInputTokensToAnthropicCount({
        object: "response",
        status: "completed",
        usage: {
          input_tokens: 173,
          output_tokens: 27,
          total_tokens: 200,
        },
      }),
    ).toEqual({ input_tokens: 173 });
  });

  test("rejects invalid input_tokens response", () => {
    expect(() => responsesInputTokensToAnthropicCount({ object: "x" })).toThrow();
  });
});
