import { jsonMarshal } from './json.js';
import type {
  ChatCompletionsChunk,
  ChatCompletionsResponse,
  ChatDelta,
  ChatMessage,
  ChatReasoningItem,
  ChatTokenDetails,
  ChatToolCall,
  ChatUsage,
  ResponsesIncompleteDetails,
  ResponsesInputTokensDetails,
  ResponsesOutput,
  ResponsesOutputTokensDetails,
  ResponsesResponse,
  ResponsesStreamEvent,
  ResponsesUsage,
} from './types.js';

// ---------------------------------------------------------------------------
// Non-streaming: ResponsesResponse → ChatCompletionsResponse
// ---------------------------------------------------------------------------

export function responsesToChatCompletions(
  resp: ResponsesResponse,
  model: string,
): ChatCompletionsResponse {
  let id = resp.id;
  if (id === '') {
    id = generateChatCmplId();
  }

  const out: ChatCompletionsResponse = {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [],
  };

  let contentText = '';
  let reasoningText = '';
  const reasoningItems: ChatReasoningItem[] = [];
  const toolCalls: ChatToolCall[] = [];

  for (const item of resp.output ?? []) {
    switch (item.type) {
      case 'message':
        for (const part of item.content ?? []) {
          if (part.type === 'output_text' && part.text !== '') {
            contentText += part.text;
          }
        }
        break;
      case 'function_call':
        toolCalls.push({
          id: item.call_id ?? '',
          type: 'function',
          function: {
            name: item.name ?? '',
            arguments: item.arguments ?? '',
          },
        });
        break;
      case 'reasoning':
        reasoningItems.push({
          type: 'reasoning',
          id: item.id,
          encrypted_content: item.encrypted_content,
          summary: item.summary ?? [],
        });
        for (const s of item.summary ?? []) {
          if (s.type === 'summary_text' && s.text !== '') {
            reasoningText += s.text;
          }
        }
        break;
      case 'web_search_call':
        break;
    }
  }

  const msg: ChatMessage = { role: 'assistant' };
  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls;
  }
  if (contentText !== '') {
    msg.content = contentText;
  }
  if (reasoningText !== '') {
    msg.reasoning_content = reasoningText;
  }
  if (reasoningItems.length > 0) {
    msg.reasoning_items = reasoningItems;
  }

  const finishReason = responsesStatusToChatFinishReason(
    resp.status ?? '',
    resp.incomplete_details,
    toolCalls,
  );

  out.choices = [
    {
      index: 0,
      message: msg,
      finish_reason: finishReason,
    },
  ];

  out.usage = chatUsageFromResponsesUsage(resp.usage);

  return out;
}

function responsesStatusToChatFinishReason(
  status: string,
  details: ResponsesIncompleteDetails | undefined,
  toolCalls: ChatToolCall[],
): string {
  switch (status) {
    case 'incomplete':
      if (details !== undefined && details.reason === 'max_output_tokens') {
        return 'length';
      }
      return 'stop';
    case 'completed':
      if (toolCalls.length > 0) {
        return 'tool_calls';
      }
      return 'stop';
    default:
      return 'stop';
  }
}

// ---------------------------------------------------------------------------
// Streaming: ResponsesStreamEvent → ChatCompletionsChunk (stateful converter)
// ---------------------------------------------------------------------------

export interface ResponsesEventToChatState {
  id: string;
  model: string;
  created: number;
  sentRole: boolean;
  sawToolCall: boolean;
  sawText: boolean;
  finalized: boolean;
  nextToolCallIndex: number;
  outputIndexToToolIndex: Map<number, number>;
  includeUsage: boolean;
  usage: ChatUsage | undefined;
}

export function newResponsesEventToChatState(): ResponsesEventToChatState {
  return {
    id: generateChatCmplId(),
    model: '',
    created: Math.floor(Date.now() / 1000),
    sentRole: false,
    sawToolCall: false,
    sawText: false,
    finalized: false,
    nextToolCallIndex: 0,
    outputIndexToToolIndex: new Map(),
    includeUsage: false,
    usage: undefined,
  };
}

export function responsesEventToChatChunks(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  switch (evt.type) {
    case 'response.created':
      return resToChatHandleCreated(evt, state);
    case 'response.output_text.delta':
      return resToChatHandleTextDelta(evt, state);
    case 'response.output_item.added':
      return resToChatHandleOutputItemAdded(evt, state);
    case 'response.function_call_arguments.delta':
      return resToChatHandleFuncArgsDelta(evt, state);
    case 'response.reasoning_summary_text.delta':
      return resToChatHandleReasoningDelta(evt, state);
    case 'response.reasoning_summary_text.done':
      return [];
    case 'response.completed':
    case 'response.done':
    case 'response.incomplete':
    case 'response.failed':
      return resToChatHandleCompleted(evt, state);
    default:
      return [];
  }
}

