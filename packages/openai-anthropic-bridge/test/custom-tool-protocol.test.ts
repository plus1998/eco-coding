import { describe, expect, test } from 'bun:test';
import {
  anthropicEventToResponsesEvents,
  anthropicToResponsesResponse,
  newAnthropicEventToResponsesState,
} from '../src/anthropic-to-responses-response.js';
import {
  chatCompletionsChunkToResponsesEvents,
  chatCompletionsResponseToResponses,
  finalizeChatCompletionsResponsesStream,
  newChatCompletionsToResponsesStreamState,
  responsesToChatCompletionsRequest,
} from '../src/chat-completions-responses-bridge.js';
import { CUSTOM_TOOL_INPUT_FIELD } from '../src/codex-chat-common.js';
import { buildCodexToolContextFromRequest } from '../src/codex-tool-context.js';
import { responsesToAnthropicRequest } from '../src/responses-to-anthropic-request.js';
import type {
  AnthropicResponse,
  AnthropicStreamEvent,
  ChatCompletionsChunk,
  ChatCompletionsResponse,
  ResponsesRequest,
} from '../src/types.js';

const APPLY_PATCH = `*** Begin Patch
*** Add File: hello.txt
+hello
*** End Patch`;

function freeformResponsesRequest(): ResponsesRequest {
  return {
    model: 'eco_route_v1.test',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'edit the file' }],
      },
      {
        type: 'custom_tool_call',
        call_id: 'call_patch_1',
        name: 'apply_patch',
        input: APPLY_PATCH,
      },
      {
        type: 'custom_tool_call_output',
        call_id: 'call_patch_1',
        output: 'ok',
      },
    ],
    tools: [
      {
        type: 'custom',
        name: 'apply_patch',
        description: 'Apply a freeform patch',
      },
      {
        type: 'function',
        name: 'exec_command',
        description: 'Run a shell command',
        parameters: {
          type: 'object',
          properties: { cmd: { type: 'string' } },
          required: ['cmd'],
        },
      },
    ],
  };
}

