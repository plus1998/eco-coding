import { expect, test } from "bun:test";
import type { AgentRoleRoute, ModelProfile } from "../../shared/src";
import { resolveModelRoute, runAnthropicConformanceCheck, type FetchLike } from "../src";

const profiles: ModelProfile[] = [
  {
    id: "strong",
    provider: "anthropic",
    displayName: "Strong",
    baseUrl: "https://gateway.test",
    modelId: "strong-model",
    capabilities: ["messages_api", "streaming", "tool_use", "subagent_compatible"],
    enabled: true,
  },
  {
    id: "cheap",
    provider: "custom",
    displayName: "Cheap",
    baseUrl: "https://gateway.test",
    modelId: "cheap-model",
    capabilities: ["messages_api", "streaming"],
    enabled: true,
  },
];

const routes: AgentRoleRoute[] = [
  {
    role: "coder",
    primaryModelId: "strong",
    fallbackModelIds: ["cheap"],
    requiredCapabilities: ["messages_api", "streaming", "tool_use"],
  },
];

test("resolves only models that satisfy route capabilities", () => {
  const resolution = resolveModelRoute("coder", routes, profiles);
  expect(resolution.ok).toBe(true);

  if (resolution.ok) {
    expect(resolution.route.primary.id).toBe("strong");
    expect(resolution.route.fallbacks).toHaveLength(0);
  }
});

test("fails fast when primary model is missing capabilities", () => {
  const resolution = resolveModelRoute(
    "coder",
    [{ ...routes[0], primaryModelId: "cheap" }],
    profiles,
  );

  expect(resolution.ok).toBe(false);
});

test("runs Anthropic-compatible conformance checks without leaking keys", async () => {
  const calls: string[] = [];
  const fetcher: FetchLike = async (input, init) => {
    calls.push(`${init.method} ${input}`);
    expect(init.headers).toMatchObject({
      "x-api-key": "secret",
      "anthropic-version": "2023-06-01",
    });

    return new Response(JSON.stringify({ id: "msg_1", usage: { input_tokens: 1, output_tokens: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await runAnthropicConformanceCheck(profiles[0], {
    baseUrl: "https://gateway.test/",
    apiKey: "secret",
    modelId: "strong-model",
  }, fetcher);

  expect(result.passed).toBe(true);
  expect(result.capabilities.count_tokens).toBe(true);
  expect(result.failures.join("\n")).not.toContain("secret");
  expect(calls).toEqual([
    "POST https://gateway.test/v1/messages",
    "POST https://gateway.test/v1/messages",
    "POST https://gateway.test/v1/messages",
    "POST https://gateway.test/v1/messages/count_tokens",
  ]);
});
