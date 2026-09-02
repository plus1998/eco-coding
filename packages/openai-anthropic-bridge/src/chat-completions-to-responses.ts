import {
  defaultReasoningSummaryMode,
  isReasoningModel,
  minMaxOutputTokens,
} from "./anthropic-to-responses.js";
import { jsonMarshal, jsonParse } from "./json.js";
import type {
  ChatCompletionsRequest,
  ChatContentPart,
  ChatFunction,
  ChatMessage,
  ChatReasoningItem,
  ChatTool,
  ResponsesContentPart,
  ResponsesInputItem,
  ResponsesReasoning,
  ResponsesRequest,
  ResponsesTool,
} from "./types.js";

interface ChatMessageContent {
  text?: string;
  parts?: ChatContentPart[];
}

export function chatCompletionsToResponses(req: ChatCompletionsRequest): ResponsesRequest {
  const converted = convertChatMessagesToResponsesInput(req.messages);
  let input = converted.input;
  const instructions = mergeInstructions(req.instructions, converted.instructions);
  let responsesInstructions = instructions;
  if (input.length === 0 && instructions !== undefined && instructions !== "") {
    input = [
      {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: instructions }],
      },
    ];
    responsesInstructions = undefined;
  }

  const out: ResponsesRequest = {
    model: req.model,
    input,
    stream: req.stream ?? false,
    include: ["reasoning.encrypted_content"],
    service_tier: req.service_tier,
  };
  if (responsesInstructions !== undefined && responsesInstructions !== "") {
    out.instructions = responsesInstructions;
  }

  if (!isReasoningModel(req.model)) {
    out.temperature = req.temperature;
    out.top_p = req.top_p;
  }

  out.store = false;

  let maxTokens = 0;
  if (req.max_tokens !== undefined) {
    maxTokens = req.max_tokens;
  }
  if (req.max_completion_tokens !== undefined) {
    maxTokens = req.max_completion_tokens;
  }
  if (maxTokens > 0) {
    let v = maxTokens;
    if (v < minMaxOutputTokens) {
      v = minMaxOutputTokens;
    }
    out.max_output_tokens = v;
  }

  if (req.reasoning_effort !== undefined && req.reasoning_effort !== "") {
    out.reasoning = {
      effort: req.reasoning_effort,
    } satisfies ResponsesReasoning;
    out.reasoning.summary = defaultReasoningSummaryMode();
  }

  const tools = req.tools ?? [];
  const functions = req.functions ?? [];
  if (tools.length > 0 || functions.length > 0) {
    out.tools = convertChatToolsToResponses(tools, functions);
  }

  if (req.tool_choice !== undefined) {
    out.tool_choice = normalizeChatToolChoiceForResponses(req.tool_choice);
  } else if (req.function_call !== undefined) {
    out.tool_choice = convertChatFunctionCallToToolChoice(req.function_call);
  }

  return out;
}

function convertChatMessagesToResponsesInput(msgs: ChatMessage[]): {
  input: ResponsesInputItem[];
  instructions: string | undefined;
} {
  const input: ResponsesInputItem[] = [];
  const instructions: string[] = [];
  for (const m of msgs) {
    if (m.role === "system") {
      const systemInstruction = chatSystemInstruction(m);
      if (systemInstruction !== "") {
        instructions.push(systemInstruction);
        continue;
      }
    }
    input.push(...chatMessageToResponsesItems(m));
  }
  return {
    input,
    instructions: instructions.length > 0 ? instructions.join("\n") : undefined,
  };
}

function chatMessageToResponsesItems(m: ChatMessage): ResponsesInputItem[] {
  switch (m.role) {
    case "system":
      return chatSystemToResponses(m);
    case "user":
      return chatUserToResponses(m);
    case "assistant":
      return chatAssistantToResponses(m);
    case "tool":
      return chatToolToResponses(m);
    case "function":
      return chatFunctionToResponses(m);
    default:
      return chatUserToResponses(m);
  }
}

function chatSystemToResponses(m: ChatMessage): ResponsesInputItem[] {
  const parsed = parseChatMessageContent(m.content);
  const content = marshalChatInputContent(parsed);
  return [{ type: "message", role: "system", content }];
}

function chatUserToResponses(m: ChatMessage): ResponsesInputItem[] {
  const parsed = parseChatMessageContent(m.content);
  const content = marshalChatInputContent(parsed);
  return [{ type: "message", role: "user", content }];
}

