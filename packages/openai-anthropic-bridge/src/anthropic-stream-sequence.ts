import type { AnthropicStreamEvent } from './types.js';

export interface AnthropicStreamSequenceState {
  /** Block indices that received content_block_start and not yet stopped. */
  readonly open: Set<number>;
  /** Block indices that received content_block_stop. */
  readonly stopped: Set<number>;
}

export function newAnthropicStreamSequenceState(): AnthropicStreamSequenceState {
  return { open: new Set(), stopped: new Set() };
}

/**
 * Validates Anthropic SSE events the Claude Agent SDK expects.
 * Returns a human-readable violation, or undefined when the event is OK so far.
 */
export function checkAnthropicStreamEvent(
  state: AnthropicStreamSequenceState,
  evt: AnthropicStreamEvent,
): string | undefined {
  const index = evt.index;
  if (evt.type === 'content_block_start') {
    if (index === undefined || index < 0) {
      return 'content_block_start 缺少 index';
    }
    if (state.open.has(index) || state.stopped.has(index)) {
      return `content_block_start 重复或已关闭的 index=${index}`;
    }
    state.open.add(index);
    return undefined;
  }

  if (evt.type === 'content_block_delta') {
    if (index === undefined || index < 0) {
      return 'content_block_delta 缺少 index';
    }
    if (!state.open.has(index)) {
      return `content_block_delta 无对应 content_block_start（index=${index}）`;
    }
    return undefined;
  }

  if (evt.type === 'content_block_stop') {
    if (index === undefined || index < 0) {
      return 'content_block_stop 缺少 index';
    }
    if (!state.open.has(index)) {
      return `content_block_stop 无对应 content_block_start（index=${index}）`;
    }
    state.open.delete(index);
    state.stopped.add(index);
    return undefined;
  }

  return undefined;
}

export function validateAnthropicStreamEvents(events: AnthropicStreamEvent[]): string[] {
  const state = newAnthropicStreamSequenceState();
  const violations: string[] = [];
  for (const evt of events) {
    const issue = checkAnthropicStreamEvent(state, evt);
    if (issue) {
      violations.push(`${evt.type}: ${issue}`);
    }
  }
  if (state.open.size > 0) {
    violations.push(`流结束仍有未关闭的 content block: ${[...state.open].join(', ')}`);
  }
  return violations;
}
