import { generateItemId, generateResponsesId } from './anthropic-to-responses-response.js';
import {
  CUSTOM_TOOL_INPUT_FIELD,
  chatErrorToResponseError,
  customToolInputFromChatArguments,
  responseIdFromChatId,
  TOOL_SEARCH_PROXY_NAME,
} from './codex-chat-common.js';
import {
  buildCodexToolContextFromRequest,
  lookupChatName,
  type CodexToolContext,
} from './codex-tool-context.js';
import { bytesTrimSpace, jsonMarshal, jsonParse } from './json.js';
import type {
  ChatCompletionsChunk,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatContentPart,
  ChatFunction,
  ChatImageURL,
  ChatMessage,
  ChatReasoningItem,
  ChatTool,
  ChatToolCall,
  ChatUsage,
  ResponsesContentPart,
  ResponsesIncompleteDetails,
  ResponsesInputTokensDetails,
  ResponsesOutput,
  ResponsesRequest,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesSummary,
  ResponsesTool,
  ResponsesUsage,
} from './types.js';

export {
  buildCodexToolContextFromRequest,
  chatErrorToResponseError,
  type CodexToolContext,
};

// ---------------------------------------------------------------------------
// ResponsesRequest → ChatCompletionsRequest
// ---------------------------------------------------------------------------

export function responsesToChatCompletionsRequest(
  req: ResponsesRequest | null | undefined,
): ChatCompletionsRequest {
  if (req === null || req === undefined) {
    throw new Error('responses request is nil');
  }

  const toolContext = buildCodexToolContextFromRequest(req);
  const messages = responsesInputToChatMessages(
    req.instructions ?? '',
    req.input,
  );

  const out: ChatCompletionsRequest = {
    model: req.model,
    messages,
  };
  if (req.max_output_tokens !== undefined) {
    // Legacy OpenAI-compat servers (e.g. llama.cpp before max_completion_tokens) read max_tokens only.
    out.max_tokens = req.max_output_tokens;
    out.max_completion_tokens = req.max_output_tokens;
  }
  if (req.temperature !== undefined) {
    out.temperature = req.temperature;
  }
  if (req.top_p !== undefined) {
    out.top_p = req.top_p;
  }
  if (req.stream !== undefined) {
    out.stream = req.stream;
  }
  if (out.stream === true) {
    out.stream_options = { include_usage: true };
  }
  if (req.service_tier !== undefined) {
    out.service_tier = req.service_tier;
  }

  if (req.reasoning != null) {
    out.reasoning_effort = req.reasoning.effort;
  }
  if (toolContext.chatTools.length > 0) {
    out.tools = toolContext.chatTools;
  }
  if (req.tool_choice !== undefined && req.tool_choice !== null) {
    out.tool_choice = responsesToolChoiceToChatToolChoice(req.tool_choice);
  }

  return out;
}

function responsesInputToChatMessages(
  instructions: string,
  inputRaw: unknown,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (bytesTrimSpace(instructions) !== '') {
    messages.push({
      role: 'system',
      content: instructions,
    });
  }

  const inputStr = inputToRawJson(inputRaw);
  const trimmedInput = bytesTrimSpace(inputStr);
  if (trimmedInput === '' || trimmedInput === 'null') {
    return messages;
  }

  try {
    const inputText = jsonParse(trimmedInput);
    if (typeof inputText === 'string') {
      messages.push({
        role: 'user',
        content: inputText,
      });
      return messages;
    }
  } catch {
    /* not a bare string */
  }

  let rawItems: string[];
  try {
    const parsed = jsonParse(trimmedInput);
    if (!Array.isArray(parsed)) {
      throw new Error('not an array');
    }
    rawItems = parsed.map((item) =>
      typeof item === 'string' ? item : jsonMarshal(item),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`parse responses input: ${msg}`);
  }

  const built = buildChatMessagesFromItems(messages, rawItems);
  return normalizeChatMessages(built);
}

function inputToRawJson(input: unknown): string {
  if (input === undefined || input === null) {
    return '';
  }
  if (typeof input === 'string') {
    return input;
  }
  return jsonMarshal(input);
}

