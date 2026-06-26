import { expect, test } from "bun:test";
import {
  applyDisableThinkingUpstreamPatch,
  buildDisableThinkingChatPatch,
} from "../src/main/disable-thinking-patch";
import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";

test("buildDisableThinkingChatPatch only applies to openai chat completions", () => {
  expect(buildDisableThinkingChatPatch("openai_chat_completions")).toEqual({
    chat_template_kwargs: { enable_thinking: false },
  });
  expect(buildDisableThinkingChatPatch("anthropic")).toBeUndefined();
  expect(buildDisableThinkingChatPatch("openai_responses")).toBeUndefined();
});

test("applyDisableThinkingUpstreamPatch merges chat_template_kwargs for disabled thinking", () => {
  const payload: Record<string, unknown> = { model: "local-model" };
  const request = {
    model: "local-model",
    max_tokens: 256,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: "hi" }],
  } satisfies AnthropicRequest;

  applyDisableThinkingUpstreamPatch(payload, "openai_chat_completions", request);

  expect(payload).toEqual({
    model: "local-model",
    chat_template_kwargs: { enable_thinking: false },
  });
});

test("applyDisableThinkingUpstreamPatch is a no-op when thinking is enabled", () => {
  const payload: Record<string, unknown> = { model: "local-model" };
  const request = {
    model: "local-model",
    max_tokens: 256,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: "hi" }],
  } satisfies AnthropicRequest;

  applyDisableThinkingUpstreamPatch(payload, "openai_chat_completions", request);

  expect(payload).toEqual({ model: "local-model" });
});
