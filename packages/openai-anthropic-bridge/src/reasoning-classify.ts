/**
 * Reasoning channel classification across provider dialects.
 *
 * Channels (Responses-shaped intermediate model):
 * - summary: user-visible reasoning summary (`summary` / `reasoning_summary_text`)
 * - raw: full chain-of-thought body (`content` / `reasoning_text`)
 * - opaque: non-display state (`encrypted_content` / `redacted_thinking` / signatures)
 *
 * Display policy (Eco): prefer summary for Anthropic thinking / UI; fall back to raw.
 * Chat flat `reasoning_content` / `reasoning` are classified as raw (DeepSeek/Qwen/OpenRouter).
 */

import type {
  ChatMessage,
  ChatReasoningDetail,
  ChatReasoningItem,
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesOutput,
  ResponsesSummary,
} from "./types.js";

export type ReasoningChannel = "summary" | "raw" | "opaque";

export type ClassifiedReasoningPart = {
  channel: ReasoningChannel;
  text?: string;
  data?: string;
  signature?: string;
  id?: string;
  index?: number;
  source: string;
};

export type ClassifiedReasoning = {
  summaryParts: ClassifiedReasoningPart[];
  rawParts: ClassifiedReasoningPart[];
  opaqueParts: ClassifiedReasoningPart[];
  summaryText: string;
  rawText: string;
};

/** Catalog of known provider fields → channel (documentation + tests). */
export const REASONING_FIELD_CATALOG = [
  // OpenAI Responses
  { dialect: "responses", field: "summary[].summary_text", channel: "summary" as const },
  { dialect: "responses", field: "response.reasoning_summary_text.*", channel: "summary" as const },
  { dialect: "responses", field: "content[].reasoning_text", channel: "raw" as const },
  { dialect: "responses", field: "response.reasoning_text.*", channel: "raw" as const },
  { dialect: "responses", field: "encrypted_content", channel: "opaque" as const },
  // Anthropic Messages
  { dialect: "anthropic", field: "thinking", channel: "raw" as const },
  { dialect: "anthropic", field: "thinking_delta", channel: "raw" as const },
  { dialect: "anthropic", field: "redacted_thinking.data", channel: "opaque" as const },
  { dialect: "anthropic", field: "signature / signature_delta", channel: "opaque" as const },
  // OpenAI-compatible Chat
  { dialect: "chat", field: "reasoning_content", channel: "raw" as const },
  { dialect: "chat", field: "reasoning (string)", channel: "raw" as const },
  { dialect: "chat", field: "content[].thinking|reasoning", channel: "raw" as const },
  { dialect: "chat", field: "reasoning_items[].summary", channel: "summary" as const },
  { dialect: "chat", field: "reasoning_items[].content", channel: "raw" as const },
  { dialect: "chat", field: "reasoning_items[].encrypted_content", channel: "opaque" as const },
  // OpenRouter reasoning_details
  { dialect: "openrouter", field: "reasoning_details[].type=reasoning.summary", channel: "summary" as const },
  { dialect: "openrouter", field: "reasoning_details[].type=reasoning.text", channel: "raw" as const },
  { dialect: "openrouter", field: "reasoning_details[].type=reasoning.encrypted", channel: "opaque" as const },
] as const;

export function classifyReasoningDetailType(type: string | undefined): ReasoningChannel | undefined {
  if (type === undefined || type === "") {
    return undefined;
  }
  const normalized = type.trim().toLowerCase();
  if (
    normalized === "reasoning.summary" ||
    normalized === "summary" ||
    normalized === "summary_text" ||
    normalized.endsWith(".summary")
  ) {
    return "summary";
  }
  if (
    normalized === "reasoning.text" ||
    normalized === "reasoning_text" ||
    normalized === "text" ||
    normalized === "thinking" ||
    normalized === "reasoning" ||
    normalized.endsWith(".text")
  ) {
    return "raw";
  }
  if (
    normalized === "reasoning.encrypted" ||
    normalized === "encrypted" ||
    normalized === "redacted_thinking" ||
    normalized.endsWith(".encrypted")
  ) {
    return "opaque";
  }
  return undefined;
}

export function joinReasoningTexts(parts: readonly ClassifiedReasoningPart[]): string {
  return parts
    .map((part) => part.text?.trim() ?? "")
    .filter((text) => text !== "")
    .join("\n\n");
}

/** Prefer summary for Anthropic / UI display; fall back to raw. */
export function selectDisplayReasoningText(classified: ClassifiedReasoning): string {
  if (classified.summaryText !== "") {
    return classified.summaryText;
  }
  return classified.rawText;
}

/** Chat flat field used for DeepSeek-style tool roundtrips: prefer raw, else summary. */
export function selectChatFlatReasoningText(classified: ClassifiedReasoning): string {
  if (classified.rawText !== "") {
    return classified.rawText;
  }
  return classified.summaryText;
}

