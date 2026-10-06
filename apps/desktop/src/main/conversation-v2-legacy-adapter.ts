/** One-time V1 import boundary. Runtime callers use the provider normalizer directly. */
export {
  appendProviderEventToConversationV2 as appendLegacyThreadRunEventToConversationV2,
  conversationV2MessageIdForLegacyEvent,
  type ProviderConversationAdapterOptions as LegacyConversationAdapterOptions,
  withLegacyConversationV2MessageIdentity,
} from "./conversation-v2-provider-events";
