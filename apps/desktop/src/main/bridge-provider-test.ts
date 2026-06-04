import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";
import { applyThinkingToMessagesBody } from "@eco/runtime";
import type { UpstreamApiCompat } from "../shared/api-compat";
import type { ThinkingEffort } from "../shared/ipc";
import { ROUTE_TEST_THINKING_EFFORT } from "../shared/models";
import {
  buildBridgeUpstreamMessagesPayload,
  parseBridgeProbeReply,
  type BridgeProbeParseResult,
} from "./bridge-upstream";

const PROVIDER_TEST_MAX_TOKENS = 256;

export function buildBridgeProviderTestAnthropicRequest(
  modelId: string,
  thinkingEffort: ThinkingEffort = ROUTE_TEST_THINKING_EFFORT,
): AnthropicRequest {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: PROVIDER_TEST_MAX_TOKENS,
    messages: [{ role: "user", content: "hi" }],
  };
  applyThinkingToMessagesBody(body, thinkingEffort);
  return body as unknown as AnthropicRequest;
}

/** Same wire-shape rules as proxy forwarders; OpenAI compat probes use streaming. */
export function buildBridgeProviderTestUpstreamBody(
  apiCompat: UpstreamApiCompat,
  anthropicRequest: AnthropicRequest,
  modelId: string,
): { body: Record<string, unknown>; preferStream: boolean } {
  const stream = apiCompat !== "anthropic";
  const body = buildBridgeUpstreamMessagesPayload(apiCompat, anthropicRequest, modelId, stream);
  return { body, preferStream: stream };
}

export async function parseBridgeProviderTestReply(params: {
  apiCompat: UpstreamApiCompat;
  modelId: string;
  anthropicRequest: AnthropicRequest;
  response: Response;
  preferStream: boolean;
}): Promise<BridgeProbeParseResult> {
  return parseBridgeProbeReply(params);
}