export function classifyChatMessageReasoning(message: ChatMessage): ClassifiedReasoning {
  const summaryParts: ClassifiedReasoningPart[] = [];
  const rawParts: ClassifiedReasoningPart[] = [];
  const opaqueParts: ClassifiedReasoningPart[] = [];

  for (const item of message.reasoning_items ?? []) {
    pushChatReasoningItem(item, summaryParts, rawParts, opaqueParts);
  }

  for (const detail of message.reasoning_details ?? []) {
    pushChatReasoningDetail(detail, summaryParts, rawParts, opaqueParts);
  }

  const flatRaw = firstNonEmptyString(message.reasoning_content, message.reasoning);
  if (flatRaw !== undefined) {
    // Flat chat fields are full CoT unless structured details/items already carried the same text.
    if (!textAlreadyPresent(rawParts, flatRaw) && !textAlreadyPresent(summaryParts, flatRaw)) {
      rawParts.push({
        channel: "raw",
        text: flatRaw,
        source: "chat.reasoning_content|reasoning",
      });
    }
  }

  pushAssistantContentThinkingParts(message.content, rawParts);

  return finalizeClassified(summaryParts, rawParts, opaqueParts);
}

export function classifyResponsesReasoningItem(
  item: Pick<ResponsesOutput | ResponsesInputItem, "summary" | "content" | "encrypted_content" | "id">,
): ClassifiedReasoning {
  const summaryParts: ClassifiedReasoningPart[] = [];
  const rawParts: ClassifiedReasoningPart[] = [];
  const opaqueParts: ClassifiedReasoningPart[] = [];

  for (const summary of item.summary ?? []) {
    if (summary.type === "summary_text" && summary.text !== undefined && summary.text !== "") {
      summaryParts.push({
        channel: "summary",
        text: summary.text,
        id: item.id,
        source: "responses.summary",
      });
    }
  }

  for (const part of item.content ?? []) {
    if (
      (part.type === "reasoning_text" || part.type === "text") &&
      part.text !== undefined &&
      part.text !== ""
    ) {
      rawParts.push({
        channel: "raw",
        text: part.text,
        id: item.id,
        source: "responses.content",
      });
    }
  }

  if (item.encrypted_content !== undefined && item.encrypted_content !== "") {
    opaqueParts.push({
      channel: "opaque",
      data: item.encrypted_content,
      id: item.id,
      source: "responses.encrypted_content",
    });
  }

  return finalizeClassified(summaryParts, rawParts, opaqueParts);
}

export function classifiedToResponsesReasoningFields(classified: ClassifiedReasoning): {
  summary: ResponsesSummary[];
  content: ResponsesContentPart[];
  encrypted_content?: string;
} {
  const summary: ResponsesSummary[] = classified.summaryParts
    .map((part) => part.text?.trim() ?? "")
    .filter((text) => text !== "")
    .map((text) => ({ type: "summary_text", text }));

  const content: ResponsesContentPart[] = classified.rawParts
    .map((part) => part.text?.trim() ?? "")
    .filter((text) => text !== "")
    .map((text) => ({ type: "reasoning_text", text }));

  const encrypted = classified.opaqueParts.map((part) => part.data ?? "").find((data) => data !== "");

  return {
    summary,
    content,
    ...(encrypted !== undefined ? { encrypted_content: encrypted } : {}),
  };
}

export function classifiedToChatReasoningDetails(classified: ClassifiedReasoning): ChatReasoningDetail[] {
  const details: ChatReasoningDetail[] = [];
  let index = 0;
  for (const part of classified.summaryParts) {
    const text = part.text?.trim() ?? "";
    if (text === "") {
      continue;
    }
    details.push({
      type: "reasoning.summary",
      text,
      summary: text,
      index: part.index ?? index++,
      ...(part.id ? { id: part.id } : {}),
    });
  }
  for (const part of classified.rawParts) {
    const text = part.text?.trim() ?? "";
    if (text === "") {
      continue;
    }
    details.push({
      type: "reasoning.text",
      text,
      index: part.index ?? index++,
      ...(part.id ? { id: part.id } : {}),
      ...(part.signature ? { signature: part.signature } : {}),
    });
  }
  for (const part of classified.opaqueParts) {
    const data = part.data ?? "";
    if (data === "") {
      continue;
    }
    details.push({
      type: "reasoning.encrypted",
      data,
      index: part.index ?? index++,
      ...(part.id ? { id: part.id } : {}),
      ...(part.signature ? { signature: part.signature } : {}),
    });
  }
  return details;
}

