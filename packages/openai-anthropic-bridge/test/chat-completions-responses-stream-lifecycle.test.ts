import { describe, expect, test } from 'bun:test';
import { jsonParse } from '../src/json.js';
import {
  chatCompletionsChunkToResponsesEvents,
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
