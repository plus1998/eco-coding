import { describe, expect, test } from "bun:test";
import { buildModelsListUrl, parseUpstreamModelsPayload } from "../src/main/provider-models";

describe("buildModelsListUrl", () => {
  test("uses origin only and drops anthropic-style path suffix", () => {
    expect(buildModelsListUrl("https://api.deepseek.com/anthropic")).toBe("https://api.deepseek.com/v1/models");
    expect(buildModelsListUrl("https://api.deepseek.com/anthropic/")).toBe("https://api.deepseek.com/v1/models");
  });

  test("works for bare host and local proxy", () => {
    expect(buildModelsListUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/v1/models");
    expect(buildModelsListUrl("http://127.0.0.1:55302")).toBe("http://127.0.0.1:55302/v1/models");
  });
});

describe("parseUpstreamModelsPayload", () => {
  test("parses Anthropic-style models list", () => {
    const models = parseUpstreamModelsPayload({
      data: [
        { id: "claude-opus-4-7", display_name: "Opus 4.7", type: "model" },
        { id: "claude-sonnet-4-6", display_name: "Sonnet 4.6", type: "model" },
      ],
    });
    expect(models).toEqual([
      { id: "claude-opus-4-7", displayName: "Opus 4.7" },
      { id: "claude-sonnet-4-6", displayName: "Sonnet 4.6" },
    ]);
  });

  test("parses OpenAI-style models list", () => {
    const models = parseUpstreamModelsPayload({
      data: [{ id: "gpt-4o", object: "model" }],
    });
    expect(models).toEqual([{ id: "gpt-4o", displayName: undefined }]);
  });
});