export function finalizeResponsesChatStream(
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  if (state.finalized) {
    return [];
  }
  state.finalized = true;

  let finishReason = 'stop';
  if (state.sawToolCall) {
    finishReason = 'tool_calls';
  }

  const chunks: ChatCompletionsChunk[] = [
    makeChatFinishChunk(state, finishReason),
  ];

  if (state.includeUsage && state.usage !== undefined) {
    chunks.push({
      id: state.id,
      object: 'chat.completion.chunk',
      created: state.created,
      model: state.model,
      choices: [],
      usage: state.usage,
    });
  }

  return chunks;
}

export function chatChunkToSse(chunk: ChatCompletionsChunk): string {
  const data = jsonMarshal(chunk);
  return `data: ${data}\n\n`;
}

function resToChatHandleCreated(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  if (evt.response !== undefined) {
    if (evt.response.id !== '') {
      state.id = evt.response.id;
    }
    if (state.model === '' && evt.response.model !== '') {
      state.model = evt.response.model;
    }
  }
  if (state.sentRole) {
    return [];
  }
  state.sentRole = true;

  return [makeChatDeltaChunk(state, { role: 'assistant' })];
}

function resToChatHandleTextDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  if (evt.delta === '') {
    return [];
  }
  state.sawText = true;
  const content = evt.delta;
  return [makeChatDeltaChunk(state, { content })];
}

function resToChatHandleOutputItemAdded(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  if (evt.item === undefined || evt.item.type !== 'function_call') {
    return [];
  }

  state.sawToolCall = true;
  const idx = state.nextToolCallIndex;
  state.outputIndexToToolIndex.set(evt.output_index ?? 0, idx);
  state.nextToolCallIndex++;

  return [
    makeChatDeltaChunk(state, {
      tool_calls: [
        {
          index: idx,
          id: evt.item.call_id,
          type: 'function',
          function: {
            name: evt.item.name ?? '',
          },
        },
      ],
    }),
  ];
}

function resToChatHandleFuncArgsDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  if (evt.delta === '') {
    return [];
  }

  const idx = state.outputIndexToToolIndex.get(evt.output_index ?? 0);
  if (idx === undefined) {
    return [];
  }

  return [
    makeChatDeltaChunk(state, {
      tool_calls: [
        {
          index: idx,
          function: {
            name: '',
            arguments: evt.delta,
          },
        },
      ],
    }),
  ];
}

function resToChatHandleReasoningDelta(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  if (evt.delta === '') {
    return [];
  }
  const reasoning = evt.delta;
  return [makeChatDeltaChunk(state, { reasoning_content: reasoning })];
}

function resToChatHandleCompleted(
  evt: ResponsesStreamEvent,
  state: ResponsesEventToChatState,
): ChatCompletionsChunk[] {
  state.finalized = true;
  let finishReason = 'stop';

  if (evt.usage !== undefined) {
    state.usage = chatUsageFromResponsesUsage(evt.usage);
  }
  if (evt.response !== undefined) {
    if (evt.response.usage !== undefined) {
      state.usage = chatUsageFromResponsesUsage(evt.response.usage);
    }

    switch (evt.response.status) {
      case 'incomplete':
        if (
          evt.response.incomplete_details !== undefined &&
          evt.response.incomplete_details.reason === 'max_output_tokens'
        ) {
          finishReason = 'length';
        }
        break;
      case 'completed':
        if (state.sawToolCall) {
          finishReason = 'tool_calls';
        }
        break;
    }
  } else if (state.sawToolCall) {
    finishReason = 'tool_calls';
  }

  const chunks: ChatCompletionsChunk[] = [
    makeChatFinishChunk(state, finishReason),
  ];

  if (state.includeUsage && state.usage !== undefined) {
    chunks.push({
      id: state.id,
      object: 'chat.completion.chunk',
      created: state.created,
      model: state.model,
      choices: [],
      usage: state.usage,
    });
  }

  return chunks;
}

