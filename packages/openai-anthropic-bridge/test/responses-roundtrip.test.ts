import { describe, expect, test } from 'bun:test';
import { anthropicToResponses } from '../src/anthropic-to-responses.js';
import { responsesToAnthropicRequest } from '../src/responses-to-anthropic-request.js';
import { chatCompletionsToResponses } from '../src/chat-completions-to-responses.js';
import { responsesToChatCompletions } from '../src/responses-to-chat-completions.js';
import type { ChatCompletionsRequest, ResponsesResponse } from '../src/types.js';

describe('roundtrip', () => {
  test('chat completions text roundtrip via responses hub', () => {
    const chatReq: ChatCompletionsRequest = {
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      stream: false,
    };

    const responsesReq = chatCompletionsToResponses(chatReq);
    const upstreamStyle: ResponsesResponse = {
      id: 'resp_1',
      object: 'response',
      model: 'gpt-5.2',
      status: 'completed',
      output: [
        {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: 'Hi there!' }],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
      },
    };

    const chatResp = responsesToChatCompletions(upstreamStyle, 'gpt-5.2');
    expect(chatResp.choices[0]?.message.content).toBeDefined();
    const content =
      typeof chatResp.choices[0]?.message.content === 'string'
        ? chatResp.choices[0].message.content
        : JSON.stringify(chatResp.choices[0]?.message.content);
    expect(content).toContain('Hi there!');
  });

  test('anthropic request converts to anthropic-shaped request via responses', () => {
    const responsesReq = anthropicToResponses({
      model: 'claude-sonnet-4',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'Ping' }],
      output_config: { effort: 'high' },
    });

    const back = responsesToAnthropicRequest(responsesReq);
    expect(back.model).toBe('claude-sonnet-4');
    expect(back.max_tokens).toBe(256);
    expect(back.messages.length).toBeGreaterThan(0);
  });
});
