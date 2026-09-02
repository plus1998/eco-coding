import { describe, expect, test } from "bun:test";
import { extractUpstreamErrorMessage, formatUpstreamHttpError } from "../src/upstream/upstream-error.js";

describe("upstream-error", () => {
  test("extracts OpenAI-style error.message", () => {
    expect(
      extractUpstreamErrorMessage(
        JSON.stringify({
          error: { message: "We're currently experiencing high demand, which may cause temporary errors." },
        }),
      ),
    ).toBe("We're currently experiencing high demand, which may cause temporary errors.");
  });

  test("attributes provider model and url", () => {
    const message = formatUpstreamHttpError({
      route: {
        provider: {
          id: "custom",
          name: "Custom",
          upstreamKind: "openai-chat",
          baseUrl: "http://192.168.110.78:8080",
          apiKey: "x",
          upstreamModelId: "qwen3.6-35b-a3b",
          models: ["qwen3.6-35b-a3b"],
        },
        upstreamKind: "openai-chat",
        requestedModel: "qwen3.6-35b-a3b",
        upstreamModelId: "qwen3.6-35b-a3b",
      },
      upstreamUrl: "http://192.168.110.78:8080/v1/chat/completions",
      status: 503,
      bodyText: JSON.stringify({
        error: { message: "We're currently experiencing high demand, which may cause temporary errors." },
      }),
    });
    expect(message).toContain("Upstream provider custom");
    expect(message).toContain("model=qwen3.6-35b-a3b");
    expect(message).toContain("status=503");
    expect(message).toContain("high demand");
  });
});
