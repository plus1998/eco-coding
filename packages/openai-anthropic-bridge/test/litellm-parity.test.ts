import { describe, expect, test } from "bun:test";
import {
  anthropicToResponses,
  chatCompletionsResponseToResponses,
  chatCompletionsToResponses,
  newResponsesEventToAnthropicState,
  responsesEventToAnthropicEvents,
  responsesToAnthropic,
  responsesToChatCompletions,
  responsesToChatCompletionsRequest,
  validateAnthropicStreamEvents,
} from "../src/index.js";
import type {
  AnthropicRequest,
  AnthropicStreamEvent,
  ChatCompletionsRequest,
  ResponsesInputItem,
  ResponsesRequest,
  ResponsesStreamEvent,
} from "../src/types.js";

function responseInputItems(resp: { input: unknown }): ResponsesInputItem[] {
  expect(Array.isArray(resp.input)).toBe(true);
  return resp.input as ResponsesInputItem[];
}

function collectAnthropicStreamEvents(events: ResponsesStreamEvent[]): AnthropicStreamEvent[] {
  const state = newResponsesEventToAnthropicState();
  const out: AnthropicStreamEvent[] = [];
  for (const event of events) {
    out.push(...responsesEventToAnthropicEvents(event, state));
  }
  return out;
}

describe("LiteLLM parity: Anthropic Messages -> Responses input", () => {
  test("user base64 and URL images become input_image, unknown image sources are skipped", () => {
    const base64 = anthropicToResponses({
      model: "gpt-5.2",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "abc123" },
            },
          ],
        },
      ],
    });
    expect(responseInputItems(base64)[0]?.content).toEqual([
      { type: "input_image", image_url: "data:image/png;base64,abc123" },
    ]);

    const url = anthropicToResponses({
      model: "gpt-5.2",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "url", url: "https://example.com/img.jpg" },
            },
          ],
        },
      ],
    });
    expect(responseInputItems(url)[0]?.content).toEqual([
      { type: "input_image", image_url: "https://example.com/img.jpg" },
    ]);

    const unknown = anthropicToResponses({
      model: "gpt-5.2",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [{ type: "image", source: { type: "file", file_id: "file_1" } }],
        },
      ],
    } as unknown as AnthropicRequest);
    expect(responseInputItems(unknown)).toEqual([]);
  });

  test("tool_result text and image content preserve tool output plus user image parts", () => {
    const resp = anthropicToResponses({
      model: "gpt-5.2",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_xyz",
              content: [
                { type: "text", text: "Line 1" },
                { type: "text", text: "Line 2" },
                {
                  type: "image",
                  source: { type: "base64", media_type: "image/png", data: "abc123" },
                },
              ],
            },
          ],
        },
      ],
    });

    const items = responseInputItems(resp);
    expect(items[0]).toEqual({
      type: "function_call_output",
      call_id: "call_xyz",
      output: "Line 1\nLine 2",
    });
    expect(items[1]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,abc123" }],
    });
  });

  test("assistant thinking history is reasoning, not replayed as ordinary output_text", () => {
    const resp = anthropicToResponses({
      model: "gpt-5.2",
      max_tokens: 256,
      messages: [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "Let me reason step by step." }],
        },
      ],
    });

    expect(responseInputItems(resp)).toEqual([
      {
        type: "reasoning",
        id: "rs_0",
        summary: [{ type: "summary_text", text: "Let me reason step by step." }],
      },
    ]);
  });

  test("request-level thinking budgets map to reasoning effort and request a parseable summary", () => {
    expect(
      anthropicToResponses({
        model: "gpt-5.2",
        max_tokens: 256,
        messages: [{ role: "user", content: "hi" }],
        thinking: { type: "enabled", budget_tokens: 500 },
      }).reasoning,
    ).toEqual({ effort: "minimal", summary: "auto" });

    expect(
      anthropicToResponses({
        model: "gpt-5.2",
        max_tokens: 256,
        messages: [{ role: "user", content: "hi" }],
        thinking: { type: "enabled", budget_tokens: 2048 },
      }).reasoning,
    ).toEqual({ effort: "medium", summary: "auto" });

    expect(
      anthropicToResponses({
        model: "gpt-5.2",
        max_tokens: 256,
        messages: [{ role: "user", content: "hi" }],
        thinking: { type: "enabled", budget_tokens: 4096 },
      }).reasoning,
    ).toEqual({ effort: "high", summary: "auto" });
  });

  test("tool definitions keep order while web_search becomes a hosted Responses tool", () => {
    const resp = anthropicToResponses({
      model: "gpt-5.2",
      max_tokens: 256,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "tool_a", description: "A" },
        { name: "web_search", type: "custom" },
        { name: "tool_b", input_schema: { type: "object" } },
      ],
    });

    expect(resp.tools).toEqual([
      {
        type: "function",
        name: "tool_a",
        description: "A",
        parameters: { type: "object", properties: {} },
        strict: false,
      },
      { type: "web_search" },
      {
        type: "function",
        name: "tool_b",
        parameters: { type: "object", properties: {} },
        strict: false,
      },
    ]);
  });
});

