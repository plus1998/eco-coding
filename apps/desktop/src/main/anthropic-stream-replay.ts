import {
  responsesAnthropicEventToSse,
  type AnthropicContentBlock,
  type AnthropicResponse,
  type AnthropicStreamEvent,
} from "@eco/openai-anthropic-bridge";

/** Turn a completed Anthropic message into SSE when upstream returned JSON for a stream request. */
export function anthropicResponseToStreamEvents(message: AnthropicResponse): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [
    {
      type: "message_start",
      message: {
        id: message.id,
        type: "message",
        role: "assistant",
        model: message.model,
        content: [],
        stop_reason: "",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    },
  ];

  for (let index = 0; index < message.content.length; index += 1) {
    const block = message.content[index];
    if (!block) {
      continue;
    }
    events.push({
      type: "content_block_start",
      index,
      content_block: contentBlockForStreamStart(block),
    });
    events.push(...contentBlockDeltas(block, index));
    events.push({ type: "content_block_stop", index });
  }

  events.push({
    type: "message_delta",
    delta: { stop_reason: message.stop_reason || "end_turn" },
    usage: message.usage,
  });
  events.push({ type: "message_stop" });
  return events;
}

export function writeAnthropicStreamEvents(
  response: import("node:http").ServerResponse,
  events: AnthropicStreamEvent[],
): void {
  for (const event of events) {
    response.write(responsesAnthropicEventToSse(event));
  }
}

function contentBlockForStreamStart(block: AnthropicContentBlock): AnthropicContentBlock {
  switch (block.type) {
    case "text":
      return { type: "text", text: "" };
    case "thinking":
      return { type: "thinking", thinking: "" };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id ?? "",
        name: block.name ?? "",
        input: {},
      };
    default:
      return { ...block };
  }
}

function contentBlockDeltas(block: AnthropicContentBlock, index: number): AnthropicStreamEvent[] {
  switch (block.type) {
    case "text":
      if (!block.text) {
        return [];
      }
      return [
        {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: block.text },
        },
      ];
    case "thinking":
      if (!block.thinking) {
        return [];
      }
      return [
        {
          type: "content_block_delta",
          index,
          delta: { type: "thinking_delta", thinking: block.thinking },
        },
      ];
    case "tool_use": {
      const partialJson = JSON.stringify(block.input ?? {});
      return [
        {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: partialJson },
        },
      ];
    }
    default:
      return [];
  }
}