describe('custom freeform tool protocol', () => {
  test('Chat request wraps custom tools and history as function { input }', () => {
    const chat = responsesToChatCompletionsRequest(freeformResponsesRequest());
    const applyTool = chat.tools?.find((tool) => tool.function?.name === 'apply_patch');
    expect(applyTool?.type).toBe('function');
    expect(applyTool?.function?.parameters).toMatchObject({
      type: 'object',
      required: [CUSTOM_TOOL_INPUT_FIELD],
    });
    expect(chat.tools?.some((tool) => tool.function?.name === 'exec_command')).toBe(true);

    const assistant = chat.messages.find(
      (message) => message.role === 'assistant' && (message.tool_calls?.length ?? 0) > 0,
    );
    expect(assistant?.tool_calls?.[0]).toMatchObject({
      id: 'call_patch_1',
      type: 'function',
      function: {
        name: 'apply_patch',
        arguments: JSON.stringify({ [CUSTOM_TOOL_INPUT_FIELD]: APPLY_PATCH }),
      },
    });
    const toolResult = chat.messages.find((message) => message.role === 'tool');
    expect(toolResult).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_patch_1',
      content: 'ok',
    });
  });

  test('Chat non-stream response restores custom_tool_call', () => {
    const req = freeformResponsesRequest();
    const toolContext = buildCodexToolContextFromRequest(req);
    const chatResp: ChatCompletionsResponse = {
      id: 'chatcmpl_1',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_patch_2',
                type: 'function',
                function: {
                  name: 'apply_patch',
                  arguments: JSON.stringify({ [CUSTOM_TOOL_INPUT_FIELD]: APPLY_PATCH }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const restored = chatCompletionsResponseToResponses(chatResp, 'deepseek', toolContext);
    expect(
      restored.output?.some(
        (item) => item.type === 'custom_tool_call' && item.name === 'apply_patch',
      ),
    ).toBe(true);
    const custom = restored.output?.find((item) => item.type === 'custom_tool_call');
    expect(custom?.input).toBe(APPLY_PATCH);
  });

  test('Chat stream restores custom_tool_call_input.done from fragmented arguments', () => {
    const req = freeformResponsesRequest();
    const toolContext = buildCodexToolContextFromRequest(req);
    const state = newChatCompletionsToResponsesStreamState('deepseek', toolContext);
    const wrapped = JSON.stringify({ [CUSTOM_TOOL_INPUT_FIELD]: APPLY_PATCH });
    const events = [
      ...chatCompletionsChunkToResponsesEvents(
        {
          id: 'chatcmpl_stream',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_patch_3',
                    type: 'function',
                    function: { name: 'apply_patch', arguments: '' },
                  },
                ],
              },
            },
          ],
        } satisfies ChatCompletionsChunk,
        state,
      ),
      ...chatCompletionsChunkToResponsesEvents(
        {
          id: 'chatcmpl_stream',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: wrapped.slice(0, 20),
                    },
                  },
                ],
              },
            },
          ],
        } satisfies ChatCompletionsChunk,
        state,
      ),
      ...chatCompletionsChunkToResponsesEvents(
        {
          id: 'chatcmpl_stream',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'deepseek',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: wrapped.slice(20),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        } satisfies ChatCompletionsChunk,
        state,
      ),
      ...finalizeChatCompletionsResponsesStream(state),
    ];

    expect(events.some((event) => event.type === 'response.custom_tool_call_input.done')).toBe(
      true,
    );
    const done = events.find((event) => event.type === 'response.custom_tool_call_input.done');
    expect(done?.input).toBe(APPLY_PATCH);
    expect(
      events.some(
        (event) =>
          event.type === 'response.output_item.done' && event.item?.type === 'custom_tool_call',
      ),
    ).toBe(true);
    expect(events.some((event) => event.type === 'response.function_call_arguments.delta')).toBe(
      false,
    );
  });

  test('Anthropic request converts custom tools without type:"custom"', () => {
    const anthropic = responsesToAnthropicRequest(freeformResponsesRequest());
    expect(anthropic.tools?.some((tool) => (tool as { type?: string }).type === 'custom')).toBe(
      false,
    );
    const applyTool = anthropic.tools?.find((tool) => tool.name === 'apply_patch');
    expect(applyTool?.input_schema).toMatchObject({
      type: 'object',
      required: [CUSTOM_TOOL_INPUT_FIELD],
    });
    const assistantContent = anthropic.messages.find((message) => message.role === 'assistant')
      ?.content;
    expect(assistantContent).toEqual([
      {
        type: 'tool_use',
        id: 'call_patch_1',
        name: 'apply_patch',
        input: { [CUSTOM_TOOL_INPUT_FIELD]: APPLY_PATCH },
      },
    ]);
    const toolResultContent = anthropic.messages.find(
      (message) =>
        message.role === 'user' &&
        Array.isArray(message.content) &&
        message.content.some((block) => block.type === 'tool_result'),
    )?.content;
    expect(toolResultContent).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'call_patch_1',
        content: 'ok',
      },
    ]);
  });

  test('Anthropic non-stream and stream restore custom_tool_call', () => {
    const toolContext = buildCodexToolContextFromRequest(freeformResponsesRequest());
    const anthropicResp: AnthropicResponse = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'apply_patch',
          input: { [CUSTOM_TOOL_INPUT_FIELD]: APPLY_PATCH },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 2 },
    };
    const nonStream = anthropicToResponsesResponse(anthropicResp, toolContext);
    expect(nonStream.output?.[0]).toMatchObject({
      type: 'custom_tool_call',
      name: 'apply_patch',
      input: APPLY_PATCH,
    });

    const state = newAnthropicEventToResponsesState(toolContext);
    const wrapped = JSON.stringify({ [CUSTOM_TOOL_INPUT_FIELD]: APPLY_PATCH });
    const streamEvents = [
      ...anthropicEventToResponsesEvents(
        {
          type: 'message_start',
          message: {
            id: 'msg_stream',
            type: 'message',
            role: 'assistant',
            model: 'claude',
            content: [],
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        } as AnthropicStreamEvent,
        state,
      ),
      ...anthropicEventToResponsesEvents(
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'toolu_stream',
            name: 'apply_patch',
            input: {},
          },
        } as AnthropicStreamEvent,
        state,
      ),
      ...anthropicEventToResponsesEvents(
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: wrapped.slice(0, 12),
          },
        } as AnthropicStreamEvent,
        state,
      ),
      ...anthropicEventToResponsesEvents(
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: wrapped.slice(12),
          },
        } as AnthropicStreamEvent,
        state,
      ),
      ...anthropicEventToResponsesEvents(
        {
          type: 'content_block_stop',
          index: 0,
        } as AnthropicStreamEvent,
        state,
      ),
    ];
    expect(streamEvents.some((event) => event.type === 'response.custom_tool_call_input.done')).toBe(
      true,
    );
    const done = streamEvents.find((event) => event.type === 'response.custom_tool_call_input.done');
    expect(done?.input).toBe(APPLY_PATCH);
  });

  test('ordinary function tools still round-trip as function_call', () => {
    const req: ResponsesRequest = {
      model: 'm',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      tools: [
        {
          type: 'function',
          name: 'exec_command',
          parameters: {
            type: 'object',
            properties: { cmd: { type: 'string' } },
            required: ['cmd'],
          },
        },
      ],
    };
    const chat = responsesToChatCompletionsRequest(req);
    expect(chat.tools?.[0]?.function?.name).toBe('exec_command');
    const chatResp: ChatCompletionsResponse = {
      id: 'chatcmpl_fn',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            tool_calls: [
              {
                id: 'call_fn',
                type: 'function',
                function: { name: 'exec_command', arguments: '{"cmd":"ls"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const restored = chatCompletionsResponseToResponses(
      chatResp,
      'm',
      buildCodexToolContextFromRequest(req),
    );
    expect(restored.output?.[0]).toMatchObject({
      type: 'function_call',
      name: 'exec_command',
      arguments: '{"cmd":"ls"}',
    });
  });
});