describe("LiteLLM parity: Chat Completions <-> Responses", () => {
  test("chat user image_url becomes flat Responses input_image with detail", () => {
    const imageUrl = "https://example.com/cat.png";
    const req = chatCompletionsToResponses({
      model: "gpt-5.2",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image" },
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
          ],
        },
      ],
    });

    expect(responseInputItems(req)[0]?.content).toEqual([
      { type: "input_text", text: "Describe this image" },
      { type: "input_image", image_url: imageUrl, detail: "high" },
    ]);
  });

  test("chat tool text output uses input_text parts, not output_text", () => {
    const req = chatCompletionsToResponses({
      model: "gpt-5.2",
      messages: [
        { role: "user", content: "What's the weather?" },
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_abc123",
              type: "function",
              function: { name: "get_weather", arguments: '{"location":"Paris"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_abc123",
          content: '{"temperature":15,"condition":"sunny"}',
        },
      ],
    });

    const output = responseInputItems(req).find((item) => item.type === "function_call_output");
    expect(output).toEqual({
      type: "function_call_output",
      call_id: "call_abc123",
      output: [{ type: "input_text", text: '{"temperature":15,"condition":"sunny"}' }],
    });
  });

  test("chat tool image output becomes flat input_image content", () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
    const req = chatCompletionsToResponses({
      model: "gpt-5.2",
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call_image",
              type: "function",
              function: { name: "fetch_image", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_image",
          content: [{ type: "image_url", image_url: { url: imageUrl } }],
        },
      ],
    });

    const output = responseInputItems(req).find((item) => item.type === "function_call_output");
    expect(output?.output).toEqual([{ type: "input_image", image_url: imageUrl, detail: "auto" }]);
  });

  test("Responses function_call_output input_text list normalizes back to a chat tool string", () => {
    const chat = responsesToChatCompletionsRequest({
      model: "gpt-5.2",
      input: [
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: [
            { type: "input_text", text: "hello" },
            { type: "input_text", text: " world" },
          ],
        },
      ],
    });

    expect(chat.messages).toEqual([
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: "{}" },
          },
        ],
        reasoning_content: "",
      },
      { role: "tool", tool_call_id: "call_1", content: "hello world" },
    ]);
  });

  test("Responses function_call JSON object arguments stay intact for Chat tools", () => {
    const chat = responsesToChatCompletionsRequest({
      model: "gpt-5.2",
      input: [
        {
          type: "function_call",
          call_id: "call_read",
          name: "Read",
          arguments: '{"file":"a.txt"}',
        },
        { type: "function_call_output", call_id: "call_read", output: "ok" },
      ],
    });

    expect(chat.messages[0]?.tool_calls?.[0]?.function.arguments).toBe('{"file":"a.txt"}');
  });

  test("Responses function_call_output with image normalizes back to chat multimodal tool content", () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
    const chat = responsesToChatCompletionsRequest({
      model: "gpt-5.2",
      input: [
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: [
            { type: "input_text", text: "image:" },
            { type: "input_image", image_url: imageUrl, detail: "low" },
          ],
        },
      ],
    });

    expect(chat.messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: [
        { type: "text", text: "image:" },
        { type: "image_url", image_url: { url: imageUrl, detail: "low" } },
      ],
    });
  });

  test("chat nested function tool_choice becomes Responses top-level function name", () => {
    const req = chatCompletionsToResponses({
      model: "gpt-5.2",
      messages: [{ role: "user", content: "echo" }],
      tool_choice: { type: "function", function: { name: "Echo" } },
    } satisfies ChatCompletionsRequest);

    expect(req.tool_choice).toEqual({ type: "function", name: "Echo" });
  });

  test("Responses function tool_choice becomes Chat nested function name", () => {
    const chat = responsesToChatCompletionsRequest({
      model: "gpt-5.2",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "echo" }] }],
      tool_choice: { type: "function", name: "Echo" },
    });

    expect(chat.tool_choice).toEqual({ type: "function", function: { name: "Echo" } });
  });

  test("reasoning_items preserve encrypted_content through non-streaming response and history", () => {
    const chat = responsesToChatCompletions(
      {
        id: "resp_test001",
        object: "response",
        model: "gpt-5.2",
        status: "completed",
        output: [
          {
            type: "reasoning",
            id: "rs_test001",
            encrypted_content: "gAAAAABpw5abc123FAKE==",
            summary: [{ type: "summary_text", text: "Thinking about it" }],
          },
          {
            type: "message",
            id: "msg_test001",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "The answer is 42." }],
          },
        ],
      },
      "gpt-5.2",
    );

    const msg = chat.choices[0]?.message;
    expect(msg?.reasoning_content).toBe("Thinking about it");
    expect(msg?.reasoning_items?.[0]).toMatchObject({
      id: "rs_test001",
      encrypted_content: "gAAAAABpw5abc123FAKE==",
    });

    const history = chatCompletionsToResponses({
      model: "gpt-5.2",
      messages: [
        { role: "user", content: "What is the answer?" },
        msg!,
        { role: "user", content: "Can you elaborate?" },
      ],
    });
    const types = responseInputItems(history).map((item) => item.type);
    expect(types).toEqual(["message", "reasoning", "message", "message"]);
    expect(responseInputItems(history)[1]).toMatchObject({
      type: "reasoning",
      id: "rs_test001",
      encrypted_content: "gAAAAABpw5abc123FAKE==",
    });
  });

  test("chat completion reasoning_content becomes Responses reasoning output", () => {
    const responses = chatCompletionsResponseToResponses(
      {
        id: "chatcmpl_reasoning",
        object: "chat.completion",
        created: 1,
        model: "gpt-5.2",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "final",
              reasoning_content: "private reasoning",
            },
            finish_reason: "stop",
          },
        ],
      },
      "gpt-5.2",
    );

    expect(responses.output?.[0]).toMatchObject({
      type: "reasoning",
      summary: [{ type: "summary_text", text: "private reasoning" }],
    });
    expect(responsesToAnthropic(responses, "gpt-5.2").content[0]).toEqual({
      type: "thinking",
      thinking: "private reasoning",
    });
  });
});