export function chatUsageFromResponsesUsage(
  u: ResponsesUsage | undefined,
): ChatUsage | undefined {
  if (u === undefined) {
    return undefined;
  }
  const usage: ChatUsage = {
    prompt_tokens: u.input_tokens,
    completion_tokens: u.output_tokens,
    total_tokens: u.input_tokens + u.output_tokens,
  };
  usage.prompt_tokens_details = promptDetailsFromResponses(
    u.input_tokens_details,
  );
  usage.completion_tokens_details = completionDetailsFromResponses(
    u.output_tokens_details,
  );
  return usage;
}

function promptDetailsFromResponses(
  src: ResponsesInputTokensDetails | undefined,
): ChatTokenDetails | undefined {
  if (src === undefined) {
    return undefined;
  }
  if (src.cached_tokens === 0 && src.audio_tokens === 0) {
    return undefined;
  }
  return {
    cached_tokens: src.cached_tokens,
    audio_tokens: src.audio_tokens,
  };
}

function completionDetailsFromResponses(
  src: ResponsesOutputTokensDetails | undefined,
): ChatTokenDetails | undefined {
  if (src === undefined) {
    return undefined;
  }
  if (
    src.reasoning_tokens === 0 &&
    src.audio_tokens === 0 &&
    src.accepted_prediction_tokens === 0 &&
    src.rejected_prediction_tokens === 0
  ) {
    return undefined;
  }
  return {
    reasoning_tokens: src.reasoning_tokens,
    audio_tokens: src.audio_tokens,
    accepted_prediction_tokens: src.accepted_prediction_tokens,
    rejected_prediction_tokens: src.rejected_prediction_tokens,
  };
}

function makeChatDeltaChunk(
  state: ResponsesEventToChatState,
  delta: ChatDelta,
): ChatCompletionsChunk {
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: null,
      },
    ],
  };
}

function makeChatFinishChunk(
  state: ResponsesEventToChatState,
  finishReason: string,
): ChatCompletionsChunk {
  const empty = '';
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta: { content: empty },
        finish_reason: finishReason,
      },
    ],
  };
}

function randomHex(byteLength: number): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateChatCmplId(): string {
  return `chatcmpl-${randomHex(12)}`;
}

// ---------------------------------------------------------------------------
// BufferedResponseAccumulator
// ---------------------------------------------------------------------------

interface BufferedFuncCall {
  callId: string;
  name: string;
  args: string;
}

export class BufferedResponseAccumulator {
  private text = '';
  private reasoning = '';
  private funcCalls: BufferedFuncCall[] = [];
  private outputIndexToFuncIdx = new Map<number, number>();

  processEvent(event: ResponsesStreamEvent): void {
    switch (event.type) {
      case 'response.output_text.delta':
        if (event.delta !== '') {
          this.text += event.delta;
        }
        break;
      case 'response.output_item.added':
        if (
          event.item !== undefined &&
          event.item.type === 'function_call'
        ) {
          const idx = this.funcCalls.length;
          this.outputIndexToFuncIdx.set(event.output_index ?? 0, idx);
          this.funcCalls.push({
            callId: event.item.call_id ?? '',
            name: event.item.name ?? '',
            args: '',
          });
        }
        break;
      case 'response.function_call_arguments.delta':
        if (event.delta !== '') {
          const idx = this.outputIndexToFuncIdx.get(event.output_index ?? 0);
          if (idx !== undefined) {
            const fc = this.funcCalls[idx];
            if (fc !== undefined) {
              fc.args += event.delta;
            }
          }
        }
        break;
      case 'response.reasoning_summary_text.delta':
        if (event.delta !== '') {
          this.reasoning += event.delta;
        }
        break;
    }
  }

  hasContent(): boolean {
    return (
      this.text.length > 0 ||
      this.funcCalls.length > 0 ||
      this.reasoning.length > 0
    );
  }

  buildOutput(): ResponsesOutput[] {
    const out: ResponsesOutput[] = [];

    if (this.reasoning.length > 0) {
      out.push({
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: this.reasoning }],
      });
    }

    if (this.text.length > 0) {
      out.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: this.text }],
      });
    }

    for (const fc of this.funcCalls) {
      out.push({
        type: 'function_call',
        call_id: fc.callId,
        name: fc.name,
        arguments: fc.args,
      });
    }

    return out;
  }

  supplementResponseOutput(resp: ResponsesResponse | undefined): void {
    if (resp === undefined || (resp.output?.length ?? 0) > 0) {
      return;
    }
    if (!this.hasContent()) {
      return;
    }
    resp.output = this.buildOutput();
  }
}

export function newBufferedResponseAccumulator(): BufferedResponseAccumulator {
  return new BufferedResponseAccumulator();
}
