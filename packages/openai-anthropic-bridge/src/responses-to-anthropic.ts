import { fromResponsesCallID, normalizeFunctionCallNameForRequest } from './anthropic-to-responses.js';
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
  requestToolNames: readonly string[] = [],
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
        if (item.encrypted_content !== undefined && item.encrypted_content !== '') {
          blocks.push({
            type: 'redacted_thinking',
            data: item.encrypted_content,
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
          name: normalizeFunctionCallNameForRequest(item.name ?? '', requestToolNames),
          input: sanitizeAnthropicToolUseInput(
            normalizeFunctionCallNameForRequest(item.name ?? '', requestToolNames),
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

/** Preserve inline plan bodies; Eco's OpenAI-compatible Plan Mode captures from tool input. */
export function preserveExitPlanModeInlinePlanFromObject(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return { ...input };
}

/** @deprecated Use preserveExitPlanModeInlinePlanFromObject. */
export const stripExitPlanModeInlinePlanFromObject = preserveExitPlanModeInlinePlanFromObject;

export function sanitizeExitPlanModeInlinePlanJson(raw: string): string {
  if (raw === '') {
    return '{}';
  }
  try {
    return jsonMarshal(
      preserveExitPlanModeInlinePlanFromObject(jsonParse(raw) as Record<string, unknown>),
    );
  } catch {
    return '{}';
  }
}

export function sanitizeAnthropicToolUseInput(
  name: string,
  raw: string,
): unknown {
  if (name === 'ExitPlanMode') {
    if (raw === '') {
      return {};
    }
    try {
      return preserveExitPlanModeInlinePlanFromObject(jsonParse(raw) as Record<string, unknown>);
    } catch {
      return {};
    }
  }

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
  closedToolOutputIndexes: Set<number>;
  emittedTextByOutputIndex: Map<number, string>;
  emittedReasoningByOutputIndex: Map<number, string>;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  responseId: string;
  model: string;
  created: number;
  requestToolNames: readonly string[];
}

export function newResponsesEventToAnthropicState(
  requestToolNames: readonly string[] = [],
): ResponsesEventToAnthropicState {
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
    closedToolOutputIndexes: new Set(),
    emittedTextByOutputIndex: new Map(),
    emittedReasoningByOutputIndex: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    responseId: '',
    model: '',
    created: Math.floor(Date.now() / 1000),
    requestToolNames,
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
      return resToAnthHandleTextBlockDone(evt, state);
    case 'response.function_call_arguments.delta':
      return resToAnthHandleFuncArgsDelta(evt, state);
    case 'response.function_call_arguments.done':
      return resToAnthHandleFuncArgsDone(evt, state);
    case 'response.output_item.done':
      return resToAnthHandleOutputItemDone(evt, state);
    case 'response.reasoning_summary_text.delta':
      return resToAnthHandleReasoningDelta(evt, state);
    case 'response.reasoning_summary_text.done':
      return resToAnthHandleReasoningBlockDone(evt, state);
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
      state.currentToolName = normalizeFunctionCallNameForRequest(
        evt.item.name ?? '',
        state.requestToolNames,
      );
      state.currentToolArgs = '';
      state.currentToolHadDelta = false;
      state.hasToolCall = true;

      events.push({
        type: 'content_block_start',
        index: idx,
        content_block: {
          type: 'tool_use',
          id: fromResponsesCallID(evt.item.call_id ?? ''),
          name: state.currentToolName,
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
  if (evt.delta === undefined || evt.delta === '') {
    return [];
  }

  return emitTextDeltaForOutputIndex(evt.output_index ?? 0, evt.delta, state);
}

function emitTextDeltaForOutputIndex(
  outputIndex: number,
  delta: string,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (delta === '') {
    return [];
  }

  // Upstream may emit assistant text after tool_calls started; closing tool_use here
  // leaves stale outputIndexToBlockIdx and breaks SDK (content_block_delta at closed index).
  if (state.contentBlockOpen && state.currentBlockType === 'tool_use') {
    return [];
  }

  const events: AnthropicStreamEvent[] = [];

  if (!state.contentBlockOpen || state.currentBlockType !== 'text') {
    events.push(...closeCurrentBlock(state));

    const idx = state.contentBlockIndex;
    state.outputIndexToBlockIdx.set(outputIndex, idx);
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
      text: delta,
    },
  });
  const emitted = state.emittedTextByOutputIndex.get(outputIndex) ?? '';
  state.emittedTextByOutputIndex.set(outputIndex, emitted + delta);
  return events;
}

function resToAnthHandleFuncArgsDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.delta === '') {
    return [];
  }

  if (
    state.currentBlockType === 'tool_use' &&
    (state.currentToolName === 'Read' || state.currentToolName === 'ExitPlanMode')
  ) {
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

  if (
    !state.contentBlockOpen ||
    state.currentBlockType !== 'tool_use' ||
    blockIdx !== state.contentBlockIndex
  ) {
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
    return [];
  }

  let raw = evt.arguments ?? '';
  if (raw === '') {
    raw = state.currentToolArgs;
  }

  if (state.currentToolName === 'ExitPlanMode') {
    const idx =
      state.outputIndexToBlockIdx.get(evt.output_index ?? 0) ?? state.contentBlockIndex;
    const sanitized = sanitizeExitPlanModeInlinePlanJson(raw);
    const events: AnthropicStreamEvent[] = [];
    if (sanitized !== '' && sanitized !== '{}') {
      events.push({
        type: 'content_block_delta',
        index: idx,
        delta: {
          type: 'input_json_delta',
          partial_json: sanitized,
        },
      });
    }
    events.push(...closeCurrentToolBlock(evt.output_index ?? 0, state));
    return events;
  }

  if (raw === '' || state.currentToolHadDelta) {
    return closeCurrentToolBlock(evt.output_index ?? 0, state);
  }
  if (state.currentToolName === 'Read') {
    const sanitized = sanitizeAnthropicToolUseInput(state.currentToolName, raw);
    const sanitizedStr =
      typeof sanitized === 'string' ? sanitized : jsonMarshal(sanitized);
    if (sanitizedStr === '' || sanitizedStr === '{}') {
      return closeCurrentToolBlock(evt.output_index ?? 0, state);
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
  events.push(...closeCurrentToolBlock(evt.output_index ?? 0, state));
  return events;
}

function resToAnthHandleReasoningDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (evt.delta === undefined || evt.delta === '') {
    return [];
  }

  return emitReasoningDeltaForOutputIndex(evt.output_index ?? 0, evt.delta, state);
}

function emitReasoningDeltaForOutputIndex(
  outputIndex: number,
  delta: string,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (delta === '') {
    return [];
  }

  const events: AnthropicStreamEvent[] = [];
  if (!state.contentBlockOpen || state.currentBlockType !== 'thinking') {
    events.push(...closeCurrentBlock(state));

    const idx = state.contentBlockIndex;
    state.outputIndexToBlockIdx.set(outputIndex, idx);
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
  }

  const blockIdx = state.contentBlockIndex;
  events.push({
    type: 'content_block_delta',
    index: blockIdx,
    delta: {
      type: 'thinking_delta',
      thinking: delta,
    },
  });
  const emitted = state.emittedReasoningByOutputIndex.get(outputIndex) ?? '';
  state.emittedReasoningByOutputIndex.set(outputIndex, emitted + delta);
  return events;
}

function resToAnthHandleTextBlockDone(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [];
  if (evt.text !== undefined && evt.text !== '') {
    events.push(...emitMissingTextFromFullText(evt.output_index ?? 0, evt.text, state));
  }
  if (!state.contentBlockOpen || state.currentBlockType !== 'text') {
    return events;
  }
  events.push(...closeCurrentBlock(state));
  return events;
}

function resToAnthHandleReasoningBlockDone(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [];
  if (evt.text !== undefined && evt.text !== '') {
    events.push(...emitMissingReasoningFromFullText(evt.output_index ?? 0, evt.text, state));
  }
  if (!state.contentBlockOpen || state.currentBlockType !== 'thinking') {
    return events;
  }
  events.push(...closeCurrentBlock(state));
  return events;
}

function emitMissingTextFromFullText(
  outputIndex: number,
  fullText: string,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (fullText === '') {
    return [];
  }

  const emitted = state.emittedTextByOutputIndex.get(outputIndex) ?? '';
  if (emitted !== '' && !fullText.startsWith(emitted)) {
    return [];
  }

  const delta = fullText.slice(emitted.length);
  return emitTextDeltaForOutputIndex(outputIndex, delta, state);
}

function emitMissingReasoningFromFullText(
  outputIndex: number,
  fullText: string,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  if (fullText === '') {
    return [];
  }

  const emitted = state.emittedReasoningByOutputIndex.get(outputIndex) ?? '';
  if (emitted !== '' && !fullText.startsWith(emitted)) {
    return [];
  }

  const delta = fullText.slice(emitted.length);
  return emitReasoningDeltaForOutputIndex(outputIndex, delta, state);
}

function collectMessageOutputText(item: ResponsesOutput): string {
  let text = '';
  for (const part of item.content ?? []) {
    if (part.type === 'output_text' && part.text !== undefined && part.text !== '') {
      text += part.text;
    }
  }
  return text;
}

function collectReasoningSummaryText(item: ResponsesOutput): string {
  let text = '';
  for (const summary of item.summary ?? []) {
    if (summary.type === 'summary_text' && summary.text !== '') {
      text += summary.text;
    }
  }
  return text;
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

  switch (evt.item.type) {
    case 'function_call': {
      const outputIndex = evt.output_index ?? 0;
      if (state.closedToolOutputIndexes.has(outputIndex)) {
        return [];
      }
      const toolName = normalizeFunctionCallNameForRequest(
        evt.item.name ?? state.currentToolName,
        state.requestToolNames,
      );
      if (state.currentBlockType === 'tool_use') {
        return emitPendingToolUseArguments(evt, state);
      }

      const events: AnthropicStreamEvent[] = [];
      events.push(...closeCurrentBlock(state));

      const idx = state.contentBlockIndex;
      state.outputIndexToBlockIdx.set(outputIndex, idx);
      state.contentBlockOpen = true;
      state.currentBlockType = 'tool_use';
      state.currentToolName = toolName;
      state.currentToolArgs = '';
      state.currentToolHadDelta = false;
      state.hasToolCall = true;

      events.push({
        type: 'content_block_start',
        index: idx,
        content_block: {
          type: 'tool_use',
          id: fromResponsesCallID(evt.item.call_id ?? ''),
          name: toolName,
          input: {},
        },
      });
      events.push(...emitPendingToolUseArguments(evt, state));
      return events;
    }
    case 'reasoning': {
      const events = emitMissingReasoningFromFullText(
        evt.output_index ?? 0,
        collectReasoningSummaryText(evt.item),
        state,
      );
      if (state.currentBlockType === 'thinking') {
        events.push(...closeCurrentBlock(state));
      }
      return events;
    }
    case 'message': {
      const events = emitMissingTextFromFullText(
        evt.output_index ?? 0,
        collectMessageOutputText(evt.item),
        state,
      );
      if (state.currentBlockType === 'text') {
        events.push(...closeCurrentBlock(state));
      }
      return events;
    }
    default:
      return [];
  }
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

function emitFinalResponseOutputFallback(
  output: ResponsesOutput[],
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [];
  for (let outputIndex = 0; outputIndex < output.length; outputIndex++) {
    const item = output[outputIndex];
    if (item === undefined) {
      continue;
    }
    switch (item.type) {
      case 'reasoning':
        events.push(
          ...emitMissingReasoningFromFullText(
            outputIndex,
            collectReasoningSummaryText(item),
            state,
          ),
        );
        if (state.currentBlockType === 'thinking') {
          events.push(...closeCurrentBlock(state));
        }
        break;
      case 'message':
        events.push(
          ...emitMissingTextFromFullText(outputIndex, collectMessageOutputText(item), state),
        );
        if (state.currentBlockType === 'text') {
          events.push(...closeCurrentBlock(state));
        }
        break;
    }
  }
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
  if (evt.response?.output !== undefined) {
    events.push(...emitFinalResponseOutputFallback(evt.response.output, state));
  }
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

function clearOutputIndexMappingsForBlock(
  state: ResponsesEventToAnthropicState,
  blockIdx: number,
): void {
  for (const [outputIndex, mapped] of state.outputIndexToBlockIdx) {
    if (mapped === blockIdx) {
      state.outputIndexToBlockIdx.delete(outputIndex);
    }
  }
}

function emitPendingToolUseArguments(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  const args = evt.item?.arguments ?? evt.arguments ?? state.currentToolArgs;
  const events: AnthropicStreamEvent[] = [];

  if (args !== '' && !state.currentToolHadDelta) {
    const idx =
      state.outputIndexToBlockIdx.get(evt.output_index ?? 0) ?? state.contentBlockIndex;
    let raw = args;
    if (state.currentToolName === 'ExitPlanMode') {
      raw = sanitizeExitPlanModeInlinePlanJson(raw);
    } else if (state.currentToolName === 'Read') {
      const sanitized = sanitizeAnthropicToolUseInput(state.currentToolName, raw);
      raw = typeof sanitized === 'string' ? sanitized : jsonMarshal(sanitized);
    }
    if (raw !== '' && raw !== '{}') {
      events.push({
        type: 'content_block_delta',
        index: idx,
        delta: {
          type: 'input_json_delta',
          partial_json: raw,
        },
      });
    }
  }

  if (state.contentBlockOpen && state.currentBlockType === 'tool_use') {
    events.push(...closeCurrentToolBlock(evt.output_index ?? 0, state));
  }
  return events;
}

function closeCurrentToolBlock(
  outputIndex: number,
  state: ResponsesEventToAnthropicState,
): AnthropicStreamEvent[] {
  const events = closeCurrentBlock(state);
  state.closedToolOutputIndexes.add(outputIndex);
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
  state.currentBlockType = '';
  state.contentBlockIndex++;
  state.currentToolName = '';
  state.currentToolArgs = '';
  state.currentToolHadDelta = false;
  clearOutputIndexMappingsForBlock(state, idx);
  return [
    {
      type: 'content_block_stop',
      index: idx,
    },
  ];
}
