import { CONVERSATION_V2_ERROR, type ConversationMessage, ConversationV2Error } from "@eco/shared";
import type { PromptImageAttachment } from "../shared/ipc";
import { isPromptImageAttachmentRecord } from "./prompt-image-file-store";

export interface AcceptedConversationMessageSchedule {
  conversationId: string;
  messageId: string;
  turnId: string;
  text: string;
  attachments?: PromptImageAttachment[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConversationV2Request(
  value: unknown,
  requiredKeys: readonly string[],
  stringKeys: readonly string[] = requiredKeys,
): Record<string, any> {
  if (!isRecord(value)) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.invalidParams,
      "Conversation V2 request must be an object.",
    );
  }
  for (const key of requiredKeys) {
    if (!(key in value)) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.invalidParams,
        `Conversation V2 request is missing ${key}.`,
      );
    }
  }
  const request = { ...value } as Record<string, any>;
  for (const key of stringKeys) {
    request[key] = requiredConversationV2String(request[key], key);
  }
  return request;
}

export function requiredConversationV2String(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.invalidParams,
      `Conversation V2 ${field} is required.`,
    );
  }
  return value.trim();
}

export function readOptionalConversationV2String(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.invalidParams,
      `Conversation V2 ${field} must be a non-empty string when provided.`,
    );
  }
  return value.trim();
}

export function readPositiveInteger(value: unknown, fallback: number | undefined): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  throw new ConversationV2Error(
    CONVERSATION_V2_ERROR.invalidParams,
    "Conversation V2 integer must be a positive integer.",
  );
}

export function readOptionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new ConversationV2Error(
    CONVERSATION_V2_ERROR.invalidParams,
    "Conversation V2 integer must be a non-negative integer.",
  );
}

export function requiredConversationV2Integer(value: unknown, field: string): number {
  const parsed = readOptionalInteger(value);
  if (parsed === undefined) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.invalidParams,
      `Conversation V2 ${field} is required.`,
    );
  }
  return parsed;
}

/** Rebuild the durable runtime scheduling input from one queued V2 user row. */
export function buildAcceptedConversationMessageSchedule(
  message: ConversationMessage,
): AcceptedConversationMessageSchedule {
  const attachments = parseConversationV2PromptImageAttachments(message.attachments);
  return {
    conversationId: message.conversationId,
    messageId: message.messageId,
    turnId: message.turnId,
    text: message.body,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function parseConversationV2PromptImageAttachments(value: unknown): PromptImageAttachment[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ConversationV2Error(
      CONVERSATION_V2_ERROR.integrityFailure,
      "Queued conversation V2 message attachments are invalid.",
    );
  }
  return value.map((entry) => {
    if (!isPromptImageAttachmentRecord(entry)) {
      throw new ConversationV2Error(
        CONVERSATION_V2_ERROR.integrityFailure,
        "Queued conversation V2 message contains an invalid image attachment.",
      );
    }
    return {
      mediaType: entry.mediaType,
      ...(entry.data?.trim() ? { data: entry.data.trim() } : {}),
      ...(entry.path?.trim() ? { path: entry.path.trim() } : {}),
      ...(entry.contentRef?.trim() ? { contentRef: entry.contentRef.trim() } : {}),
      ...(entry.byteLength !== undefined ? { byteLength: entry.byteLength } : {}),
    };
  });
}