function buildChatMessagesFromItems(
  messages: ChatMessage[],
  rawItems: string[],
): ChatMessage[] {
  let pendingReasoning = '';
  let pendingReasoningItem: ChatReasoningItem | undefined;

  for (let raw of rawItems) {
    raw = bytesTrimSpace(raw);
    if (raw === '' || raw === 'null') {
      continue;
    }

    const item = parseRawItemMap(raw);
    if (item === null) {
      try {
        const text = jsonParse(raw) as string;
        if (typeof text === 'string') {
          messages.push({
            role: 'user',
            content: text,
          });
          pendingReasoning = '';
          continue;
        }
      } catch {
        /* fall through */
      }
      throw new Error('parse responses input item');
    }

    const role = chatCompletionsBridgeRole(rawString(item.role));
    const itemType = rawString(item.type);

    switch (itemType) {
      case 'reasoning': {
        const txt = extractResponsesReasoningText(item);
        if (txt !== '') {
          pendingReasoning = txt;
        }
        pendingReasoningItem = responsesInputReasoningItemToChat(item);
        continue;
      }
      case 'function_call': {
        let arguments_ = rawStringOrJson(item.arguments);
        if (bytesTrimSpace(arguments_) === '') {
          arguments_ = '{}';
        }
        const toolCall: ChatToolCall = {
          id: rawString(item.call_id),
          type: 'function',
          function: {
            name: rawString(item.name),
            arguments: arguments_,
          },
        };
        const n = messages.length;
        if (n > 0 && messages[n - 1]!.role === 'assistant') {
          const last = messages[n - 1]!;
          last.tool_calls = [...(last.tool_calls ?? []), toolCall];
          if ((last.reasoning_content ?? '') === '') {
            last.reasoning_content = pendingReasoning;
          }
          if (pendingReasoningItem !== undefined && (last.reasoning_items?.length ?? 0) === 0) {
            last.reasoning_items = [pendingReasoningItem];
          }
        } else {
          const assistant: ChatMessage = {
            role: 'assistant',
            tool_calls: [toolCall],
            reasoning_content: pendingReasoning,
          };
          if (pendingReasoningItem !== undefined) {
            assistant.reasoning_items = [pendingReasoningItem];
          }
          messages.push(assistant);
        }
        pendingReasoning = '';
        pendingReasoningItem = undefined;
        continue;
      }
      case 'function_call_output':
        messages.push({
          role: 'tool',
          tool_call_id: rawString(item.call_id),
          content: responsesFunctionCallOutputToChatContent(item.output),
        });
        pendingReasoning = '';
        pendingReasoningItem = undefined;
        continue;
      case 'input_text':
      case 'text':
        messages.push({
          role: 'user',
          content: rawString(item.text),
        });
        pendingReasoning = '';
        pendingReasoningItem = undefined;
        continue;
      case 'input_image': {
        const content = chatContentFromSingleResponsesPart(itemType, item);
        messages.push({ role: 'user', content });
        pendingReasoning = '';
        pendingReasoningItem = undefined;
        continue;
      }
    }

    if (itemType !== '' && itemType !== 'message') {
      pendingReasoning = '';
      pendingReasoningItem = undefined;
      continue;
    }

    let content = item.content;
    if (bytesTrimSpace(content ?? '') === '') {
      const text = rawString(item.text);
      if (text !== '') {
        content = text;
      }
    }
    const chatContent = responsesContentToChatContent(content, role);
    const message: ChatMessage = { role, content: chatContent };
    if (role === 'assistant') {
      if (pendingReasoning !== '') {
        message.reasoning_content = pendingReasoning;
      }
      if (pendingReasoningItem !== undefined) {
        message.reasoning_items = [pendingReasoningItem];
      }
    }
    messages.push(message);
    if (role !== 'assistant') {
      pendingReasoning = '';
      pendingReasoningItem = undefined;
    } else {
      pendingReasoning = '';
      pendingReasoningItem = undefined;
    }
  }

  return messages;
}

function responsesInputReasoningItemToChat(
  item: Record<string, string>,
): ChatReasoningItem | undefined {
  const summary: ResponsesSummary[] = [];
  const summaryRaw = bytesTrimSpace(item.summary ?? '');
  if (summaryRaw !== '' && summaryRaw !== 'null') {
    try {
      const parsed = jsonParse(summaryRaw) as unknown[];
      if (Array.isArray(parsed)) {
        for (const part of parsed) {
          if (part !== null && typeof part === 'object' && !Array.isArray(part)) {
            const summaryPart = part as ResponsesSummary;
            if (summaryPart.text !== undefined && summaryPart.text !== '') {
              summary.push({
                type: summaryPart.type ?? 'summary_text',
                text: summaryPart.text,
              });
            }
          }
        }
      }
    } catch {
      /* not a summary array */
    }
  }

  const encryptedContent = rawString(item.encrypted_content);
  const id = rawString(item.id);
  if (summary.length === 0 && encryptedContent === '') {
    return undefined;
  }
  const out: ChatReasoningItem = {
    type: 'reasoning',
    summary,
  };
  if (id !== '') {
    out.id = id;
  }
  if (encryptedContent !== '') {
    out.encrypted_content = encryptedContent;
  }
  return out;
}

function responsesFunctionCallOutputToChatContent(raw: string | undefined): unknown {
  const trimmed = bytesTrimSpace(raw ?? '');
  if (trimmed === '' || trimmed === 'null') {
    return '';
  }
  try {
    const parsed = jsonParse(trimmed);
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (Array.isArray(parsed)) {
      return responsesContentPartsToChatContent(parsed, 'tool');
    }
  } catch {
    /* rawString below handles JSON string literals */
  }
  return rawString(raw);
}

/** Match sub2api json.RawMessage: quote scalars, keep embedded JSON text as-is. */
function encodeRawItemFieldValue(v: unknown): string {
  if (typeof v === 'string') {
    const trimmed = bytesTrimSpace(v);
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return trimmed;
    }
    return jsonMarshal(v);
  }
  return jsonMarshal(v);
}

