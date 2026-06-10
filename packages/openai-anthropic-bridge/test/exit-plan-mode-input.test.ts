import { describe, expect, test } from 'bun:test';
import {
  newResponsesEventToAnthropicState,
  responsesEventToAnthropicEvents,
  responsesToAnthropic,
  sanitizeAnthropicToolUseInput,
  sanitizeExitPlanModeInlinePlanJson,
} from '../src/responses-to-anthropic.js';

describe('ExitPlanMode inline plan stripping', () => {
  test('sanitizeAnthropicToolUseInput removes inline plan bodies for ExitPlanMode', () => {
    expect(
      sanitizeAnthropicToolUseInput(
        'ExitPlanMode',
        JSON.stringify({
          plan: '# Big plan\n\n'.repeat(200),
          planContent: 'ignored',
          allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
        }),
      ),
    ).toEqual({
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    });
  });

  test('responsesToAnthropic strips inline plan from ExitPlanMode function_call', () => {
    const anthropic = responsesToAnthropic(
      {
        id: 'resp_plan',
        object: 'response',
        model: 'gpt-5.5',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            call_id: 'call_plan',
            name: 'ExitPlanMode',
            arguments: JSON.stringify({
              plan: '# Plan body',
              allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
            }),
          },
        ],
      },
      'gpt-5.5',
      ['ExitPlanMode'],
    );
    const toolUse = anthropic.content.find((block) => block.type === 'tool_use');
    expect(toolUse?.name).toBe('ExitPlanMode');
    expect(toolUse?.input).toEqual({
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    });
  });

  test('stream converter buffers ExitPlanMode args and emits sanitized metadata only', () => {
    const state = newResponsesEventToAnthropicState(['ExitPlanMode']);
    const events: ReturnType<typeof responsesEventToAnthropicEvents> = [];

    const push = (evt: Parameters<typeof responsesEventToAnthropicEvents>[0]) => {
      events.push(...responsesEventToAnthropicEvents(evt, state));
    };

    push({
      type: 'response.created',
      response: { id: 'resp_stream', model: 'gpt-5.5' },
    });
    push({
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        type: 'function_call',
        call_id: 'call_stream',
        name: 'ExitPlanMode',
        arguments: '',
      },
    });
    push({
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: JSON.stringify({
        plan: '# Plan body',
        allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
      }).slice(0, 20),
    });
    push({
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      delta: JSON.stringify({
        plan: '# Plan body',
        allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
      }).slice(20),
    });
    push({
      type: 'response.function_call_arguments.done',
      output_index: 0,
      arguments: JSON.stringify({
        plan: '# Plan body',
        allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
      }),
    });
    push({
      type: 'response.completed',
      response: {
        id: 'resp_stream',
        status: 'completed',
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
    });

    const toolDeltas = events.filter(
      (event) =>
        event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta',
    );
    expect(toolDeltas).toHaveLength(1);
    expect(sanitizeExitPlanModeInlinePlanJson(toolDeltas[0]?.delta?.partial_json ?? '')).toBe(
      JSON.stringify({ allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] }),
    );
    expect(
      toolDeltas.every((event) => !event.delta?.partial_json?.includes('# Plan body')),
    ).toBe(true);
  });
});
