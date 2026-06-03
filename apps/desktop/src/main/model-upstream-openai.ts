/**
 * OpenAI-compat forwarders live in bridge-upstream.ts (Responses IR hub).
 * This module keeps stable import paths for anthropic-proxy.
 */
export {
  forwardCountTokensViaOpenAICompat,
  forwardMessagesViaOpenAICompat,
  type BridgeForwardContext as OpenAICompatForwardContext,
  type BridgeForwardRoute as OpenAICompatForwardRoute,
  type BridgeUsageHandler as OpenAICompatUsageHandler,
  type BridgeUsageInfo as OpenAICompatUsageInfo,
} from "./bridge-upstream";