function parseRawItemMap(raw: string): Record<string, string> | null {
  const trimmed = bytesTrimSpace(raw);
  if (trimmed === '' || trimmed === 'null') {
    return null;
  }
  try {
    const obj = jsonParse(trimmed) as Record<string, unknown>;
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) {
        continue;
      }
      out[k] = encodeRawItemFieldValue(v);
    }
    return out;
  } catch {
    return null;
  }
}

function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const replies = new Map<string, ChatMessage>();
  for (const m of messages) {
    if (m.role === 'tool' && (m.tool_call_id ?? '') !== '') {
      replies.set(m.tool_call_id!, m);
    }
  }

  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      if ((m.tool_call_id ?? '') === '') {
        out.push(m);
      }
      continue;
    }

    const toolCalls = m.tool_calls ?? [];
    if (toolCalls.length > 0) {
      const kept: ChatToolCall[] = [];
      for (const tc of toolCalls) {
        if ((tc.id ?? '') === '') {
          continue;
        }
        if (replies.has(tc.id!)) {
          kept.push(tc);
        }
      }
      if (kept.length === 0) {
        if (isBlankChatContent(m.content)) {
          continue;
        }
        const { tool_calls: _dropped, ...plain } = m;
        out.push(plain);
        continue;
      }
      const assistant: ChatMessage = { ...m, tool_calls: kept };
      out.push(assistant);
      for (const tc of kept) {
        out.push(replies.get(tc.id!)!);
      }
      continue;
    }

    out.push(m);
  }
  return out;
}

function isBlankChatContent(raw: unknown): boolean {
  const s = contentToRawString(raw);
  const trimmed = bytesTrimSpace(s);
  if (trimmed === '' || trimmed === 'null' || trimmed === '""') {
    return true;
  }
  return chatMessageContentText(raw) === '';
}

function contentToRawString(raw: unknown): string {
  if (raw === undefined || raw === null) {
    return '';
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return jsonMarshal(raw);
}

function extractResponsesReasoningText(
  item: Record<string, string>,
): string {
  const parts: string[] = [];
  const collect = (raw: string | undefined) => {
    const trimmed = bytesTrimSpace(raw ?? '');
    if (trimmed === '' || trimmed === 'null') {
      return;
    }
    try {
      const arr = jsonParse(trimmed) as unknown[];
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const part =
            typeof p === 'string'
              ? parseRawItemMap(p)
              : p !== null && typeof p === 'object'
                ? parseRawItemMap(jsonMarshal(p))
                : null;
          const t = part !== null ? rawString(part.text) : '';
          if (t !== '') {
            parts.push(t);
          }
        }
        return;
      }
    } catch {
      /* not array */
    }
    const t = rawString(trimmed);
    if (t !== '') {
      parts.push(t);
    }
  };
  collect(item.summary);
  if (parts.length === 0) {
    collect(item.content);
  }
  return parts.join('\n');
}

function chatCompletionsBridgeRole(role: string): string {
  const trimmed = bytesTrimSpace(role);
  if (trimmed === '') {
    return 'user';
  }
  if (trimmed.toLowerCase() === 'developer') {
    return 'system';
  }
  return role;
}

function responsesContentToChatContent(
  raw: string | undefined,
  role: string,
): unknown {
  const trimmed = bytesTrimSpace(raw ?? '');
  if (trimmed === '' || trimmed === 'null') {
    return '';
  }

  try {
    const text = jsonParse(trimmed);
    if (typeof text === 'string') {
      return text;
    }
  } catch {
    /* not plain string */
  }

  try {
    const rawParts = jsonParse(trimmed) as unknown[];
    if (Array.isArray(rawParts)) {
      return responsesContentPartsToChatContent(rawParts, role);
    }
  } catch {
    /* not array */
  }

  try {
    const obj = jsonParse(trimmed) as Record<string, string>;
    if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
      return chatContentFromSingleResponsesPart(rawString(obj.type), obj);
    }
  } catch {
    /* fall through */
  }

  return trimmed;
}

function parseResponsesContentPart(rawPart: unknown): Record<string, string> | null {
  if (typeof rawPart === 'string') {
    try {
      return jsonParse(bytesTrimSpace(rawPart)) as Record<string, string>;
    } catch {
      return null;
    }
  }
  if (rawPart !== null && typeof rawPart === 'object' && !Array.isArray(rawPart)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawPart as Record<string, unknown>)) {
      if (v === undefined) {
        continue;
      }
      out[k] = encodeRawItemFieldValue(v);
    }
    return out;
  }
  return null;
}