describe("LiteLLM parity: Responses streaming -> Anthropic stream", () => {
  test("text delta without output_item.added opens a text block and never uses a negative index", () => {
    const events = collectAnthropicStreamEvents([
      {
        type: "response.created",
        response: { id: "resp_1", object: "response", model: "gpt-5.2", output: [] },
      },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "Hel" },
      { type: "response.output_text.delta", item_id: "msg_1", delta: "lo" },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          object: "response",
          model: "gpt-5.2",
          status: "completed",
          output: [],
        },
      },
    ]);

    expect(events.filter((event) => event.type === "content_block_start")).toHaveLength(1);
    expect(events.find((event) => event.type === "content_block_start")).toMatchObject({
      index: 0,
      content_block: { type: "text", text: "" },
    });
    expect(events.filter((event) => event.type === "content_block_delta")).toMatchObject([
      { index: 0, delta: { type: "text_delta", text: "Hel" } },
      { index: 0, delta: { type: "text_delta", text: "lo" } },
    ]);
    expect(events.every((event) => event.index === undefined || event.index >= 0)).toBe(true);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });

  test("registered message item does not produce an extra text start", () => {
    const events = collectAnthropicStreamEvents([
      {
        type: "response.created",
        response: { id: "resp_1", object: "response", model: "gpt-5.2", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", content: [] },
      },
      { type: "response.output_text.delta", output_index: 0, item_id: "msg_1", delta: "Hi" },
      { type: "response.output_text.done", output_index: 0, item_id: "msg_1" },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          object: "response",
          model: "gpt-5.2",
          status: "completed",
          output: [],
        },
      },
    ]);

    expect(events.filter((event) => event.type === "content_block_start")).toHaveLength(1);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });

  test("text after reasoning opens a new legal block instead of reusing the thinking index", () => {
    const events = collectAnthropicStreamEvents([
      {
        type: "response.created",
        response: { id: "resp_1", object: "response", model: "gpt-5.2", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "reasoning", id: "rs_1" },
      },
      { type: "response.reasoning_summary_text.delta", output_index: 0, delta: "think" },
      { type: "response.output_text.delta", output_index: 1, item_id: "msg_1", delta: "Hi" },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          object: "response",
          model: "gpt-5.2",
          status: "completed",
          output: [],
        },
      },
    ]);

    const starts = events.filter((event) => event.type === "content_block_start");
    expect(starts.map((event) => event.content_block?.type)).toEqual(["thinking", "text"]);
    expect(starts.map((event) => event.index)).toEqual([0, 1]);
    expect(validateAnthropicStreamEvents(events)).toEqual([]);
  });
});

describe("LiteLLM parity: full request fields", () => {
  test("system, max tokens, tools, tool_choice, reasoning, and context_management map together", () => {
    const req: AnthropicRequest = {
      model: "gpt-5.2",
      max_tokens: 512,
      system: [
        { type: "text", text: "Be concise." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "ignored" } },
        { type: "text", text: "Be helpful." },
      ],
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "do_thing", input_schema: { type: "object" } }],
      tool_choice: { type: "tool", name: "do_thing" },
      thinking: { type: "enabled", budget_tokens: 4096 },
      context_management: {
        edits: [
          { type: "clear_thinking_20251015", keep: "all" },
          { type: "compact_20260112", trigger: { type: "input_tokens", value: 150000 } },
        ],
      },
    };

    const resp: ResponsesRequest = anthropicToResponses(req);
    expect(resp.instructions).toBe("Be concise.\nBe helpful.");
    expect(resp.max_output_tokens).toBe(512);
    expect(resp.tools?.[0]).toMatchObject({
      type: "function",
      name: "do_thing",
      parameters: { type: "object", properties: {} },
    });
    expect(resp.tool_choice).toEqual({ type: "function", name: "do_thing" });
    expect(resp.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(resp.context_management).toEqual([{ type: "compaction", compact_threshold: 150000 }]);
  });
});
