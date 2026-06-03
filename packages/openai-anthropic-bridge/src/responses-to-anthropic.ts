import { fromResponsesCallID } from './anthropic-to-responses.js';
import { jsonMarshal, jsonParse } from './json.js';
import type {
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicStreamEvent,
  AnthropicUsage,
  ResponsesIncompleteDetails,
  ResponsesOutput,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Non-streaming: ResponsesResponse → AnthropicResponse
// ---------------------------------------------------------------------------

export function responsesToAnthropic(
  resp: ResponsesResponse,
  model: string,
): AnthropicResponse {
  const out: AnthropicResponse = {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: '',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };

  const blocks: AnthropicContentBlock[] = [];

  for (const item of resp.output ?? []) {
    switch (item.type) {
      case 'reasoning': {
        let summaryText = '';
        for (const s of item.summary ?? []) {
          if (s.type === 'summary_text' && s.text !== '') {
            summaryText += s.text;
          }
        }
        if (summaryText !== '') {
          blocks.push({
            type: 'thinking',
            thinking: summaryText,
          });
        }
        break;
      }
      case 'message':
        for (const part of item.content ?? []) {
          if (part.type === 'output_text' && part.text !== '') {
            blocks.push({ type: 'text', text: part.text });
          }
        }
        break;
      case 'function_call':
        blocks.push({
          type: 'tool_use',
          id: fromResponsesCallID(item.call_id ?? ''),
          name: item.name,
          input: sanitizeAnthropicToolUseInput(
            item.name ?? '',
            item.arguments ?? '',
          ),
        });
        break;
      case 'web_search_call': {
        const toolUseId = `srvtoolu_${item.id ?? ''}`;
        let query = '';
        if (item.action !== undefined) {
          query = item.action.query ?? '';
        }
        const inputJSON = jsonMarshal({ query });
        blocks.push({
          type: 'server_tool_use',
          id: toolUseId,
          name: 'web_search',
          input: inputJSON,
        });
        blocks.push({
          type: 'web_search_tool_result',
          tool_use_id: toolUseId,
          content: jsonMarshal([]),
        });
        break;
      }
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '' });
  }
  out.content = blocks;

  out.stop_reason = responsesStatusToAnthropicStopReason(
    resp.status ?? '',
    resp.incomplete_details,
    blocks,
  );

  if (resp.usage !== undefined) {
    out.usage = anthropicUsageFromResponsesUsage(resp.usage);
  }

  return out;
}

export function anthropicUsageFromResponsesUsage(
  usage: ResponsesUsage | undefined,
): AnthropicUsage {
  if (usage === undefined) {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    };
  }

  let cachedTokens = 0;
  if (usage.input_tokens_details !== undefined) {
    cachedTokens = usage.input_tokens_details.cached_tokens ?? 0;
  }

  let inputTokens = usage.input_tokens - cachedTokens;
  if (inputTokens < 0) {
    inputTokens = 0;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: usage.output_tokens,
    cache_read_input_tokens: cachedTokens,
    cache_creation_input_tokens: 0,
  };
}

function responsesStatusToAnthropicStopReason(
  status: string,
  details: ResponsesIncompleteDetails | undefined,
  blocks: AnthropicContentBlock[],
): string {
  switch (status) {
    case 'incomplete':
      if (details !== undefined && details.reason === 'max_output_tokens') {
        return 'max_tokens';
      }
      return 'end_turn';
    case 'completed':
      if (containsAnthropicToolUseBlock(blocks)) {
        return 'tool_use';
      }
      return 'end_turn';
    default:
      return 'end_turn';
  }
}

function containsAnthropicToolUseBlock(
  blocks: AnthropicContentBlock[],
): boolean {
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      return true;
    }
  }
  return false;
}

