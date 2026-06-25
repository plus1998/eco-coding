import { describe, expect, test } from 'bun:test';
import { jsonParse } from '../src/json.js';
import {
  chatCompletionsChunkToResponsesEvents,
  finalizeChatCompletionsResponsesStream,
  finalizeResponsesAnthropicStream,
  newChatCompletionsToResponsesStreamState,
  newResponsesEventToAnthropicState,
  responsesAnthropicEventToSse,
  responsesEventToAnthropicEvents,
  validateAnthropicStreamEvents,
} from '../src/index.js';
import type { AnthropicStreamEvent, ChatCompletionsChunk } from '../src/types.js';

function pipeChatStreamToAnthropicEvents(
  chunks: ChatCompletionsChunk[],
  model = 'deepseek-v4-flash-free',
): AnthropicStreamEvent[] {
  const ccState = newChatCompletionsToResponsesStreamState(model);
  const anthState = newResponsesEventToAnthropicState();
  const out: AnthropicStreamEvent[] = [];

  const pushResponses = (events: ReturnType<typeof chatCompletionsChunkToResponsesEvents>) => {
    for (const resEvt of events) {
      out.push(...responsesEventToAnthropicEvents(resEvt, anthState));
    }
  };

  for (const chunk of chunks) {
    pushResponses(chatCompletionsChunkToResponsesEvents(chunk, ccState));
  }
  pushResponses(finalizeChatCompletionsResponsesStream(ccState));
  out.push(...finalizeResponsesAnthropicStream(anthState));
  return out;
}

function pipeJsonChunksToAnthropicEvents(payloads: string[]): AnthropicStreamEvent[] {
  const chunks = payloads.map((p) => jsonParse<ChatCompletionsChunk>(p));
  return pipeChatStreamToAnthropicEvents(chunks);
}

