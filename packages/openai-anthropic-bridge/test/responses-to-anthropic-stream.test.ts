import { describe, expect, test } from 'bun:test';
import {
  newResponsesEventToAnthropicState,
  responsesAnthropicEventToSse,
  responsesEventToAnthropicEvents,
  validateAnthropicStreamEvents,
} from '../src/index.js';
import type { ResponsesStreamEvent } from '../src/types.js';

/** Ported from sub2api anthropic_responses_test.go (streaming unit tests) */
describe('responses → anthropic stream events (sub2api parity)', () => {
  test('text delta emits content_block_start with empty text field', () => {
    const state = newResponsesEventToAnthropicState();
    const push = (evt: ResponsesStreamEvent) => responsesEventToAnthropicEvents(evt, state);
    const events = [
      ...push({
        type: 'response.created',
        response: { id: 'r1', model: 'm', status: 'in_progress', output: [] },
      }),
      ...push({ type: 'response.output_text.delta', output_index: 0, delta: 'Hello' }),
      ...push({ type: 'response.output_text.done', output_index: 0 }),
      ...push({
        type: 'response.completed',
        response: { id: 'r1', model: 'm', status: 'completed', output: [] },
      }),
    ];
    const start = events.find((e) => e.type === 'content_block_start');
    expect(start?.content_block?.type).toBe('text');
    expect(start?.content_block?.text).toBe('');
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });

  test('thinking block start includes empty thinking on wire', () => {
    const state = newResponsesEventToAnthropicState();
    const events = responsesEventToAnthropicEvents(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'reasoning', id: 'ri_1' },
      },
      state,
    );
    expect(events[0]?.type).toBe('content_block_start');
    const sse = responsesAnthropicEventToSse(events[0]!);
    expect(sse).toContain('"thinking":""');
    expect(sse).toContain('"type":"thinking"');
  });

  test('full text stream sequence: start → delta → stop → message_stop', () => {
    const state = newResponsesEventToAnthropicState();
    const push = (evt: ResponsesStreamEvent) => responsesEventToAnthropicEvents(evt, state);

    let all = push({
      type: 'response.created',
      response: { id: 'r1', model: 'm', status: 'in_progress', output: [] },
    });
    all = [...all, ...push({ type: 'response.output_text.delta', output_index: 0, delta: 'Hello' })];
    all = [...all, ...push({ type: 'response.output_text.delta', output_index: 0, delta: ' world' })];
    all = [...all, ...push({ type: 'response.output_text.done', output_index: 0 })];
    all = [
      ...all,
      ...push({
        type: 'response.completed',
        response: {
          id: 'r1',
          model: 'm',
          status: 'completed',
          output: [],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      }),
    ];

    expect(all.filter((e) => e.type === 'content_block_start').length).toBe(1);
    expect(all.filter((e) => e.type === 'content_block_delta').length).toBe(2);
    expect(all.filter((e) => e.type === 'content_block_stop').length).toBe(1);
    expect(all.some((e) => e.type === 'message_stop')).toBe(true);
    expect(validateAnthropicStreamEvents(all)).toEqual([]);
  });

  test('tool_use block uses input {} on start', () => {
    const state = newResponsesEventToAnthropicState();
    const events = responsesEventToAnthropicEvents(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'item_1',
          call_id: 'call_abc',
          name: 'Read',
        },
      },
      state,
    );
    const start = events.find((e) => e.type === 'content_block_start');
    expect(start?.content_block?.type).toBe('tool_use');
    expect(start?.content_block?.input).toEqual({});
    const sse = responsesAnthropicEventToSse(start!);
    expect(sse).toContain('"input":{}');
  });
});
