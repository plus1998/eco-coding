import { generateItemId, generateResponsesId } from './anthropic-to-responses-response.js';
import { bytesTrimSpace, jsonMarshal, jsonParse } from './json.js';
import type {
  ChatCompletionsChunk,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatContentPart,
  ChatFunction,
  ChatImageURL,
  ChatMessage,
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

// ---------------------------------------------------------------------------
// ResponsesRequest → ChatCompletionsRequest
// ---------------------------------------------------------------------------

export function responsesToChatCompletionsRequest(
  req: ResponsesRequest | null | undefined,
): ChatCompletionsRequest {
  if (req === null || req === undefined) {
    throw new Error('responses request is nil');
  }

  const messages = responsesInputToChatMessages(
    req.instructions ?? '',
    req.input,
  );

  const out: ChatCompletionsRequest = {
    model: req.model,
    messages,
  };
  if (req.max_output_tokens !== undefined) {
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
  if (req.service_tier !== undefined) {
    out.service_tier = req.service_tier;
  }

  if (req.reasoning !== undefined) {
    out.reasoning_effort = req.reasoning.effort;
  }
  if ((req.tools?.length ?? 0) > 0) {
    out.tools = responsesToolsToChatTools(req.tools ?? []);
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
        continue;
      }
      case 'function_call': {
        let arguments_ = rawString(item.arguments);
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
        } else {
          messages.push({
            role: 'assistant',
            tool_calls: [toolCall],
            reasoning_content: pendingReasoning,
          });
        }
        pendingReasoning = '';
        continue;
      }
      case 'function_call_output':
        messages.push({
          role: 'tool',
          tool_call_id: rawString(item.call_id),
          content: rawString(item.output),
        });
        pendingReasoning = '';
        continue;
      case 'input_text':
      case 'text':
        messages.push({
          role: 'user',
          content: rawString(item.text),
        });
        pendingReasoning = '';
        continue;
      case 'input_image': {
        const content = chatContentFromSingleResponsesPart(itemType, item);
        messages.push({ role: 'user', content });
        pendingReasoning = '';
        continue;
      }
    }

    if (itemType !== '' && itemType !== 'message') {
      pendingReasoning = '';
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
    messages.push({ role, content: chatContent });
    if (role !== 'assistant') {
      pendingReasoning = '';
    }
  }

  return messages;
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
      out[k] = typeof v === 'string' ? v : jsonMarshal(v);
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
      out[k] = jsonMarshal(v);
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
        hasNonText = true;
        chatParts.push({
          type: 'image_url',
          image_url: { url: imageURL } satisfies ChatImageURL,
        });
        break;
      }
    }
  }

  if (!hasNonText) {
    return textParts.join('\n\n');
  }
  if (role !== 'user') {
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
      return [
        {
          type: 'image_url',
          image_url: { url: imageURL },
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
  const serialized =
    typeof raw === 'string' ? raw : jsonMarshal(raw);
  let choice: Record<string, string>;
  try {
    choice = jsonParse(serialized) as Record<string, string>;
  } catch {
    return raw;
  }
  if (rawString(choice.type) !== 'function') {
    return raw;
  }
  let name = rawString(choice.name);
  if (name === '') {
    name = rawNestedString(choice.function, 'name');
  }
  if (name === '') {
    return raw;
  }
  return jsonParse(
    jsonMarshal({
      type: 'function',
      function: { name },
    }),
  );
}

// ---------------------------------------------------------------------------
// ChatCompletionsResponse → ResponsesResponse
// ---------------------------------------------------------------------------

export function chatCompletionsResponseToResponses(
  resp: ChatCompletionsResponse | null | undefined,
  model: string,
): ResponsesResponse {
  let id = '';
  if (resp !== null && resp !== undefined) {
    id = resp.id;
  }
  if (id === '') {
    id = generateResponsesId();
  }

  const out: ResponsesResponse = {
    id,
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
    out.output = chatMessageToResponsesOutput(choice.message);
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

function chatMessageToResponsesOutput(message: ChatMessage): ResponsesOutput[] {
  const outputs: ResponsesOutput[] = [];
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
    outputs.push({
      type: 'function_call',
      id: generateItemId(),
      call_id: toolCall.id ?? '',
      name: toolCall.function.name,
      arguments: arguments_,
      status: 'completed',
    });
  }

  return outputs;
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
}

export function newChatCompletionsToResponsesStreamState(
  model: string,
): ChatCompletionsToResponsesStreamState {
  return {
    responseId: generateResponsesId(),
    model,
    created: Math.floor(Date.now() / 1000),
    sequenceNumber: 0,
    createdSent: false,
    completedSent: false,
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
  };
}

function allocOutputIndex(state: ChatCompletionsToResponsesStreamState): number {
  const idx = state.nextOutputIndex;
  state.nextOutputIndex++;
  return idx;
}

export function chatCompletionsChunkToResponsesEvents(
  chunk: ChatCompletionsChunk | null | undefined,
  state: ChatCompletionsToResponsesStreamState | null | undefined,
): ResponsesStreamEvent[] {
  if (chunk === null || chunk === undefined || state === null || state === undefined) {
    return [];
  }
  if (chunk.id !== '') {
    state.responseId = chunk.id;
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
    const reasoning = choice.delta.reasoning_content;
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
    if (content !== undefined && content !== '') {
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
          function: { ...toolCall.function },
        };
        state.toolCalls.set(idx, copyCall);
        stored = copyCall;
        const itemID = generateItemId();
        state.toolItemIds.set(idx, itemID);
        state.toolOutputIndex.set(idx, allocOutputIndex(state));
        const outputIndex = state.toolOutputIndex.get(idx)!;
        events.push(
          chatToResponsesEvent(state, 'response.output_item.added', {
            output_index: outputIndex,
            item: {
              type: 'function_call',
              id: itemID,
              call_id: stored.id ?? '',
              name: stored.function.name,
              status: 'in_progress',
            },
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
  if (state === null || state === undefined || state.completedSent) {
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
        item: {
          type: 'function_call',
          id: itemID,
          call_id: toolCall.id ?? '',
          name: toolCall.function.name,
          arguments: arguments_,
          status: 'completed',
        },
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
    outputs.push({
      type: 'function_call',
      id: generateItemId(),
      call_id: toolCall.id ?? '',
      name: toolCall.function.name,
      arguments: arguments_,
      status: 'completed',
    });
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
