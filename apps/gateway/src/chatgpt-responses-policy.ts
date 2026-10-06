import type { ResponsesRequest } from "@eco/openai-anthropic-bridge";
import type { GatewayProvider } from "./types.js";

const UNSUPPORTED_FIELDS = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
] as const;

/** Validate the current ChatGPT plan sharing preview contract before an upstream call. */
export function validateChatGptResponsesRequest(
  provider: GatewayProvider,
  body: ResponsesRequest,
): string | undefined {
  if (provider.authMethod !== "chatgpt_subscription") return undefined;
  if (body.store !== false) return "ChatGPT 订阅 Responses 请求必须设置 store:false";
  if (body.stream !== true) return "ChatGPT 订阅 Responses 请求必须设置 stream:true";
  if (!Array.isArray(body.input)) return "ChatGPT 订阅 Responses 请求的 input 必须是数组";
  for (const field of UNSUPPORTED_FIELDS) {
    if (field in (body as unknown as Record<string, unknown>)) {
      return `ChatGPT 订阅 Responses 暂不支持字段：${field}`;
    }
  }
  if ("previous_response_id" in (body as unknown as Record<string, unknown>)) {
    return "ChatGPT 订阅 Responses 不支持 previous_response_id";
  }
  for (const item of body.input) {
    if (item && typeof item === "object" && "type" in item && item.type === "message" && "role" in item) {
      const role = (item as { role?: unknown }).role;
      if (role === "system") return "ChatGPT 订阅 Responses 不支持 system message item";
    }
  }
  if (Array.isArray(body.tools)) {
    const unsupportedTool = body.tools.find((tool) => {
      if (!tool || typeof tool !== "object") return false;
      const type = (tool as { type?: unknown }).type;
      return type === "image_generation" || type === "file_search" || type === "code_interpreter" ||
        type === "computer_use_preview" || type === "computer_use" || type === "mcp" || type === "tool_search";
    });
    if (unsupportedTool) return `ChatGPT 订阅 Responses 暂不支持 hosted tool：${String((unsupportedTool as { type?: unknown }).type)}`;
  }
  return undefined;
}
