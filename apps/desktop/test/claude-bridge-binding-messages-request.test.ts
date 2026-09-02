import { afterEach, expect, test } from "bun:test";
import {
  type ClaudeBridgeBindingRoute,
  globalClaudeBridgeBindingRegistry,
  readClaudeBridgeMessagesRequestLogicalId,
} from "../src/main/claude-bridge-binding";
import type { ProviderConfigSecret } from "../src/main/provider-store";

const registry = globalClaudeBridgeBindingRegistry;

function providerSecret(id: string): ProviderConfigSecret {
  return {
    id,
    name: id,
    baseUrl: "http://mock",
    requestPath: "",
    version: "v1",
    defaultModel: "model-a",
    enabled: true,
    hasApiKey: true,
    apiKey: "sk",
    createdAt: "",
    updatedAt: "",
  };
}

function route(): ClaudeBridgeBindingRoute {
  return {
    role: "coder",
    provider: providerSecret("pa"),
    modelId: "model-a",
    aliasModelId: "alias-a",
    apiCompat: "anthropic",
  };
}

afterEach(() => {
  registry.clearAllForTests();
});

test("onMessagesRequest logicalRequestId survives registry storage and recall", () => {
  const binding = registry.create({
    threadId: "thread-1",
    routes: [route()],
    callbacks: {
      onMessagesRequest: () => ({ logicalRequestId: "req_x" }),
    },
  });

  const stored = registry.getByBindingId(binding.bindingId);
  const result = stored?.callbacks.onMessagesRequest?.({ role: "coder", modelId: "model-a" });
  expect(readClaudeBridgeMessagesRequestLogicalId(result)).toBe("req_x");
});

test("onMessagesRequest may return void without a logical id", () => {
  const binding = registry.create({
    threadId: "thread-1",
    routes: [route()],
    callbacks: {
      onMessagesRequest: () => undefined,
    },
  });

  const result = binding.callbacks.onMessagesRequest?.({ role: "coder", modelId: "model-a" });
  expect(readClaudeBridgeMessagesRequestLogicalId(result)).toBeUndefined();
});
