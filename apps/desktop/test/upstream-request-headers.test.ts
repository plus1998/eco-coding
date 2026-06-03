import { expect, test } from "bun:test";
import {
  buildProviderDirectUpstreamHeaders,
  buildProxyUpstreamHeaders,
} from "../src/main/upstream-request-headers";

test("buildProxyUpstreamHeaders passthrough SDK user-agent on anthropic path", () => {
  const headers = buildProxyUpstreamHeaders({
    clientHeaders: { "user-agent": "claude-sdk/1.0", accept: "application/json" },
    apiKey: "secret",
    apiCompat: "anthropic",
  });
  expect(headers["user-agent"]).toBe("claude-sdk/1.0");
  expect(headers.accept).toBe("application/json");
  expect(headers["x-api-key"]).toBe("secret");
});

test("buildProxyUpstreamHeaders passthrough SDK user-agent on openai path", () => {
  const headers = buildProxyUpstreamHeaders({
    clientHeaders: { "user-agent": "claude-sdk/2.0" },
    apiKey: "secret",
    apiCompat: "openai_responses",
  });
  expect(headers["user-agent"]).toBe("claude-sdk/2.0");
  expect(headers.authorization).toBe("Bearer secret");
  expect(headers["anthropic-version"]).toBeUndefined();
});

test("buildProxyUpstreamHeaders omits user-agent when client has none and no override", () => {
  const headers = buildProxyUpstreamHeaders({
    clientHeaders: {},
    apiKey: "",
    apiCompat: "openai_chat_completions",
  });
  expect(headers["user-agent"]).toBeUndefined();
});

test("buildProxyUpstreamHeaders global override wins over SDK", () => {
  const headers = buildProxyUpstreamHeaders({
    clientHeaders: { "user-agent": "claude-sdk/1.0" },
    apiKey: "k",
    apiCompat: "anthropic",
    upstreamUserAgent: "custom-gateway/9",
  });
  expect(headers["user-agent"]).toBe("custom-gateway/9");
});

test("buildProviderDirectUpstreamHeaders only sets user-agent when override configured", () => {
  expect(
    buildProviderDirectUpstreamHeaders({
      apiKey: "k",
      apiCompat: "anthropic",
    })["user-agent"],
  ).toBeUndefined();
  expect(
    buildProviderDirectUpstreamHeaders({
      apiKey: "k",
      apiCompat: "anthropic",
      upstreamUserAgent: "eco-test/1",
    })["user-agent"],
  ).toBe("eco-test/1");
});