export function sanitizeAnthropicToolUseInput(
  name: string,
  raw: string,
): unknown {
  if (name !== 'Read' || raw === '') {
    return raw;
  }

  let input: Record<string, unknown>;
  try {
    input = jsonParse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }

  if (!('pages' in input)) {
    return raw;
  }
  if (jsonMarshal(input.pages) !== '""') {
    return raw;
  }

  const { pages: _pages, ...rest } = input;
  return jsonMarshal(rest);
}

// ---------------------------------------------------------------------------
// Streaming: ResponsesStreamEvent → AnthropicStreamEvent (stateful converter)
// ---------------------------------------------------------------------------

export interface ResponsesEventToAnthropicState {
  messageStartSent: boolean;
  messageStopSent: boolean;
  contentBlockIndex: number;
  contentBlockOpen: boolean;
  currentBlockType: string;
  currentToolName: string;
  currentToolArgs: string;
  currentToolHadDelta: boolean;
  hasToolCall: boolean;
  outputIndexToBlockIdx: Map<number, number>;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  responseId: string;
  model: string;
  created: number;
}

export function newResponsesEventToAnthropicState(): ResponsesEventToAnthropicState {
  return {
    messageStartSent: false,
    messageStopSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    currentBlockType: '',
    currentToolName: '',
    currentToolArgs: '',
    currentToolHadDelta: false,
    hasToolCall: false,
    outputIndexToBlockIdx: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    responseId: '',
    model: '',
    created: Math.floor(Date.now() / 1000),
  };
}

export function responsesEventToAnthropicEvents(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  switch (evt.type) {
    case 'response.created':
      return resToAnthHandleCreated(evt, state);
    case 'response.output_item.added':
      return resToAnthHandleOutputItemAdded(evt, state);
    case 'response.output_text.delta':
      return resToAnthHandleTextDelta(evt, state);
    case 'response.output_text.done':
      return resToAnthHandleBlockDone(state);
    case 'response.function_call_arguments.delta':
      return resToAnthHandleFuncArgsDelta(evt, state);
    case 'response.function_call_arguments.done':
      return resToAnthHandleFuncArgsDone(evt, state);
    case 'response.output_item.done':
      return resToAnthHandleOutputItemDone(evt, state);
    case 'response.reasoning_summary_text.delta':
      return resToAnthHandleReasoningDelta(evt, state);
    case 'response.reasoning_summary_text.done':
      return resToAnthHandleBlockDone(state);
    case 'response.completed':
    case 'response.done':
    case 'response.incomplete':
    case 'response.failed':
      return resToAnthHandleCompleted(evt, state);
    default:
      return [];
  }
}

export function finalizeResponsesAnthropicStream(
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (!state.messageStartSent || state.messageStopSent) {
    return [];
  }

  const events: AnthropicStreamEvent[] = [];
  events.push(...closeCurrentBlock(state));

  let stopReason = 'end_turn';
  if (state.hasToolCall) {
    stopReason = 'tool_use';
  }

  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: {
        input_tokens: state.inputTokens,
        output_tokens: state.outputTokens,
        cache_read_input_tokens: state.cacheReadInputTokens,
        cache_creation_input_tokens: 0,
      },
    },
    { type: 'message_stop' },
  );
  state.messageStopSent = true;
  return events;
}

export function responsesAnthropicEventToSse(evt: AnthropicStreamEvent): string {
  const data = jsonMarshal(evt);
  return `event: ${evt.type}\ndata: ${data}\n\n`;
}