function chatAssistantToResponses(m: ChatMessage): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];

  const reasoningItems = chatReasoningItemsToResponses(m);
  items.push(...reasoningItems);

  const contentReasoning = extractReasoningTextFromAssistantContent(m.content);
  if (contentReasoning !== "" && reasoningItems.length === 0) {
    items.push(makeReasoningInputItem(contentReasoning, items.length));
  }

  let content = "";
  if (m.content !== undefined) {
    const s = parseAssistantContent(m.content);
    if (s !== "") {
      content += s;
    }
  }

  if (content !== "") {
    const parts: ResponsesContentPart[] = [{ type: "output_text", text: content }];
    items.push({
      type: "message",
      role: "assistant",
      content: parts,
    });
  }

  for (const tc of m.tool_calls ?? []) {
    let args = tc.function.arguments;
    if (args === "") {
      args = "{}";
    }
    items.push({
      type: "function_call",
      call_id: tc.id,
      name: tc.function.name,
      arguments: args,
    });
  }

  return items;
}

function parseAssistantContent(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return "";
  }

  const serialized = typeof raw === "string" ? raw : jsonMarshal(raw);
  try {
    const parsed = jsonParse(serialized);
    if (typeof parsed === "string") {
      return parsed;
    }
    if (!Array.isArray(parsed)) {
      return "";
    }
    const parts = parsed as Record<string, unknown>[];
    let result = "";
    for (const p of parts) {
      const typ = typeof p.type === "string" ? p.type : "";
      const text = typeof p.text === "string" ? p.text : "";
      const thinking = typeof p.thinking === "string" ? p.thinking : "";

      switch (typ) {
        case "thinking":
        case "reasoning":
          break;
        default:
          if (text !== "") {
            result += text;
          }
      }
    }
    return result;
  } catch {
    return typeof raw === "string" ? raw : "";
  }
}

function chatToolToResponses(m: ChatMessage): ResponsesInputItem[] {
  return [
    {
      type: "function_call_output",
      call_id: m.tool_call_id ?? "",
      output: chatToolOutputToResponses(m.content),
    },
  ];
}

function chatFunctionToResponses(m: ChatMessage): ResponsesInputItem[] {
  return [
    {
      type: "function_call_output",
      call_id: m.name ?? "",
      output: chatToolOutputToResponses(m.content),
    },
  ];
}

function chatToolOutputToResponses(raw: unknown): unknown {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (typeof raw === "string") {
    return [{ type: "input_text", text: raw }];
  }
  if (Array.isArray(raw)) {
    return convertChatContentPartsToResponses(raw as ChatContentPart[]);
  }
  return [{ type: "input_text", text: String(raw) }];
}

function parseChatContent(raw: unknown): string {
  const parsed = parseChatMessageContent(raw);
  if (parsed.text !== undefined) {
    return parsed.text;
  }
  return flattenChatContentParts(parsed.parts ?? []);
}

function parseChatMessageContent(raw: unknown): ChatMessageContent {
  if (raw === undefined || raw === null) {
    return { text: "" };
  }

  if (typeof raw === "string") {
    try {
      const parsed = jsonParse(raw);
      if (typeof parsed === "string") {
        return { text: parsed };
      }
      if (Array.isArray(parsed)) {
        return { parts: parsed as unknown as ChatContentPart[] };
      }
    } catch {
      return { text: raw };
    }
    return { text: raw };
  }

  if (Array.isArray(raw)) {
    return { parts: raw as ChatContentPart[] };
  }

  throw new Error("parse content as string or parts array");
}

function marshalChatInputContent(content: ChatMessageContent): unknown {
  if (content.text !== undefined) {
    if (content.text === "") {
      return [];
    }
    return [{ type: "input_text", text: content.text }];
  }
  const parts = convertChatContentPartsToResponses(content.parts ?? []);
  if (parts.length === 0) {
    return [];
  }
  return parts;
}

function convertChatContentPartsToResponses(parts: ChatContentPart[]): ResponsesContentPart[] {
  const responseParts: ResponsesContentPart[] = [];
  for (const p of parts) {
    switch (p.type) {
      case "text":
        if (p.text !== "") {
          responseParts.push({ type: "input_text", text: p.text });
        }
        break;
      case "image_url":
        if (p.image_url !== undefined && p.image_url.url !== "" && !isEmptyBase64DataUri(p.image_url.url)) {
          responseParts.push({
            type: "input_image",
            image_url: p.image_url.url,
            detail: p.image_url.detail ?? "auto",
          });
        }
        break;
    }
  }
  return responseParts;
}

function isEmptyBase64DataUri(raw: string): boolean {
  if (!raw.startsWith("data:")) {
    return false;
  }
  let rest = raw.slice(5);
  const semicolonIdx = rest.indexOf(";");
  if (semicolonIdx < 0) {
    return false;
  }
  rest = rest.slice(semicolonIdx + 1);
  if (!rest.startsWith("base64,")) {
    return false;
  }
  const payload = rest.slice(7).trim();
  return payload === "";
}

