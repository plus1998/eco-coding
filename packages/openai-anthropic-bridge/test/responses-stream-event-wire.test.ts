import { describe, expect, test } from 'bun:test';
import { jsonParse } from '../src/json.js';
import { responsesStreamEventToJSON } from '../src/responses-stream-event-wire.js';
import type { ResponsesStreamEvent } from '../src/types.js';

describe('responsesStreamEventToJSON', () => {
  test('output_text.delta includes zero indexes', () => {
    const evt: ResponsesStreamEvent = {
      type: 'response.output_text.delta',
      sequence_number: 1,
      output_index: 0,
      content_index: 0,
      delta: 'hi',
      item_id: 'msg_1',
    };
    const parsed = jsonParse<Record<string, unknown>>(responsesStreamEventToJSON(evt));
    expect(parsed.output_index).toBe(0);
    expect(parsed.content_index).toBe(0);
    expect(parsed.delta).toBe('hi');
  });

  test('function_call_arguments.done includes empty arguments', () => {
    const evt: ResponsesStreamEvent = {
      type: 'response.function_call_arguments.done',
      sequence_number: 2,
      output_index: 0,
      call_id: 'call_1',
      name: 'foo',
      arguments: '',
      item_id: 'item_1',
    };
    const parsed = jsonParse<Record<string, unknown>>(responsesStreamEventToJSON(evt));
    expect(parsed.arguments).toBe('');
    expect(parsed.call_id).toBe('call_1');
  });

  test('output_item.added message has content array', () => {
    const evt: ResponsesStreamEvent = {
      type: 'response.output_item.added',
      sequence_number: 0,
      output_index: 0,
      item: {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'in_progress',
        content: [{ type: 'output_text', text: '' }],
      },
    };
    const parsed = jsonParse<Record<string, unknown>>(responsesStreamEventToJSON(evt));
    const item = parsed.item as Record<string, unknown>;
    expect(Array.isArray(item.content)).toBe(true);
  });
});
