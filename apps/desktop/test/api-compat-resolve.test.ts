import { expect, test } from "bun:test";
import {
  assertApiCompatCompatibleWithProviderPath,
  IncompatibleApiCompatError,
  isMessagesOnlyRequestPath,
  resolveUpstreamApiCompat,
} from "../src/shared/api-compat";

test("isMessagesOnlyRequestPath matches DeepSeek anthropic prefix", () => {
  expect(isMessagesOnlyRequestPath("/anthropic")).toBe(true);
  expect(isMessagesOnlyRequestPath("anthropic")).toBe(true);
  expect(isMessagesOnlyRequestPath("/anthropic/")).toBe(true);
  expect(isMessagesOnlyRequestPath("")).toBe(false);
  expect(isMessagesOnlyRequestPath("/v1")).toBe(false);
});

test("resolveUpstreamApiCompat prefers route override without silent rewrite", () => {
  expect(resolveUpstreamApiCompat("openai_responses", "anthropic")).toBe("openai_responses");
  expect(resolveUpstreamApiCompat(undefined, "openai_responses")).toBe("openai_responses");
  expect(resolveUpstreamApiCompat(undefined, undefined)).toBe("anthropic");
});

test("assertApiCompatCompatibleWithProviderPath blocks OpenAI on /anthropic", () => {
  expect(() =>
    assertApiCompatCompatibleWithProviderPath({
      apiCompat: "openai_responses",
      providerRequestPath: "/anthropic",
      providerId: "deepseek-1z2ogb",
      providerName: "DeepSeek",
    }),
  ).toThrow(IncompatibleApiCompatError);

  expect(() =>
    assertApiCompatCompatibleWithProviderPath({
      apiCompat: "openai_responses",
      providerRequestPath: "",
      providerId: "packy",
    }),
  ).not.toThrow();

  expect(() =>
    assertApiCompatCompatibleWithProviderPath({
      apiCompat: "anthropic",
      providerRequestPath: "/anthropic",
    }),
  ).not.toThrow();
});