function flattenChatContentParts(parts: ChatContentPart[]): string {
  const textParts: string[] = [];
  for (const p of parts) {
    if (p.type === "text" && p.text !== "") {
      textParts.push(p.text ?? "");
    }
  }
  return textParts.join("");
}

function convertChatToolsToResponses(tools: ChatTool[], functions: ChatFunction[]): ResponsesTool[] {
  const out: ResponsesTool[] = [];

  for (const t of tools) {
    if (t.type !== "function" || t.function === undefined) {
      continue;
    }
    out.push({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
      strict: t.function.strict,
    });
  }

  for (const f of functions) {
    out.push({
      type: "function",
      name: f.name,
      description: f.description,
      parameters: f.parameters,
      strict: f.strict,
    });
  }

  return out;
}

function convertChatFunctionCallToToolChoice(raw: unknown): unknown {
  const serialized = typeof raw === "string" ? raw : jsonMarshal(raw);
  try {
    const parsed = jsonParse(serialized);
    if (typeof parsed === "string") {
      return parsed;
    }
    const obj = parsed as { name?: string };
    return {
      type: "function",
      name: obj.name,
    };
  } catch (e) {
    throw new Error(`convert function_call: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function mergeInstructions(
  explicit: string | undefined,
  fromMessages: string | undefined,
): string | undefined {
  const parts = [explicit, fromMessages].map((part) => part?.trim() ?? "").filter((part) => part !== "");
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function chatSystemInstruction(m: ChatMessage): string {
  if (typeof m.content !== "string") {
    return "";
  }
  try {
    const parsed = jsonParse(m.content);
    return typeof parsed === "string" ? parsed : "";
  } catch {
    return m.content;
  }
}

function chatReasoningItemsToResponses(m: ChatMessage): ResponsesInputItem[] {
  const items: ResponsesInputItem[] = [];
  for (const item of m.reasoning_items ?? []) {
    const converted = chatReasoningItemToResponsesInput(item, items.length);
    if (converted !== undefined) {
      items.push(converted);
    }
  }
  if (items.length > 0) {
    return items;
  }
  const text = chatMessageReasoningText(m);
  if (text === "") {
    return [];
  }
  return [makeReasoningInputItem(text, 0)];
}

function chatReasoningItemToResponsesInput(
  item: ChatReasoningItem,
  index: number,
): ResponsesInputItem | undefined {
  const out: ResponsesInputItem = {
    type: "reasoning",
    id: item.id ?? `rs_${index}`,
    summary: item.summary ?? [],
  };
  if (item.encrypted_content !== undefined && item.encrypted_content !== "") {
    out.encrypted_content = item.encrypted_content;
  }
  if ((out.summary?.length ?? 0) === 0 && out.encrypted_content === undefined) {
    return undefined;
  }
  return out;
}

function chatMessageReasoningText(m: ChatMessage): string {
  if ((m.reasoning_content ?? "").trim() !== "") {
    return m.reasoning_content!.trim();
  }
  if ((m.reasoning ?? "").trim() !== "") {
    return m.reasoning!.trim();
  }
  const parts: string[] = [];
  for (const detail of m.reasoning_details ?? []) {
    const text = detail.text?.trim() ?? "";
    if (text !== "") {
      parts.push(text);
    }
  }
  return parts.join("\n\n");
}

function makeReasoningInputItem(text: string, index: number): ResponsesInputItem {
  return {
    type: "reasoning",
    id: `rs_${index}`,
    summary: [{ type: "summary_text", text }],
  };
}

function extractReasoningTextFromAssistantContent(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return "";
  }
  const serialized = typeof raw === "string" ? raw : jsonMarshal(raw);
  try {
    const parsed = jsonParse(serialized);
    if (!Array.isArray(parsed)) {
      return "";
    }
    const parts = parsed as Record<string, unknown>[];
    const out: string[] = [];
    for (const p of parts) {
      const typ = typeof p.type === "string" ? p.type : "";
      if (typ !== "thinking" && typ !== "reasoning") {
        continue;
      }
      const thinking = typeof p.thinking === "string" ? p.thinking : "";
      const text = typeof p.text === "string" ? p.text : "";
      if (thinking !== "") {
        out.push(thinking);
      } else if (text !== "") {
        out.push(text);
      }
    }
    return out.join("\n\n");
  } catch {
    return "";
  }
}

function normalizeChatToolChoiceForResponses(raw: unknown): unknown {
  if (typeof raw === "string") {
    return raw;
  }
  const serialized = jsonMarshal(raw);
  try {
    const parsed = jsonParse(serialized) as {
      type?: string;
      name?: string;
      function?: { name?: string };
    };
    if (parsed?.type !== "function") {
      return raw;
    }
    const name = (parsed.name ?? parsed.function?.name ?? "").trim();
    if (name === "") {
      return raw;
    }
    return { type: "function", name };
  } catch {
    return raw;
  }
}