function resToAnthHandleCreated(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.response !== undefined) {
    state.responseId = evt.response.id;
    if (state.model === '') {
      state.model = evt.response.model;
    }
  }

  if (state.messageStartSent) {
    return [];
  }
  state.messageStartSent = true;

  return [
    {
      type: 'message_start',
      message: {
        id: state.responseId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: state.model,
        stop_reason: '',
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ];
}

function resToAnthHandleOutputItemAdded(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.item === undefined) {
    return [];
  }

  switch (evt.item.type) {
    case 'function_call': {
      const events: AnthropicStreamEvent[] = [];
      events.push(...closeCurrentBlock(state));

      const idx = state.contentBlockIndex;
      state.outputIndexToBlockIdx.set(evt.output_index ?? 0, idx);
      state.contentBlockOpen = true;
      state.currentBlockType = 'tool_use';
      state.currentToolName = evt.item.name ?? '';
      state.currentToolArgs = '';
      state.currentToolHadDelta = false;
      state.hasToolCall = true;

      events.push({
        type: 'content_block_start',
        index: idx,
        content_block: {
          type: 'tool_use',
          id: fromResponsesCallID(evt.item.call_id ?? ''),
          name: evt.item.name,
          input: {},
        },
      });
      return events;
    }

    case 'reasoning': {
      const events: AnthropicStreamEvent[] = [];
      events.push(...closeCurrentBlock(state));

      const idx = state.contentBlockIndex;
      state.outputIndexToBlockIdx.set(evt.output_index ?? 0, idx);
      state.contentBlockOpen = true;
      state.currentBlockType = 'thinking';

      events.push({
        type: 'content_block_start',
        index: idx,
        content_block: {
          type: 'thinking',
          thinking: '',
        },
      });
      return events;
    }

    case 'message':
      return [];
  }

  return [];
}

function resToAnthHandleTextDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.delta === '') {
    return [];
  }

  const events: AnthropicStreamEvent[] = [];

  if (!state.contentBlockOpen || state.currentBlockType !== 'text') {
    events.push(...closeCurrentBlock(state));

    const idx = state.contentBlockIndex;
    state.contentBlockOpen = true;
    state.currentBlockType = 'text';

    events.push({
      type: 'content_block_start',
      index: idx,
      content_block: {
        type: 'text',
        text: '',
      },
    });
  }

  const idx = state.contentBlockIndex;
  events.push({
    type: 'content_block_delta',
    index: idx,
    delta: {
      type: 'text_delta',
      text: evt.delta,
    },
  });
  return events;
}

function resToAnthHandleFuncArgsDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.delta === '') {
    return [];
  }

  if (state.currentBlockType === 'tool_use' && state.currentToolName === 'Read') {
    state.currentToolArgs += evt.delta;
    return [];
  }
  if (state.currentBlockType === 'tool_use') {
    state.currentToolHadDelta = true;
  }

  const blockIdx = state.outputIndexToBlockIdx.get(evt.output_index ?? 0);
  if (blockIdx === undefined) {
    return [];
  }

  return [
    {
      type: 'content_block_delta',
      index: blockIdx,
      delta: {
        type: 'input_json_delta',
        partial_json: evt.delta,
      },
    },
  ];
}

function resToAnthHandleFuncArgsDone(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (state.currentBlockType !== 'tool_use') {
    return resToAnthHandleBlockDone(state);
  }

  let raw = evt.arguments ?? '';
  if (raw === '') {
    raw = state.currentToolArgs;
  }
  if (raw === '' || state.currentToolHadDelta) {
    return closeCurrentBlock(state);
  }
  if (state.currentToolName === 'Read') {
    const sanitized = sanitizeAnthropicToolUseInput(state.currentToolName, raw);
    const sanitizedStr =
      typeof sanitized === 'string' ? sanitized : jsonMarshal(sanitized);
    if (sanitizedStr === '' || sanitizedStr === '{}') {
      return closeCurrentBlock(state);
    }
    raw = sanitizedStr;
  }

  const idx =
    state.outputIndexToBlockIdx.get(evt.output_index ?? 0) ?? state.contentBlockIndex;
  const events: AnthropicStreamEvent[] = [
    {
      type: 'content_block_delta',
      index: idx,
      delta: {
        type: 'input_json_delta',
        partial_json: raw,
      },
    },
  ];
  events.push(...closeCurrentBlock(state));
  return events;
}

function resToAnthHandleReasoningDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.delta === '') {
    return [];
  }

  const blockIdx = state.outputIndexToBlockIdx.get(evt.output_index ?? 0);
  if (blockIdx === undefined) {
    return [];
  }

  return [
    {
      type: 'content_block_delta',
      index: blockIdx,
      delta: {
        type: 'thinking_delta',
        thinking: evt.delta,
      },
    },
  ];
}

function resToAnthHandleBlockDone(
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (!state.contentBlockOpen) {
    return [];
  }
  return closeCurrentBlock(state);
}

function resToAnthHandleOutputItemDone(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.item === undefined) {
    return [];
  }

  if (evt.item.type === 'web_search_call' && evt.item.status === 'completed') {
    return resToAnthHandleWebSearchDone(evt, state);
  }

  if (state.contentBlockOpen) {
    return closeCurrentBlock(state);
  }
  return [];
}

function resToAnthHandleWebSearchDone(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [];
  events.push(...closeCurrentBlock(state));

  const toolUseId = `srvtoolu_${evt.item?.id ?? ''}`;
  let query = '';
  if (evt.item?.action !== undefined) {
    query = evt.item.action.query ?? '';
  }
  const inputJSON = jsonMarshal({ query });

  const idx1 = state.contentBlockIndex;
  events.push({
    type: 'content_block_start',
    index: idx1,
    content_block: {
      type: 'server_tool_use',
      id: toolUseId,
      name: 'web_search',
      input: inputJSON,
    },
  });
  events.push({
    type: 'content_block_stop',
    index: idx1,
  });
  state.contentBlockIndex++;

  const emptyResults = jsonMarshal([]);
  const idx2 = state.contentBlockIndex;
  events.push({
    type: 'content_block_start',
    index: idx2,
    content_block: {
      type: 'web_search_tool_result',
      tool_use_id: toolUseId,
      content: emptyResults,
    },
  });
  events.push({
    type: 'content_block_stop',
    index: idx2,
  });
  state.contentBlockIndex++;

  return events;
}

function resToAnthHandleCompleted(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (state.messageStopSent) {
    return [];
  }

  const events: AnthropicStreamEvent[] = [];
  events.push(...closeCurrentBlock(state));

  let stopReason = 'end_turn';
  if (evt.usage !== undefined) {
    const usage = anthropicUsageFromResponsesUsage(evt.usage);
    state.inputTokens = usage.input_tokens;
    state.outputTokens = usage.output_tokens;
    state.cacheReadInputTokens = usage.cache_read_input_tokens;
  }
  if (evt.response !== undefined) {
    if (evt.response.usage !== undefined) {
      const usage = anthropicUsageFromResponsesUsage(evt.response.usage);
      state.inputTokens = usage.input_tokens;
      state.outputTokens = usage.output_tokens;
      state.cacheReadInputTokens = usage.cache_read_input_tokens;
    }
    switch (evt.response.status) {
      case 'incomplete':
        if (
          evt.response.incomplete_details !== undefined &&
          evt.response.incomplete_details.reason === 'max_output_tokens'
        ) {
          stopReason = 'max_tokens';
        }
        break;
      case 'completed':
        if (state.hasToolCall) {
          stopReason = 'tool_use';
        }
        break;
    }
  }

  events.push(
    {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: {
        input_tokens: state.inputTokens,
        output_tokens: state.outputTokens,
        cache_read_input_tokens: state.cacheReadInputTokens,
        cache_creation_input_tokens: 0,
      },
    },
    { type: 'message_stop' },
  );
  state.messageStopSent = true;
  return events;
}

function closeCurrentBlock(
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (!state.contentBlockOpen) {
    return [];
  }
  const idx = state.contentBlockIndex;
  state.contentBlockOpen = false;
  state.contentBlockIndex++;
  state.currentToolName = '';
  state.currentToolArgs = '';
  state.currentToolHadDelta = false;
  return [
    {
      type: 'content_block_stop',
      index: idx,
    },
  ];
}