function responsesContentPartsToChatContent(
  rawParts: unknown[],
  role: string,
): unknown {
  const textParts: string[] = [];
  const chatParts: ChatContentPart[] = [];
  let hasNonText = false;

  for (const rawPart of rawParts) {
    const part = parseResponsesContentPart(rawPart);
    if (part === null) {
      continue;
    }
    const partType = rawString(part.type);
    switch (partType) {
      case 'input_text':
      case 'output_text':
      case 'text':
      case '': {
        const text = rawString(part.text);
        if (text === '') {
          continue;
        }
        textParts.push(text);
        chatParts.push({ type: 'text', text });
        break;
      }
      case 'input_image':
      case 'image_url': {
        let imageURL = rawString(part.image_url);
        if (imageURL === '') {
          imageURL = rawNestedString(part.image_url, 'url');
        }
        if (imageURL === '') {
          continue;
        }
        const detail = rawString(part.detail);
        hasNonText = true;
        chatParts.push({
          type: 'image_url',
          image_url: {
            url: imageURL,
            ...(detail !== '' && { detail }),
          } satisfies ChatImageURL,
        });
        break;
      }
    }
  }

  if (!hasNonText) {
    return role === 'tool' ? textParts.join('') : textParts.join('\n\n');
  }
  if (role !== 'user' && role !== 'tool') {
    return textParts.join('\n\n');
  }
  if (chatParts.length === 0) {
    return '';
  }
  return chatParts;
}

function chatContentFromSingleResponsesPart(
  partType: string,
  part: Record<string, string>,
): unknown {
  switch (partType) {
    case 'input_image':
    case 'image_url': {
      let imageURL = rawString(part.image_url);
      if (imageURL === '') {
        imageURL = rawNestedString(part.image_url, 'url');
      }
      const detail = rawString(part.detail);
      return [
        {
          type: 'image_url',
          image_url: {
            url: imageURL,
            ...(detail !== '' && { detail }),
          },
        } satisfies ChatContentPart,
      ];
    }
    default:
      return rawString(part.text);
  }
}

function responsesToolsToChatTools(tools: ResponsesTool[]): ChatTool[] {
  const out: ChatTool[] = [];
  for (const tool of tools) {
    if (tool.type !== 'function') {
      continue;
    }
    const fn: ChatFunction = { name: tool.name ?? '' };
    if (tool.description !== undefined) {
      fn.description = tool.description;
    }
    if (tool.parameters !== undefined) {
      fn.parameters = tool.parameters;
    }
    if (tool.strict !== undefined) {
      fn.strict = tool.strict;
    }
    out.push({ type: 'function', function: fn });
  }
  return out;
}

function responsesToolChoiceToChatToolChoice(raw: unknown): unknown {
  let choice: Record<string, unknown>;
  try {
    const parsed = typeof raw === 'string' ? jsonParse(raw) : raw;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return raw;
    }
    choice = parsed as Record<string, unknown>;
  } catch {
    return raw;
  }
  if (choice.type !== 'function') {
    return raw;
  }
  let name = typeof choice.name === 'string' ? choice.name.trim() : '';
  if (name === '' && choice.function !== null && typeof choice.function === 'object') {
    const fn = choice.function as Record<string, unknown>;
    name = typeof fn.name === 'string' ? fn.name.trim() : '';
  }
  if (name === '') {
    return raw;
  }
  return { type: 'function', function: { name } };
}

// ---------------------------------------------------------------------------
// ChatCompletionsResponse → ResponsesResponse
// ---------------------------------------------------------------------------

export function chatCompletionsResponseToResponses(
  resp: ChatCompletionsResponse | null | undefined,
  model: string,
  toolContext = buildCodexToolContextFromRequest(undefined),
  normalizeResponseId = false,
): ResponsesResponse {
  let id = '';
  if (resp !== null && resp !== undefined) {
    id = resp.id;
  }
  if (id === '') {
    id = generateResponsesId();
  }

  const out: ResponsesResponse = {
    id: normalizeResponseId ? responseIdFromChatId(id) : id,
    object: 'response',
    model,
    status: 'completed',
  };

  if (resp === null || resp === undefined) {
    out.output = [emptyResponsesMessageOutput()];
    return out;
  }
  if (out.model === '') {
    out.model = resp.model;
  }

  if (resp.choices.length > 0) {
    const choice = resp.choices[0]!;
    out.output = chatMessageToResponsesOutput(choice.message, toolContext);
    if (choice.finish_reason === 'length') {
      out.status = 'incomplete';
      out.incomplete_details = {
        reason: 'max_output_tokens',
      } satisfies ResponsesIncompleteDetails;
    }
  }
  if ((out.output?.length ?? 0) === 0) {
    out.output = [emptyResponsesMessageOutput()];
  }
  const usage = chatUsageToResponsesUsage(resp.usage);
  if (usage !== undefined) {
    out.usage = usage;
  }
  return out;
}

function chatMessageReasoningText(message: ChatMessage): string {
  if ((message.reasoning_content ?? '').trim() !== '') {
    return message.reasoning_content!.trim();
  }
  if ((message.reasoning ?? '').trim() !== '') {
    return message.reasoning!.trim();
  }
  const parts: string[] = [];
  for (const detail of message.reasoning_details ?? []) {
    const text = detail.text?.trim() ?? '';
    if (text !== '') {
      parts.push(text);
    }
  }
  return parts.join('\n\n');
}

