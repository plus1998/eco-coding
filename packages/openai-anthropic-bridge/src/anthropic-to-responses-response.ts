import { toResponsesCallID } from './anthropic-to-responses.js';
import { jsonMarshal } from './json.js';
import { responsesStreamEventToJSON } from './responses-stream-event-wire.js';
import type {
  AnthropicContentBlock,
  AnthropicResponse,
  AnthropicStreamEvent,
  AnthropicUsage,
  ResponsesContentPart,
  ResponsesIncompleteDetails,
  ResponsesInputTokensDetails,
  ResponsesOutput,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Non-streaming: AnthropicResponse → ResponsesResponse
// ---------------------------------------------------------------------------

export function anthropicToResponsesResponse(
  resp: AnthropicResponse,
): ResponsesResponse {
  let id = resp.id;
  if (id === '') {
    id = generateResponsesId();
  }

  const out: ResponsesResponse = {
    id,
    object: 'response',
    model: resp.model,
  };

  const outputs: ResponsesOutput[] = [];
  const msgParts: ResponsesContentPart[] = [];

  for (const block of resp.content) {
    switch (block.type) {
      case 'thinking':
        if (block.thinking !== '') {
          outputs.push({
            type: 'reasoning',
            id: block.id ?? generateItemId(),
            summary: [{ type: 'summary_text', text: block.thinking ?? '' }],
          });
        }
        break;
      case 'redacted_thinking':
        if (block.data !== undefined && block.data !== '') {
          outputs.push({
            type: 'reasoning',
            id: block.id ?? generateItemId(),
            encrypted_content: block.data,
            summary: [],
          });
        }
        break;
      case 'text':
        if (block.text !== '') {
          msgParts.push({ type: 'output_text', text: block.text });
        }
        break;
      case 'tool_use': {
        let args = '{}';
        if (block.input !== undefined && block.input !== null) {
          const s =
            typeof block.input === 'string'
              ? block.input
              : jsonMarshal(block.input);
          if (s.length > 0) {
            args = s;
          }
        }
        outputs.push({
          type: 'function_call',
          id: generateItemId(),
          call_id: toResponsesCallID(block.id ?? ''),
          name: block.name,
          arguments: args,
          status: 'completed',
        });
        break;
      }
    }
  }

  if (msgParts.length > 0) {
    outputs.push({
      type: 'message',
      id: generateItemId(),
      role: 'assistant',
      content: msgParts,
      status: 'completed',
    });
  }

  if (outputs.length === 0) {
    outputs.push({
      type: 'message',
      id: generateItemId(),
      role: 'assistant',
      content: [{ type: 'output_text', text: '' }],
      status: 'completed',
    });
  }
  out.output = outputs;

  out.status = anthropicStopReasonToResponsesStatus(resp.stop_reason);
  if (out.status === 'incomplete') {
    out.incomplete_details = { reason: 'max_output_tokens' };
  }

  const totalInputTokens =
    resp.usage.input_tokens +
    resp.usage.cache_read_input_tokens +
    resp.usage.cache_creation_input_tokens;
  out.usage = {
    input_tokens: totalInputTokens,
    output_tokens: resp.usage.output_tokens,
    total_tokens: totalInputTokens + resp.usage.output_tokens,
  };
  if (resp.usage.cache_read_input_tokens > 0) {
    out.usage.input_tokens_details = {
      cached_tokens: resp.usage.cache_read_input_tokens,
    };
  }

  return out;
}

function anthropicStopReasonToResponsesStatus(stopReason: string): string {
  switch (stopReason) {
    case 'max_tokens':
      return 'incomplete';
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
      return 'completed';
    default:
      return 'completed';
  }
}

// ---------------------------------------------------------------------------
// Streaming: AnthropicStreamEvent → ResponsesStreamEvent (stateful converter)
// ---------------------------------------------------------------------------

export interface AnthropicEventToResponsesState {
  responseId: string;
  model: string;
  created: number;
  sequenceNumber: number;
  createdSent: boolean;
  completedSent: boolean;
  outputIndex: number;
  currentItemId: string;
  currentItemType: string;
  currentEncryptedContent: string;
  contentIndex: number;
  currentCallId: string;
  currentName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export function newAnthropicEventToResponsesState(): AnthropicEventToResponsesState {
  return {
    responseId: '',
    model: '',
    created: Math.floor(Date.now() / 1000),
    sequenceNumber: 0,
    createdSent: false,
    completedSent: false,
    outputIndex: 0,
    currentItemId: '',
    currentItemType: '',
    currentEncryptedContent: '',
    contentIndex: 0,
    currentCallId: '',
    currentName: '',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

export function anthropicEventToResponsesEvents(
  evt: AnthropicStreamEvent,
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  switch (evt.type) {
    case 'message_start':
      return anthToResHandleMessageStart(evt, state);
    case 'content_block_start':
      return anthToResHandleContentBlockStart(evt, state);
    case 'content_block_delta':
      return anthToResHandleContentBlockDelta(evt, state);
    case 'content_block_stop':
      return anthToResHandleContentBlockStop(state);
    case 'message_delta':
      return anthToResHandleMessageDelta(evt, state);
    case 'message_stop':
      return anthToResHandleMessageStop(state);
    default:
      return [];
  }
}

export function finalizeAnthropicResponsesStream(
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (!state.createdSent || state.completedSent) {
    return [];
  }

  const events: ResponsesStreamEvent[] = [];
  events.push(...closeCurrentResponsesItem(state));
  events.push(makeResponsesCompletedEvent(state, 'completed', undefined));
  state.completedSent = true;
  return events;
}

export function responsesEventToSse(evt: ResponsesStreamEvent): string {
  const data = responsesStreamEventToJSON(evt);
  return `event: ${evt.type}\ndata: ${data}\n\n`;
}

function anthToResHandleMessageStart(
  evt: AnthropicStreamEvent,
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (evt.message !== undefined) {
    state.responseId = evt.message.id;
    if (state.model === '') {
      state.model = evt.message.model;
    }
    if (evt.message.usage.input_tokens > 0) {
      state.inputTokens = evt.message.usage.input_tokens;
    }
    if (evt.message.usage.cache_read_input_tokens > 0) {
      state.cacheReadInputTokens = evt.message.usage.cache_read_input_tokens;
    }
    if (evt.message.usage.cache_creation_input_tokens > 0) {
      state.cacheCreationInputTokens =
        evt.message.usage.cache_creation_input_tokens;
    }
  }

  if (state.createdSent) {
    return [];
  }
  state.createdSent = true;

  return [makeResponsesCreatedEvent(state)];
}

function anthToResHandleContentBlockStart(
  evt: AnthropicStreamEvent,
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (evt.content_block === undefined) {
    return [];
  }

  const events: ResponsesStreamEvent[] = [];

  switch (evt.content_block.type) {
    case 'thinking':
      state.currentItemId = generateItemId();
      state.currentItemType = 'reasoning';
      state.currentEncryptedContent = '';
      state.contentIndex = 0;

      events.push(
        makeResponsesEvent(state, 'response.output_item.added', {
          output_index: state.outputIndex,
          item: {
            type: 'reasoning',
            id: state.currentItemId,
          },
        }),
      );
      break;

    case 'redacted_thinking':
      state.currentItemId = generateItemId();
      state.currentItemType = 'reasoning';
      state.currentEncryptedContent = evt.content_block.data ?? '';
      state.contentIndex = 0;

      events.push(
        makeResponsesEvent(state, 'response.output_item.added', {
          output_index: state.outputIndex,
          item: {
            type: 'reasoning',
            id: state.currentItemId,
            encrypted_content: state.currentEncryptedContent,
            summary: [],
          },
        }),
      );
      break;

    case 'text':
      if (state.currentItemType !== 'message') {
        state.currentItemId = generateItemId();
        state.currentItemType = 'message';
        state.contentIndex = 0;

        events.push(
          makeResponsesEvent(state, 'response.output_item.added', {
            output_index: state.outputIndex,
            item: {
              type: 'message',
              id: state.currentItemId,
              role: 'assistant',
              status: 'in_progress',
            },
          }),
        );
      }
      break;

    case 'tool_use':
      events.push(...closeCurrentResponsesItem(state));

      state.currentItemId = generateItemId();
      state.currentItemType = 'function_call';
      state.currentCallId = toResponsesCallID(evt.content_block.id ?? '');
      state.currentName = evt.content_block.name ?? '';

      events.push(
        makeResponsesEvent(state, 'response.output_item.added', {
          output_index: state.outputIndex,
          item: {
            type: 'function_call',
            id: state.currentItemId,
            call_id: state.currentCallId,
            name: state.currentName,
            status: 'in_progress',
          },
        }),
      );
      break;
  }

  return events;
}

function anthToResHandleContentBlockDelta(
  evt: AnthropicStreamEvent,
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (evt.delta === undefined) {
    return [];
  }

  switch (evt.delta.type) {
    case 'text_delta':
      if (evt.delta.text === '') {
        return [];
      }
      return [
        makeResponsesEvent(state, 'response.output_text.delta', {
          output_index: state.outputIndex,
          content_index: state.contentIndex,
          delta: evt.delta.text,
          item_id: state.currentItemId,
        }),
      ];

    case 'thinking_delta':
      if (evt.delta.thinking === '') {
        return [];
      }
      return [
        makeResponsesEvent(state, 'response.reasoning_summary_text.delta', {
          output_index: state.outputIndex,
          summary_index: 0,
          delta: evt.delta.thinking,
          item_id: state.currentItemId,
        }),
      ];

    case 'input_json_delta':
      if (evt.delta.partial_json === '') {
        return [];
      }
      return [
        makeResponsesEvent(state, 'response.function_call_arguments.delta', {
          output_index: state.outputIndex,
          delta: evt.delta.partial_json,
          item_id: state.currentItemId,
          call_id: state.currentCallId,
          name: state.currentName,
        }),
      ];

    case 'signature_delta':
      return [];
  }

  return [];
}

function anthToResHandleContentBlockStop(
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  switch (state.currentItemType) {
    case 'reasoning': {
      const events: ResponsesStreamEvent[] = [
        makeResponsesEvent(state, 'response.reasoning_summary_text.done', {
          output_index: state.outputIndex,
          summary_index: 0,
          item_id: state.currentItemId,
        }),
      ];
      events.push(...closeCurrentResponsesItem(state));
      return events;
    }

    case 'function_call': {
      const events: ResponsesStreamEvent[] = [
        makeResponsesEvent(state, 'response.function_call_arguments.done', {
          output_index: state.outputIndex,
          item_id: state.currentItemId,
          call_id: state.currentCallId,
          name: state.currentName,
        }),
      ];
      events.push(...closeCurrentResponsesItem(state));
      return events;
    }

    case 'message':
      return [
        makeResponsesEvent(state, 'response.output_text.done', {
          output_index: state.outputIndex,
          content_index: state.contentIndex,
          item_id: state.currentItemId,
        }),
      ];
  }

  return [];
}

function anthToResHandleMessageDelta(
  evt: AnthropicStreamEvent,
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (evt.usage !== undefined) {
    state.outputTokens = evt.usage.output_tokens;
    if (evt.usage.input_tokens > 0) {
      state.inputTokens = evt.usage.input_tokens;
    }
    if (evt.usage.cache_read_input_tokens > 0) {
      state.cacheReadInputTokens = evt.usage.cache_read_input_tokens;
    }
    if (evt.usage.cache_creation_input_tokens > 0) {
      state.cacheCreationInputTokens = evt.usage.cache_creation_input_tokens;
    }
  }

  return [];
}

function anthToResHandleMessageStop(
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (state.completedSent) {
    return [];
  }

  const events: ResponsesStreamEvent[] = [];
  events.push(...closeCurrentResponsesItem(state));
  events.push(makeResponsesCompletedEvent(state, 'completed', undefined));
  state.completedSent = true;
  return events;
}

function closeCurrentResponsesItem(
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent[] {
  if (state.currentItemType === '') {
    return [];
  }

  const itemType = state.currentItemType;
  const itemId = state.currentItemId;
  const encryptedContent = state.currentEncryptedContent;

  state.currentItemType = '';
  state.currentItemId = '';
  state.currentEncryptedContent = '';
  state.currentCallId = '';
  state.currentName = '';
  state.outputIndex++;
  state.contentIndex = 0;

  return [
    makeResponsesEvent(state, 'response.output_item.done', {
      output_index: state.outputIndex - 1,
      item: {
        type: itemType,
        id: itemId,
        encrypted_content:
          itemType === 'reasoning' && encryptedContent !== ''
            ? encryptedContent
            : undefined,
        summary: itemType === 'reasoning' ? [] : undefined,
        status: 'completed',
      },
    }),
  ];
}

function makeResponsesCreatedEvent(
  state: AnthropicEventToResponsesState,
): ResponsesStreamEvent {
  const seq = state.sequenceNumber;
  state.sequenceNumber++;
  return {
    type: 'response.created',
    sequence_number: seq,
    response: {
      id: state.responseId,
      object: 'response',
      model: state.model,
      status: 'in_progress',
      output: [],
    },
  };
}

function makeResponsesCompletedEvent(
  state: AnthropicEventToResponsesState,
  status: string,
  incompleteDetails: ResponsesIncompleteDetails | undefined,
): ResponsesStreamEvent {
  const seq = state.sequenceNumber;
  state.sequenceNumber++;

  const totalInputTokens =
    state.inputTokens +
    state.cacheReadInputTokens +
    state.cacheCreationInputTokens;
  const usage: ResponsesUsage = {
    input_tokens: totalInputTokens,
    output_tokens: state.outputTokens,
    total_tokens: totalInputTokens + state.outputTokens,
  };
  if (state.cacheReadInputTokens > 0) {
    usage.input_tokens_details = {
      cached_tokens: state.cacheReadInputTokens,
    } satisfies ResponsesInputTokensDetails;
  }

  return {
    type: 'response.completed',
    sequence_number: seq,
    response: {
      id: state.responseId,
      object: 'response',
      model: state.model,
      status,
      output: [],
      usage,
      incomplete_details: incompleteDetails,
    },
  };
}

function makeResponsesEvent(
  state: AnthropicEventToResponsesState,
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

function randomHex(byteLength: number): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateResponsesId(): string {
  return `resp_${randomHex(12)}`;
}

export function generateItemId(): string {
  return `item_${randomHex(12)}`;
}
