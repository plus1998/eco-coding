import { describe, expect, test } from 'bun:test';
import { jsonParse } from '../src/json.js';
import {
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  finalizeChatCompletionsResponsesStream,
  newChatCompletionsToResponsesStreamState,
} from '../src/chat-completions-responses-bridge.js';
import { responsesEventToSse } from '../src/anthropic-to-responses-response.js';
import { responsesStreamEventToJSON } from '../src/responses-stream-event-wire.js';
import type { ChatCompletionsChunk, ResponsesStreamEvent } from '../src/types.js';

/** Ported from sub2api chatcompletions_responses_stream_lifecycle_test.go */
function collectResponsesStreamEvents(chunkPayloads: string[]): ResponsesStreamEvent[] {
  const state = newChatCompletionsToResponsesStreamState('deepseek-v4-pro');
  const events: ResponsesStreamEvent[] = [];
  for (const payload of chunkPayloads) {
    const chunk = jsonParse<ChatCompletionsChunk>(payload);
    events.push(...chatCompletionsChunkToResponsesEvents(chunk, state));
  }
  events.push(...finalizeChatCompletionsResponsesStream(state));
  return events;
}

describe('chat completions stream → responses lifecycle (sub2api parity)', () => {
  test('maps token-limit finish reason variants to response.incomplete', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"max_tokens"}]}`,
    ]);

    expect(events.at(-1)).toMatchObject({
      type: 'response.incomplete',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      },
    });
  });

  test('treats a stream without finish_reason as failed', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}`,
    ]);

    expect(events.at(-1)).toMatchObject({
      type: 'response.failed',
      response: {
        status: 'failed',
        error: { code: 'missing_finish_reason' },
      },
    });
  });

  test('non-stream conversion does not mark unknown finish reasons completed', () => {
    const response = chatCompletionsResponseToResponses(
      {
        id: 'chatcmpl-unknown',
        object: 'chat.completion',
        created: 1,
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'partial' },
            finish_reason: 'max_output_tokens',
          },
        ],
      },
      'deepseek-v4-flash',
    );

    expect(response).toMatchObject({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
  });

  test('non-stream conversion rejects a response without choices', () => {
    const response = chatCompletionsResponseToResponses(
      {
        id: 'chatcmpl-empty',
        object: 'chat.completion',
        created: 1,
        model: 'deepseek-v4-flash',
        choices: [],
      },
      'deepseek-v4-flash',
    );

    expect(response).toMatchObject({
      status: 'failed',
      error: { code: 'missing_choices' },
    });
  });

  test('reasoning output_item opens before first reasoning delta', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}`,
      `{"choices":[{"index":0,"delta":{"reasoning_content":"think"}}]}`,
      `{"choices":[{"index":0,"delta":{"content":"hello"}}]}`,
      `{"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`,
    ]);

    const open = new Map<number, string>();
    for (const e of events) {
      if (e.type === 'response.output_item.added' && e.item?.type) {
        open.set(e.output_index ?? 0, e.item.type);
      }
      if (e.type === 'response.reasoning_summary_text.delta') {
        expect(open.get(e.output_index ?? 0)).toBe('reasoning');
      }
      if (e.type === 'response.output_text.delta') {
        expect(open.get(e.output_index ?? 0)).toBe('message');
      }
    }
  });

  test('tool call lifecycle includes arguments.done and output_item.done', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"plan"}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"exec","arguments":""}}]}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"ls\\"}"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`,
    ]);

    let sawAdded = false;
    let sawArgsDone = false;
    let sawItemDone = false;
    for (const e of events) {
      if (e.type === 'response.output_item.added' && e.item?.type === 'function_call') {
        sawAdded = true;
      }
      if (e.type === 'response.function_call_arguments.done') {
        sawArgsDone = true;
        expect(e.arguments).toBe('{"cmd":"ls"}');
      }
      if (e.type === 'response.output_item.done' && e.item?.type === 'function_call') {
        sawItemDone = true;
        expect(e.item.arguments).toBe('{"cmd":"ls"}');
        expect(e.item.call_id).toBe('call_a');
      }
    }
    expect(sawAdded).toBe(true);
    expect(sawArgsDone).toBe(true);
    expect(sawItemDone).toBe(true);
  });

  test('preserves a non-zero-indexed tool call emitted alongside assistant text', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"content":"Let me implement this."},"finish_reason":null}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_plan","type":"function","function":{"name":"update_plan","arguments":""}}]},"finish_reason":null}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"plan\\":[]}"}}]},"finish_reason":null}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
    ]);

    expect(
      events.find(
        (event) =>
          event.type === 'response.output_item.done' && event.item?.type === 'function_call',
      ),
    ).toMatchObject({
      item: {
        call_id: 'call_plan',
        name: 'update_plan',
        arguments: '{"plan":[]}',
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: expect.arrayContaining([
          expect.objectContaining({
            type: 'function_call',
            call_id: 'call_plan',
            name: 'update_plan',
            arguments: '{"plan":[]}',
          }),
        ]),
      },
    });
  });

  test('argument-only deltas with null name must not wipe tool name on done', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"exec_command","arguments":""}}]}}]}`,
      // Upstream often omits name on later deltas; JSON null must not clear stored name.
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":null,"arguments":"{\\"cmd\\":"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
    ]);

    const added = events.find(
      (e) => e.type === 'response.output_item.added' && e.item?.type === 'function_call',
    );
    const argsDone = events.find((e) => e.type === 'response.function_call_arguments.done');
    const itemDone = events.find(
      (e) => e.type === 'response.output_item.done' && e.item?.type === 'function_call',
    );

    expect(added?.item?.name).toBe('exec_command');
    expect(argsDone?.name).toBe('exec_command');
    expect(itemDone?.item?.name).toBe('exec_command');
    expect(itemDone?.item?.arguments).toBe('{"cmd":"ls"}');
    expect(itemDone?.item?.call_id).toBe('call_a');
  });

  test('function_call output_item.added wire includes empty arguments and call_id', () => {
    const events = collectResponsesStreamEvents([
      `{"choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"plan"}}]}`,
      `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"exec","arguments":"{}"}}]}}]}`,
      `{"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
    ]);

    let addedWire = '';
    for (const e of events) {
      if (e.type === 'response.output_item.added' && e.item?.type === 'function_call') {
        addedWire = responsesStreamEventToJSON(e);
      }
    }
    expect(addedWire).toContain('"arguments":""');
    expect(addedWire).toContain('"call_id":"call_a"');

    const sse = responsesEventToSse(
      events.find((e) => e.type === 'response.output_item.added' && e.item?.type === 'function_call')!,
    );
    expect(sse).toContain('"arguments":""');
    expect(sse).toContain('"call_id":"call_a"');
  });
});
