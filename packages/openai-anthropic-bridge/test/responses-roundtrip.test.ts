import { describe, expect, test } from 'bun:test';
import { anthropicToResponses } from '../src/anthropic-to-responses.js';
import { responsesToAnthropicRequest } from '../src/responses-to-anthropic-request.js';
import { responsesToChatCompletionsRequest, chatCompletionsResponseToResponses } from '../src/chat-completions-responses-bridge.js';
import { responsesToAnthropic } from '../src/responses-to-anthropic.js';
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

  test('anthropic user text survives anthropic → responses → chat completions', () => {
    const responsesReq = anthropicToResponses({
      model: 'glm-5.1',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hi' }],
    });
    responsesReq.stream = false;

    const chatReq = responsesToChatCompletionsRequest(responsesReq);
    expect(chatReq.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  test('chat completions response with null usage details converts safely', () => {
    const raw = {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      model: 'z-ai/glm-5.1',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 6,
        total_tokens: 48,
        completion_tokens: 42,
        prompt_tokens_details: null,
      },
    };

    const responses = chatCompletionsResponseToResponses(raw, raw.model);
    expect(responses.output[0]?.content?.[0]?.text).toBe('pong');
  });

  test('chat completions reasoning field becomes anthropic thinking', () => {
    const raw = {
      id: 'gen-test',
      object: 'chat.completion',
      model: 'xiaomi/mimo',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            reasoning: 'Visible fallback reply',
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    const anthropic = responsesToAnthropic(
      chatCompletionsResponseToResponses(raw, raw.model),
      raw.model,
    );
    expect(anthropic.content).toEqual([
      { type: 'thinking', thinking: 'Visible fallback reply' },
    ]);
  });
});