function chatMessageToResponsesOutput(
  message: ChatMessage,
  toolContext: CodexToolContext,
): ResponsesOutput[] {
  const outputs: ResponsesOutput[] = [];
  const reasoningItems = chatReasoningItemsToResponsesOutput(message);
  if (reasoningItems.length > 0) {
    outputs.push(...reasoningItems);
  } else {
    const reasoningText = chatMessageReasoningText(message);
    if (reasoningText !== '') {
      outputs.push({
        type: 'reasoning',
        id: generateItemId(),
        summary: [
          {
            type: 'summary_text',
            text: reasoningText,
          } satisfies ResponsesSummary,
        ],
      });
    }
  }

  const text = chatMessageContentText(message.content);
  if (text !== '' || (message.tool_calls?.length ?? 0) === 0) {
    outputs.push({
      type: 'message',
      id: generateItemId(),
      role: 'assistant',
      content: [{ type: 'output_text', text } satisfies ResponsesContentPart],
      status: 'completed',
    });
  }

  for (const toolCall of message.tool_calls ?? []) {
    let arguments_ = toolCall.function.arguments ?? '';
    if (bytesTrimSpace(arguments_) === '') {
      arguments_ = '{}';
    }
    outputs.push(chatToolCallToResponsesOutput(toolCall, arguments_, toolContext));
  }

  return outputs;
}

function chatReasoningItemsToResponsesOutput(message: ChatMessage): ResponsesOutput[] {
  const out: ResponsesOutput[] = [];
  for (const item of message.reasoning_items ?? []) {
    const summary = item.summary ?? [];
    if (summary.length === 0 && (item.encrypted_content ?? '') === '') {
      continue;
    }
    out.push({
      type: 'reasoning',
      id: item.id ?? generateItemId(),
      encrypted_content: item.encrypted_content,
      summary,
    });
  }
  return out;
}

function chatToolCallToResponsesOutput(
  toolCall: ChatToolCall,
  arguments_: string,
  toolContext: CodexToolContext,
  id = generateItemId(),
): ResponsesOutput {
  const chatName = toolCall.function.name;
  const spec = lookupChatName(toolContext, chatName);
  const common = {
    id,
    call_id: toolCall.id ?? '',
    status: 'completed',
  };
  if (spec?.kind === 'custom') {
    return {
      ...common,
      type: 'custom_tool_call',
      name: spec.name,
      input: customToolInputFromChatArguments(arguments_),
    };
  }
  if (spec?.kind === 'tool_search' || chatName === TOOL_SEARCH_PROXY_NAME) {
    return {
      ...common,
      type: 'tool_search_call',
      execution: 'client',
      arguments: arguments_,
    };
  }
  return {
    ...common,
    type: 'function_call',
    name: spec?.name ?? chatName,
    ...(spec?.namespace ? { namespace: spec.namespace } : {}),
    arguments: arguments_,
  };
}

function emptyResponsesMessageOutput(): ResponsesOutput {
  return {
    type: 'message',
    id: generateItemId(),
    role: 'assistant',
    content: [{ type: 'output_text', text: '' }],
    status: 'completed',
  };
}

function chatMessageContentText(raw: unknown): string {
  if (Array.isArray(raw)) {
    const texts: string[] = [];
    for (const part of raw) {
      if (part !== null && typeof part === 'object' && !Array.isArray(part)) {
        const text = (part as ChatContentPart).text;
        if (typeof text === 'string' && text !== '') {
          texts.push(text);
        }
      }
    }
    if (texts.length > 0) {
      return texts.join('\n\n');
    }
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const text = (raw as ChatContentPart).text;
    if (typeof text === 'string') {
      return bytesTrimSpace(text);
    }
  }

  const s = contentToRawString(raw);
  const trimmed = bytesTrimSpace(s);
  if (trimmed === '' || trimmed === 'null') {
    return '';
  }
  try {
    const text = jsonParse(trimmed);
    if (typeof text === 'string') {
      return text;
    }
  } catch {
    /* not string */
  }
  try {
    const parts = jsonParse(trimmed) as ChatContentPart[];
    if (Array.isArray(parts)) {
      const texts: string[] = [];
      for (const part of parts) {
        if (part.type === 'text' && (part.text ?? '') !== '') {
          texts.push(part.text!);
        }
      }
      return texts.join('\n\n');
    }
  } catch {
    /* not parts */
  }
  return trimmed;
}

