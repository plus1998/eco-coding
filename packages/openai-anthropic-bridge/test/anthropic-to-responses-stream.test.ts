import { describe, expect, test } from "bun:test";
import {
  anthropicEventToResponsesEvents,
  newAnthropicEventToResponsesState,
} from "../src/anthropic-to-responses-response.js";
import type { AnthropicStreamEvent, ResponsesStreamEvent } from "../src/types.js";

function convert(events: AnthropicStreamEvent[]): ResponsesStreamEvent[] {
  const state = newAnthropicEventToResponsesState();
  return events.flatMap((event) => anthropicEventToResponsesEvents(event, state));
}

describe("Anthropic stream to Responses lifecycle", () => {
  test("DeepSeek-style fragmented tool input survives completion events", () => {
    const events = convert([
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "deepseek-v4-flash",
          content: [],
          stop_reason: "",
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "call_deepseek_1",
          name: "echo_value",
          input: {},
        },
      },
      ...["{", '"', "value", '"', ": ", '"', "sm", "oke", "-test", '"', "}"].map(
        (partial_json): AnthropicStreamEvent => ({
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json },
        }),
      ),
      { type: "content_block_stop", index: 0 },
      { type: "message_stop" },
    ]);

    const argsDone = events.find((event) => event.type === "response.function_call_arguments.done");
    expect(argsDone?.call_id).toBe("call_deepseek_1");
    expect(argsDone?.name).toBe("echo_value");
    expect(argsDone?.arguments).toBe('{"value": "smoke-test"}');

    const itemDone = events.find(
      (event) => event.type === "response.output_item.done" && event.item?.type === "function_call",
    );
    expect(itemDone?.item?.call_id).toBe("call_deepseek_1");
    expect(itemDone?.item?.name).toBe("echo_value");
    expect(itemDone?.item?.arguments).toBe('{"value": "smoke-test"}');
  });

  test("completed reasoning and message items preserve streamed content", () => {
    const events = convert([
      {
        type: "message_start",
        message: {
          id: "msg_2",
          type: "message",
          role: "assistant",
          model: "deepseek-v4-flash",
          content: [],
          stop_reason: "",
          usage: {
            input_tokens: 5,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Check the tool." },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Done." },
      },
      { type: "content_block_stop", index: 1 },
      { type: "message_stop" },
    ]);

    const reasoningDone = events.find(
      (event) => event.type === "response.output_item.done" && event.item?.type === "reasoning",
    );
    expect(reasoningDone?.item?.summary).toEqual([{ type: "summary_text", text: "Check the tool." }]);

    const messageDone = events.find(
      (event) => event.type === "response.output_item.done" && event.item?.type === "message",
    );
    expect(messageDone?.item?.content).toEqual([{ type: "output_text", text: "Done." }]);
  });
});
