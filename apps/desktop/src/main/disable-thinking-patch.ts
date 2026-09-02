import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";
import type { UpstreamApiCompat } from "../shared/api-compat";

export function buildDisableThinkingChatPatch(
  apiCompat: UpstreamApiCompat,
): Record<string, unknown> | undefined {
  if (apiCompat !== "openai_chat_completions") {
    return undefined;
  }
  return { chat_template_kwargs: { enable_thinking: false } };
}

export function applyDisableThinkingUpstreamPatch(
  payload: Record<string, unknown>,
  apiCompat: UpstreamApiCompat,
  anthropicRequest: AnthropicRequest,
): void {
  if (anthropicRequest.thinking?.type !== "disabled") {
    return;
  }
  const patch = buildDisableThinkingChatPatch(apiCompat);
  if (!patch) {
    return;
  }
  Object.assign(payload, patch);
}
