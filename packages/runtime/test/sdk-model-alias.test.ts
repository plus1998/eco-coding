import { expect, test } from "bun:test";
import type { ResolvedModelRoute } from "../../model-router/src";
import {
  createSdkModelResolver,
  resolveMainSdkModelId,
  resolveSdkModelId,
} from "../src/sdk-model-alias";

function route(
  role: ResolvedModelRoute["role"],
  aliasModelId: string,
  upstreamModelId: string,
): ResolvedModelRoute {
  return {
    role,
    upstreamModelId,
    primary: {
      id: `${role}:p1`,
      provider: "custom",
      displayName: role,
      baseUrl: "https://example.test",
      modelId: aliasModelId,
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  };
}

test("resolveSdkModelId maps agent role to alias", () => {
  const routes = [route("planner", "eco-planner-abc", "gpt-5.4-mini")];
  expect(resolveSdkModelId(routes, "planner", "gpt-5.4")).toBe("eco-planner-abc");
});

test("resolveSdkModelId maps eco_ agent keys to alias", () => {
  const routes = [route("researcher", "eco-researcher-xyz", "research-model")];
  expect(resolveSdkModelId(routes, "eco_researcher", "research-model")).toBe("eco-researcher-xyz");
});

test("resolveSdkModelId maps profile upstream id to alias without leaking bare id", () => {
  const routes = [route("planner", "eco-planner-abc", "gpt-5.4-mini")];
  expect(resolveSdkModelId(routes, "unknown", "gpt-5.4")).toBe("eco-planner-abc");
  expect(resolveSdkModelId(routes, "unknown", "gpt-5.4-mini")).toBe("eco-planner-abc");
});

test("resolveMainSdkModelId prefers planner alias over profile upstream id", () => {
  const routes = [route("planner", "eco-planner-abc", "gpt-5.4-mini")];
  expect(resolveMainSdkModelId(routes, "gpt-5.4")).toBe("eco-planner-abc");
});

test("createSdkModelResolver never returns unconfigured upstream id when routes exist", () => {
  const resolve = createSdkModelResolver([route("planner", "eco-planner-abc", "qwen-plus")]);
  expect(resolve("planner", "gpt-5.4")).toBe("eco-planner-abc");
});