export function makeResponsesReasoningItemFromTexts(input: {
  id?: string;
  summaryText?: string;
  rawText?: string;
  encryptedContent?: string;
}): ResponsesOutput {
  const summary: ResponsesSummary[] = [];
  const content: ResponsesContentPart[] = [];
  const summaryText = input.summaryText?.trim() ?? "";
  const rawText = input.rawText?.trim() ?? "";
  if (summaryText !== "") {
    summary.push({ type: "summary_text", text: summaryText });
  }
  if (rawText !== "") {
    content.push({ type: "reasoning_text", text: rawText });
  }
  const out: ResponsesOutput = {
    type: "reasoning",
    id: input.id,
    summary,
    ...(content.length > 0 ? { content } : {}),
  };
  if (input.encryptedContent !== undefined && input.encryptedContent !== "") {
    out.encrypted_content = input.encryptedContent;
  }
  return out;
}

function finalizeClassified(
  summaryParts: ClassifiedReasoningPart[],
  rawParts: ClassifiedReasoningPart[],
  opaqueParts: ClassifiedReasoningPart[],
): ClassifiedReasoning {
  return {
    summaryParts,
    rawParts,
    opaqueParts,
    summaryText: joinReasoningTexts(summaryParts),
    rawText: joinReasoningTexts(rawParts),
  };
}

function pushChatReasoningItem(
  item: ChatReasoningItem,
  summaryParts: ClassifiedReasoningPart[],
  rawParts: ClassifiedReasoningPart[],
  opaqueParts: ClassifiedReasoningPart[],
): void {
  for (const summary of item.summary ?? []) {
    if (summary.type === "summary_text" && summary.text !== undefined && summary.text !== "") {
      summaryParts.push({
        channel: "summary",
        text: summary.text,
        id: item.id,
        source: "chat.reasoning_items.summary",
      });
    }
  }
  for (const part of item.content ?? []) {
    if (
      (part.type === "reasoning_text" || part.type === "text") &&
      part.text !== undefined &&
      part.text !== ""
    ) {
      rawParts.push({
        channel: "raw",
        text: part.text,
        id: item.id,
        source: "chat.reasoning_items.content",
      });
    }
  }
  if (item.encrypted_content !== undefined && item.encrypted_content !== "") {
    opaqueParts.push({
      channel: "opaque",
      data: item.encrypted_content,
      id: item.id,
      source: "chat.reasoning_items.encrypted_content",
    });
  }
}

function pushChatReasoningDetail(
  detail: ChatReasoningDetail,
  summaryParts: ClassifiedReasoningPart[],
  rawParts: ClassifiedReasoningPart[],
  opaqueParts: ClassifiedReasoningPart[],
): void {
  const channel = classifyReasoningDetailType(detail.type) ?? inferDetailChannel(detail);
  const text = firstNonEmptyString(detail.text, detail.summary);
  const data = detail.data?.trim() ?? "";

  if (channel === "opaque" || (data !== "" && text === undefined)) {
    if (data !== "") {
      opaqueParts.push({
        channel: "opaque",
        data,
        signature: detail.signature,
        id: detail.id,
        index: detail.index,
        source: "chat.reasoning_details",
      });
    }
    return;
  }

  if (text === undefined) {
    return;
  }

  const part: ClassifiedReasoningPart = {
    channel,
    text,
    signature: detail.signature,
    id: detail.id,
    index: detail.index,
    source: "chat.reasoning_details",
  };
  if (channel === "summary") {
    summaryParts.push(part);
  } else {
    rawParts.push(part);
  }
}

function inferDetailChannel(detail: ChatReasoningDetail): ReasoningChannel {
  if ((detail.data ?? "").trim() !== "") {
    return "opaque";
  }
  if ((detail.summary ?? "").trim() !== "" && (detail.text ?? "").trim() === "") {
    return "summary";
  }
  return "raw";
}

function pushAssistantContentThinkingParts(raw: unknown, rawParts: ClassifiedReasoningPart[]): void {
  if (!Array.isArray(raw)) {
    return;
  }
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const part = entry as Record<string, unknown>;
    const typ = typeof part.type === "string" ? part.type : "";
    if (typ !== "thinking" && typ !== "reasoning") {
      continue;
    }
    const text = firstNonEmptyString(
      typeof part.thinking === "string" ? part.thinking : undefined,
      typeof part.text === "string" ? part.text : undefined,
    );
    if (text === undefined) {
      continue;
    }
    if (!textAlreadyPresent(rawParts, text)) {
      rawParts.push({
        channel: "raw",
        text,
        source: "chat.content.thinking|reasoning",
      });
    }
  }
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return undefined;
}

function textAlreadyPresent(parts: readonly ClassifiedReasoningPart[], text: string): boolean {
  const needle = text.trim();
  return parts.some((part) => (part.text?.trim() ?? "") === needle);
}