describe('chat stream → anthropic SSE sequence', () => {
  test('tool-only stream has valid content_block indices', () => {
    const chunks: ChatCompletionsChunk[] = [
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_abc',
                  type: 'function',
                  function: { name: 'Read', arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"file_path":"' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'README.md"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ];

    const events = pipeChatStreamToAnthropicEvents(chunks);
    const violations = validateAnthropicStreamEvents(events);
    expect(violations).toEqual([]);
    expect(events.some((e) => e.type === 'content_block_start')).toBe(true);
    expect(events.some((e) => e.type === 'message_stop')).toBe(true);
  });

  test('reasoning then tool stream has valid sequence', () => {
    const chunks: ChatCompletionsChunk[] = [
      {
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: 'Scanning ' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: 'repo.',
              tool_calls: [
                {
                  index: 0,
                  id: 'call_grep',
                  type: 'function',
                  function: { name: 'Grep', arguments: '{"pattern":"auth"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    ];

    const events = pipeChatStreamToAnthropicEvents(chunks);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });

  test('delta.reasoning field is accepted like reasoning_content', () => {
    const chunks: ChatCompletionsChunk[] = [
      {
        id: 'chatcmpl-3',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: { reasoning: 'think' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-3',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'deepseek-v4-flash-free',
        choices: [
          {
            index: 0,
            delta: { content: 'answer' },
            finish_reason: 'stop',
          },
        ],
      },
    ];

    const events = pipeChatStreamToAnthropicEvents(chunks);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
    expect(events.some((e) => e.type === 'content_block_start' && e.content_block?.type === 'thinking')).toBe(
      true,
    );
  });

  test('llama.cpp: Read tool args split across chunks keep a single opening brace', () => {
    const events = pipeJsonChunksToAnthropicEvents([
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_r","type":"function","function":{"name":"Read","arguments":"{"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"file_path\\":\\"README.md\\"}"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
    ]);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
    const toolDeltas = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta',
    );
    expect(toolDeltas).toHaveLength(1);
    expect(JSON.parse(toolDeltas[0]?.delta?.partial_json ?? '{}')).toEqual({
      file_path: 'README.md',
    });
  });

  test('llama.cpp: literal null content is not forwarded as assistant text', () => {
    const events = pipeJsonChunksToAnthropicEvents([
      `{"choices":[{"index":0,"delta":{"content":null}}]}`,
      `{"choices":[{"index":0,"delta":{"content":"null"}}]}`,
      `{"choices":[{"index":0,"delta":{"content":"hello"}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
    ]);
    const textDeltas = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta',
    );
    expect(textDeltas.map((e) => e.delta?.text)).toEqual(['hello']);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });

  test('sub2api: empty leading reasoning_content does not break later deltas', () => {
    const events = pipeJsonChunksToAnthropicEvents([
      `{"choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}`,
      `{"choices":[{"index":0,"delta":{"reasoning_content":"think"}}]}`,
      `{"choices":[{"index":0,"delta":{"content":"hello"}}]}`,
      `{"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}]}`,
    ]);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
    const textStart = events.find(
      (e) => e.type === 'content_block_start' && e.content_block?.type === 'text',
    );
    expect(textStart?.content_block?.text).toBe('');
  });

  test('sub2api: exec tool stream completes with valid anthropic sequence', () => {
    const events = pipeJsonChunksToAnthropicEvents([
      `{"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"plan"}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"exec","arguments":""}}]}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"ls\\"}"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
    ]);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
    expect(events.some((e) => e.type === 'message_delta' && e.delta?.stop_reason === 'tool_use')).toBe(
      true,
    );
  });

  test('mimo-style: content after tool_calls in stream does not break tool block index', () => {
    const chunks: ChatCompletionsChunk[] = [
      {
        id: 'chatcmpl-mimo',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'mimo-v2.5-free',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: 'plan ' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-mimo',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'mimo-v2.5-free',
        choices: [
          {
            index: 0,
            delta: { content: 'draft ' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-mimo',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'mimo-v2.5-free',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_x',
                  type: 'function',
                  function: { name: 'Read', arguments: '{"file_path":"' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-mimo',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'mimo-v2.5-free',
        choices: [
          {
            index: 0,
            delta: {
              content: 'trailing ',
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: 'a.ts"}' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-mimo',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'mimo-v2.5-free',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'tool_calls',
          },
        ],
      },
    ];

    const events = pipeChatStreamToAnthropicEvents(chunks);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
    const toolStarts = events.filter(
      (e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use',
    );
    expect(toolStarts.length).toBe(1);
    const toolIdx = toolStarts[0]?.index;
    const toolDeltas = events.filter(
      (e) =>
        e.type === 'content_block_delta' &&
        e.delta?.type === 'input_json_delta' &&
        e.index === toolIdx,
    );
    expect(toolDeltas.length).toBeGreaterThan(0);
  });

  test('finalize message output_text.done does not close open tool_use block', () => {
    const ccState = newChatCompletionsToResponsesStreamState('mimo-v2.5-free');
    const anthState = newResponsesEventToAnthropicState();
    const events: AnthropicStreamEvent[] = [];

    const push = (resEvts: ReturnType<typeof chatCompletionsChunkToResponsesEvents>) => {
      for (const resEvt of resEvts) {
        events.push(...responsesEventToAnthropicEvents(resEvt, anthState));
      }
    };

    push(
      chatCompletionsChunkToResponsesEvents(
        {
          id: 'c1',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'mimo-v2.5-free',
          choices: [
            {
              index: 0,
              delta: { content: 'hi' },
              finish_reason: null,
            },
          ],
        },
        ccState,
      ),
    );
    push(
      chatCompletionsChunkToResponsesEvents(
        {
          id: 'c1',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'mimo-v2.5-free',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_y',
                    type: 'function',
                    function: { name: 'Grep', arguments: '{"pattern":"x"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
        ccState,
      ),
    );
    push(finalizeChatCompletionsResponsesStream(ccState));
    events.push(...finalizeResponsesAnthropicStream(anthState));

    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });

  test('text content_block_start on wire includes empty text (SDK #1528)', () => {
    const events = pipeJsonChunksToAnthropicEvents([
      `{"choices":[{"index":0,"delta":{"content":"hi"}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
    ]);
    const start = events.find(
      (e) => e.type === 'content_block_start' && e.content_block?.type === 'text',
    );
    expect(start).toBeDefined();
    const sse = responsesAnthropicEventToSse(start!);
    expect(sse).toContain('"text":""');
  });
});
