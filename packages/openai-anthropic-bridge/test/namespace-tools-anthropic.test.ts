import { describe, expect, test } from 'bun:test';
import {
  anthropicToResponsesResponse,
  buildCodexToolContextFromRequest,
  responsesToAnthropicRequest,
  type ResponsesRequest,
} from '../src/index.js';

describe('namespace tools Responses ↔ Anthropic', () => {
  const collaborationToolsRequest: ResponsesRequest = {
    model: 'deepseek-v4-flash',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'spawn' }] }],
    tools: [
      { type: 'function', name: 'exec_command', parameters: { type: 'object', properties: {} } },
      {
        type: 'namespace',
        name: 'collaboration',
        tools: [
          {
            type: 'function',
            name: 'spawn_agent',
            description: 'Spawn a subagent',
            parameters: {
              type: 'object',
              properties: { agent_type: { type: 'string' } },
              required: ['agent_type'],
            },
          },
          {
            type: 'function',
            name: 'wait_agent',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ],
  };

  test('flattens collaboration namespace into Anthropic client tools', () => {
    const anthropic = responsesToAnthropicRequest(collaborationToolsRequest);
    const names = (anthropic.tools ?? []).map((tool) => tool.name);
    expect(names).toContain('exec_command');
    expect(names).toContain('collaboration__spawn_agent');
    expect(names).toContain('collaboration__wait_agent');
    expect(names.some((name) => name === 'collaboration')).toBe(false);
  });

  test('restores namespace on function_call when Anthropic returns flattened tool name', () => {
    const toolContext = buildCodexToolContextFromRequest(collaborationToolsRequest);
    const responses = anthropicToResponsesResponse(
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'deepseek-v4-flash',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_spawn',
            name: 'collaboration__spawn_agent',
            input: { agent_type: 'explorer' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      toolContext,
    );
    const call = responses.output?.find((item) => item.type === 'function_call');
    expect(call).toMatchObject({
      type: 'function_call',
      name: 'spawn_agent',
      namespace: 'collaboration',
    });
  });
});