export function chatUsageToResponsesUsage(
  usage: ChatUsage | null | undefined,
): ResponsesUsage | undefined {
  if (usage === null || usage === undefined) {
    return undefined;
  }
  const out: ResponsesUsage = {
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
  };
  if (out.total_tokens === 0) {
    out.total_tokens = out.input_tokens + out.output_tokens;
  }
  if (
    usage.prompt_tokens_details != null &&
    (usage.prompt_tokens_details.cached_tokens ?? 0) > 0
  ) {
    out.input_tokens_details = {
      cached_tokens: usage.prompt_tokens_details.cached_tokens!,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chat Completions SSE → Responses SSE (stateful)
// ---------------------------------------------------------------------------

export interface ChatCompletionsToResponsesStreamState {
  responseId: string;
  model: string;
  created: number;
  sequenceNumber: number;
  createdSent: boolean;
  completedSent: boolean;
  failedSent: boolean;
  nextOutputIndex: number;
  reasoningItemId: string;
  reasoningIndex: number;
  reasoningOpen: boolean;
  reasoningDone: boolean;
  messageItemId: string;
  messageIndex: number;
  textPartOpen: boolean;
  text: string;
  reasoning: string;
  toolCalls: Map<number, ChatToolCall>;
  toolItemIds: Map<number, string>;
  toolOutputIndex: Map<number, number>;
  finishReason: string;
  usage: ResponsesUsage | undefined;
  toolContext: CodexToolContext;
  normalizeResponseId: boolean;
}

export function newChatCompletionsToResponsesStreamState(
  model: string,
  toolContext = buildCodexToolContextFromRequest(undefined),
  normalizeResponseId = false,
): ChatCompletionsToResponsesStreamState {
  return {
    responseId: generateResponsesId(),
    model,
    created: Math.floor(Date.now() / 1000),
    sequenceNumber: 0,
    createdSent: false,
    completedSent: false,
    failedSent: false,
    nextOutputIndex: 0,
    reasoningItemId: '',
    reasoningIndex: 0,
    reasoningOpen: false,
    reasoningDone: false,
    messageItemId: '',
    messageIndex: 0,
    textPartOpen: false,
    text: '',
    reasoning: '',
    toolCalls: new Map(),
    toolItemIds: new Map(),
    toolOutputIndex: new Map(),
    finishReason: '',
    usage: undefined,
    toolContext,
    normalizeResponseId,
  };
}

function allocOutputIndex(state: ChatCompletionsToResponsesStreamState): number {
  const idx = state.nextOutputIndex;
  state.nextOutputIndex++;
  return idx;
}

/** llama.cpp and some OpenAI-compat relays emit JSON null or the literal "null" for empty assistant text. */
function isUsableChatCompletionTextDelta(content: unknown): content is string {
  if (typeof content !== 'string' || content === '') {
    return false;
  }
  return content.trim() !== 'null';
}

export function chatCompletionsChunkToResponsesEvents(
  chunk: ChatCompletionsChunk | null | undefined,
  state: ChatCompletionsToResponsesStreamState | null | undefined,
): ResponsesStreamEvent[] {
  if (chunk === null || chunk === undefined || state === null || state === undefined) {
    return [];
  }
  if (chunk.id !== '') {
    state.responseId = state.normalizeResponseId ? responseIdFromChatId(chunk.id) : chunk.id;
  }
  if (state.model === '' && chunk.model !== '') {
    state.model = chunk.model;
  }
  if (chunk.usage !== undefined) {
    state.usage = chatUsageToResponsesUsage(chunk.usage);
  }

  const events: ResponsesStreamEvent[] = [];
  events.push(...ensureChatToResponsesCreated(state));

  for (const choice of chunk.choices) {
    const reasoning =
      choice.delta.reasoning_content ??
      (choice.delta.reasoning !== undefined && choice.delta.reasoning !== ''
        ? choice.delta.reasoning
        : undefined);
    if (reasoning !== undefined && reasoning !== '') {
      events.push(...ensureChatReasoningItem(state));
      state.reasoning += reasoning;
      events.push(
        chatToResponsesEvent(state, 'response.reasoning_summary_text.delta', {
          output_index: state.reasoningIndex,
          summary_index: 0,
          delta: reasoning,
          item_id: state.reasoningItemId,
        }),
      );
    }

    const content = choice.delta.content;
    if (isUsableChatCompletionTextDelta(content)) {
      events.push(...closeChatReasoningItem(state));
      events.push(...ensureChatToResponsesMessageItem(state));
      events.push(...ensureChatToResponsesTextPart(state));
      state.text += content;
      events.push(
        chatToResponsesEvent(state, 'response.output_text.delta', {
          output_index: state.messageIndex,
          content_index: 0,
          delta: content,
          item_id: state.messageItemId,
        }),
      );
    }

    for (const toolCall of choice.delta.tool_calls ?? []) {
      let idx = 0;
      if (toolCall.index !== undefined) {
        idx = toolCall.index;
      }

      let stored = state.toolCalls.get(idx);
      if (stored === undefined) {
        events.push(...closeChatReasoningItem(state));
        const copyCall: ChatToolCall = {
          ...toolCall,
          id: toolCall.id !== undefined && toolCall.id !== '' ? toolCall.id : generateItemId(),
          type: 'function',
          function: {
            name: toolCall.function.name ?? '',
            arguments: '',
          },
        };
        state.toolCalls.set(idx, copyCall);
        stored = copyCall;
        const itemID = generateItemId();
        state.toolItemIds.set(idx, itemID);
        state.toolOutputIndex.set(idx, allocOutputIndex(state));
        const outputIndex = state.toolOutputIndex.get(idx)!;
        const responseItem = chatToolCallToResponsesOutput(
          copyCall,
          '',
          state.toolContext,
          itemID,
        );
        responseItem.status = 'in_progress';
        events.push(
          chatToResponsesEvent(state, 'response.output_item.added', {
            output_index: outputIndex,
            item: responseItem,
          }),
        );
      } else {
        if (toolCall.id !== undefined && toolCall.id !== '') {
          stored.id = toolCall.id;
        }
        if (toolCall.function.name !== '') {
          stored.function.name = toolCall.function.name;
        }
      }

      const argsDelta = toolCall.function.arguments ?? '';
      if (argsDelta !== '') {
        stored.function.arguments = (stored.function.arguments ?? '') + argsDelta;
        const outputIndex = state.toolOutputIndex.get(idx)!;
        events.push(
          chatToResponsesEvent(state, 'response.function_call_arguments.delta', {
            output_index: outputIndex,
            item_id: state.toolItemIds.get(idx) ?? '',
            delta: argsDelta,
            call_id: stored.id ?? '',
            name: stored.function.name,
          }),
        );
      }
    }

    if (choice.finish_reason !== null && choice.finish_reason !== '') {
      state.finishReason = choice.finish_reason;
    }
  }

  return events;
}

export function finalizeChatCompletionsResponsesStream(
  state: ChatCompletionsToResponsesStreamState | null | undefined,
): ResponsesStreamEvent[] {
  if (state === null || state === undefined || state.completedSent || state.failedSent) {
    return [];
  }

  const events: ResponsesStreamEvent[] = [];
  events.push(...ensureChatToResponsesCreated(state));
  events.push(...closeChatReasoningItem(state));

  if (state.messageItemId !== '') {
    if (state.textPartOpen) {
      events.push(
        chatToResponsesEvent(state, 'response.output_text.done', {
          output_index: state.messageIndex,
          content_index: 0,
          text: state.text,
          item_id: state.messageItemId,
        }),
        chatToResponsesEvent(state, 'response.content_part.done', {
          output_index: state.messageIndex,
          content_index: 0,
          item_id: state.messageItemId,
          part: { type: 'output_text', text: state.text },
        }),
      );
    }
    events.push(
      chatToResponsesEvent(state, 'response.output_item.done', {
        output_index: state.messageIndex,
        item: {
          type: 'message',
          id: state.messageItemId,
          role: 'assistant',
          content: [{ type: 'output_text', text: state.text }],
          status: 'completed',
        },
      }),
    );
  }

  events.push(...closeChatToolItems(state));

  let status = 'completed';
  let incompleteDetails: ResponsesIncompleteDetails | undefined;
  if (state.finishReason === 'length') {
    status = 'incomplete';
    incompleteDetails = { reason: 'max_output_tokens' };
  }

  state.completedSent = true;
  const completedResponse: ResponsesResponse = {
    id: state.responseId,
    object: 'response',
    model: state.model,
    status,
    output: chatStreamOutput(state),
  };
  if (state.usage !== undefined) {
    completedResponse.usage = state.usage;
  }
  if (incompleteDetails !== undefined) {
    completedResponse.incomplete_details = incompleteDetails;
  }
  events.push(
    chatToResponsesEvent(state, 'response.completed', {
      response: completedResponse,
    }),
  );
  return events;
}

export function failChatCompletionsResponsesStream(
  state: ChatCompletionsToResponsesStreamState | null | undefined,
  message: string,
  errorType?: string,
): ResponsesStreamEvent[] {
  if (state === null || state === undefined || state.completedSent || state.failedSent) {
    return [];
  }
  const events = ensureChatToResponsesCreated(state);
  state.failedSent = true;
  state.completedSent = true;
  events.push(
    chatToResponsesEvent(state, 'response.failed', {
      response: {
        id: state.responseId,
        object: 'response',
        model: state.model,
        status: 'failed',
        output: chatStreamOutput(state),
        error: {
          message,
          ...(errorType ? { type: errorType } : {}),
        },
      },
    }),
  );
  return events;
}

function ensureChatToResponsesCreated(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesStreamEvent[] {
  if (state.createdSent) {
    return [];
  }
  state.createdSent = true;
  return [
    chatToResponsesEvent(state, 'response.created', {
      response: {
        id: state.responseId,
        object: 'response',
        model: state.model,
        status: 'in_progress',
        output: [],
      },
    }),
  ];
}

function ensureChatReasoningItem(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesStreamEvent[] {
  if (state.reasoningOpen || state.reasoningDone) {
    return [];
  }
  state.reasoningOpen = true;
  state.reasoningItemId = generateItemId();
  state.reasoningIndex = allocOutputIndex(state);
  return [
    chatToResponsesEvent(state, 'response.output_item.added', {
      output_index: state.reasoningIndex,
      item: {
        type: 'reasoning',
        id: state.reasoningItemId,
        status: 'in_progress',
      },
    }),
    chatToResponsesEvent(state, 'response.reasoning_summary_part.added', {
      output_index: state.reasoningIndex,
      summary_index: 0,
      item_id: state.reasoningItemId,
      part: { type: 'summary_text' },
    }),
  ];
}

function closeChatReasoningItem(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesStreamEvent[] {
  if (!state.reasoningOpen) {
    return [];
  }
  state.reasoningOpen = false;
  state.reasoningDone = true;
  const reasoning = state.reasoning;
  return [
    chatToResponsesEvent(state, 'response.reasoning_summary_text.done', {
      output_index: state.reasoningIndex,
      summary_index: 0,
      text: reasoning,
      item_id: state.reasoningItemId,
    }),
    chatToResponsesEvent(state, 'response.reasoning_summary_part.done', {
      output_index: state.reasoningIndex,
      summary_index: 0,
      item_id: state.reasoningItemId,
      part: { type: 'summary_text', text: reasoning },
    }),
    chatToResponsesEvent(state, 'response.output_item.done', {
      output_index: state.reasoningIndex,
      item: {
        type: 'reasoning',
        id: state.reasoningItemId,
        status: 'completed',
        summary: [{ type: 'summary_text', text: reasoning }],
      },
    }),
  ];
}

function ensureChatToResponsesMessageItem(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesStreamEvent[] {
  if (state.messageItemId !== '') {
    return [];
  }
  state.messageItemId = generateItemId();
  state.messageIndex = allocOutputIndex(state);
  return [
    chatToResponsesEvent(state, 'response.output_item.added', {
      output_index: state.messageIndex,
      item: {
        type: 'message',
        id: state.messageItemId,
        role: 'assistant',
        status: 'in_progress',
        content: [{ type: 'output_text' }],
      },
    }),
  ];
}

function ensureChatToResponsesTextPart(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesStreamEvent[] {
  if (state.textPartOpen) {
    return [];
  }
  state.textPartOpen = true;
  return [
    chatToResponsesEvent(state, 'response.content_part.added', {
      output_index: state.messageIndex,
      content_index: 0,
      item_id: state.messageItemId,
      part: { type: 'output_text', text: '' },
    }),
  ];
}

function closeChatToolItems(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesStreamEvent[] {
  if (state.toolCalls.size === 0) {
    return [];
  }
  const events: ResponsesStreamEvent[] = [];
  for (let i = 0; i < state.toolCalls.size; i++) {
    const toolCall = state.toolCalls.get(i);
    if (toolCall === undefined) {
      continue;
    }
    const itemID = state.toolItemIds.get(i);
    if (itemID === undefined) {
      continue;
    }
    let arguments_ = toolCall.function.arguments ?? '';
    if (bytesTrimSpace(arguments_) === '') {
      arguments_ = '{}';
    }
    const outputIndex = state.toolOutputIndex.get(i)!;
    const item = chatToolCallToResponsesOutput(
      toolCall,
      arguments_,
      state.toolContext,
      itemID,
    );
    events.push(
      chatToResponsesEvent(state, 'response.function_call_arguments.done', {
        output_index: outputIndex,
        item_id: itemID,
        call_id: toolCall.id ?? '',
        name: toolCall.function.name,
        arguments: arguments_,
      }),
      chatToResponsesEvent(state, 'response.output_item.done', {
        output_index: outputIndex,
        item,
      }),
    );
  }
  return events;
}

function chatStreamOutput(
  state: ChatCompletionsToResponsesStreamState,
): ResponsesOutput[] {
  const outputs: ResponsesOutput[] = [];
  if (state.reasoning.length > 0) {
    outputs.push({
      type: 'reasoning',
      id: generateItemId(),
      summary: [{ type: 'summary_text', text: state.reasoning }],
    });
  }
  if (state.messageItemId !== '' || state.toolCalls.size === 0) {
    outputs.push({
      type: 'message',
      id: nonEmpty(state.messageItemId, generateItemId()),
      role: 'assistant',
      content: [{ type: 'output_text', text: state.text }],
      status: 'completed',
    });
  }
  for (let i = 0; i < state.toolCalls.size; i++) {
    const toolCall = state.toolCalls.get(i);
    if (toolCall === undefined) {
      continue;
    }
    let arguments_ = toolCall.function.arguments ?? '';
    if (bytesTrimSpace(arguments_) === '') {
      arguments_ = '{}';
    }
    outputs.push(chatToolCallToResponsesOutput(toolCall, arguments_, state.toolContext));
  }
  return outputs;
}

function chatToResponsesEvent(
  state: ChatCompletionsToResponsesStreamState,
  eventType: string,
  template: Omit<ResponsesStreamEvent, 'type' | 'sequence_number'>,
): ResponsesStreamEvent {
  const seq = state.sequenceNumber;
  state.sequenceNumber++;
  return {
    ...template,
    type: eventType,
    sequence_number: seq,
  };
}

function rawString(raw: string | undefined): string {
  const trimmed = bytesTrimSpace(raw ?? '');
  if (trimmed === '' || trimmed === 'null') {
    return '';
  }
  try {
    const s = jsonParse(trimmed);
    if (typeof s === 'string') {
      return s;
    }
  } catch {
    /* not JSON string */
  }
  return '';
}

function rawStringOrJson(raw: string | undefined): string {
  const text = rawString(raw);
  if (text !== '') {
    return text;
  }
  const trimmed = bytesTrimSpace(raw ?? '');
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return trimmed;
  }
  return '';
}

function rawNestedString(raw: string | undefined, key: string): string {
  const trimmed = bytesTrimSpace(raw ?? '');
  if (trimmed === '' || trimmed === 'null') {
    return '';
  }
  try {
    const obj = jsonParse(trimmed) as Record<string, string>;
    return rawString(obj[key]);
  } catch {
    return '';
  }
}

function nonEmpty(value: string, fallback: string): string {
  if (value !== '') {
    return value;
  }
  return fallback;
}
