import { describe, expect, test } from 'bun:test';
import { anthropicToResponses } from '../src/anthropic-to-responses.js';
import { jsonParse } from '../src/json.js';
import type { ResponsesContentPart, ResponsesInputItem } from '../src/types.js';

describe('anthropicToResponses', () => {
  test('basic text user message', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 1024,
      stream: true,
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(resp.model).toBe('gpt-5.2');
    expect(resp.stream).toBe(true);
    expect(resp.max_output_tokens).toBe(1024);
    expect(resp.store).toBe(false);

    const items = jsonParse<ResponsesInputItem[]>(resp.input as string);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('message');
    expect(items[0]?.role).toBe('user');
    const parts = jsonParse<ResponsesContentPart[]>(items[0]?.content as string);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe('input_text');
    expect(parts[0]?.text).toBe('Hello');
  });

  test('system prompt as developer message', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      system: 'You are helpful.',
    });

    const items = jsonParse<ResponsesInputItem[]>(resp.input as string);
    expect(items).toHaveLength(2);
    expect(items[0]?.role).toBe('developer');
    const parts = jsonParse<ResponsesContentPart[]>(items[0]?.content as string);
    expect(parts[0]?.text).toBe('You are helpful.');
  });

  test('skips anthropic billing header in system', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'Hi' }],
      system: [
        { type: 'text', text: 'x-anthropic-billing-header: cc_version=1;' },
        { type: 'text', text: 'Project prompt' },
      ],
    });

    const items = jsonParse<ResponsesInputItem[]>(resp.input as string);
    const parts = jsonParse<ResponsesContentPart[]>(items[0]?.content as string);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.text).toBe('Project prompt');
  });

  test('tool use round-trip shape', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'get_weather',
              input: { city: 'NYC' },
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'Sunny, 72°F' }],
        },
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
    });

    const items = jsonParse<ResponsesInputItem[]>(resp.input as string);
    const fc = items.find((i) => i.type === 'function_call');
    expect(fc?.call_id).toBe('call_1');
    expect(fc?.name).toBe('get_weather');
    const out = items.find((i) => i.type === 'function_call_output');
    expect(out?.output).toContain('Sunny');
  });

  test('omits reasoning when thinking is disabled', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'disabled' },
    });

    expect(resp.reasoning).toBeUndefined();
  });

  test('maps output_config effort to reasoning', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      output_config: { effort: 'high' },
    });

    expect(resp.reasoning).toEqual({ effort: 'high', summary: 'auto' });
  });

  test('maps top-level effort to reasoning and max to xhigh', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
      effort: 'max',
      thinking: { type: 'adaptive' },
    });

    expect(resp.reasoning).toEqual({ effort: 'xhigh', summary: 'auto' });
  });

  test('omits reasoning when no effort is configured', () => {
    const resp = anthropicToResponses({
      model: 'gpt-5.2',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(resp.reasoning).toBeUndefined();
  });
});
