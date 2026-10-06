import { describe, expect, test } from "bun:test";
import { responsesToChatCompletionsRequest } from "../src/chat-completions-responses-bridge.js";
import { jsonMarshal } from "../src/json.js";
import type { ChatMessage, ResponsesRequest } from "../src/types.js";

/** Ported from sub2api chatcompletions_responses_request_invariants_test.go */
function assertChatInvariants(messages: ChatMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.tool_calls && m.tool_calls.length > 0) {
      for (let j = 0; j < m.tool_calls.length; j++) {
        const tc = m.tool_calls[j]!;
        const k = i + 1 + j;
        expect(k).toBeLessThan(messages.length);
        expect(messages[k]!.role).toBe("tool");
        expect(messages[k]!.tool_call_id).toBe(tc.id);
      }
    }
    if (i > 0 && m.role === "assistant" && messages[i - 1]!.role === "assistant") {
      throw new Error(`consecutive assistant messages at ${i}`);
    }
    if (m.role === "tool") {
      expect(m.tool_call_id).toBeTruthy();
      // Chat Completions upstreams reject non-string tool content with 400
      // ("tool messages must contain string content").
      expect(typeof m.content).toBe("string");
    }
  }
}

function convertGolden(input: unknown[]): ChatMessage[] {
  const req: ResponsesRequest = {
    model: "deepseek-v4-pro",
    instructions: "You are a helpful assistant.",
    input: jsonMarshal(input),
  };
  const chatReq = responsesToChatCompletionsRequest(req);
  return chatReq.messages;
}

describe("responses → chat request invariants (sub2api parity)", () => {
  test("streaming requests include usage in the final SSE chunk", () => {
    const chatReq = responsesToChatCompletionsRequest({
      model: "local-model",
      input: "[]",
      stream: true,
    });
    expect(chatReq.stream).toBe(true);
    expect(chatReq.stream_options).toEqual({ include_usage: true });
  });

  test("omits tool_choice when a Responses request has no tools", () => {
    const chatReq = responsesToChatCompletionsRequest({
      model: "local-model",
      input: "[]",
      tool_choice: "auto",
    });

    expect(chatReq.tools).toBeUndefined();
    expect(chatReq.tool_choice).toBeUndefined();
  });

  test("single tool call attaches pending reasoning to assistant message", () => {
    const messages = convertGolden([
      { type: "message", role: "user", content: [{ type: "input_text", text: "latest sha?" }] },
      { type: "reasoning", summary: [{ type: "summary_text", text: "need to run curl" }] },
      {
        type: "function_call",
        call_id: "call_a",
        name: "exec_command",
        arguments: '{"cmd":"curl x"}',
      },
      { type: "function_call_output", call_id: "call_a", output: "deadbeef" },
    ]);
    assertChatInvariants(messages);
    const asst = messages.find((m) => (m.tool_calls?.length ?? 0) > 0);
    expect(asst?.reasoning_content).toBe("need to run curl");
  });

  test("parallel tool calls share one assistant message", () => {
    const messages = convertGolden([
      { type: "message", role: "user", content: [{ type: "input_text", text: "features?" }] },
      { type: "reasoning", summary: [{ type: "summary_text", text: "inspect repo" }] },
      { type: "function_call", call_id: "c0", name: "exec_command", arguments: '{"cmd":"git log"}' },
      { type: "function_call", call_id: "c1", name: "exec_command", arguments: '{"cmd":"git tag"}' },
      { type: "function_call_output", call_id: "c0", output: "log" },
      { type: "function_call_output", call_id: "c1", output: "tags" },
    ]);
    assertChatInvariants(messages);
    const parallel = messages.find((m) => m.tool_calls?.length === 2);
    expect(parallel?.tool_calls?.[0]?.id).toBe("c0");
    expect(parallel?.tool_calls?.[1]?.id).toBe("c1");
    expect(messages.filter((m) => m.role === "tool").length).toBe(2);
  });

  test("unknown item between tool call and output preserves tool adjacency", () => {
    const messages = convertGolden([
      { type: "message", role: "user", content: [{ type: "input_text", text: "search" }] },
      { type: "reasoning", summary: [{ type: "summary_text", text: "let me search" }] },
      { type: "function_call", call_id: "c0", name: "exec_command", arguments: "{}" },
      {
        type: "web_search_call",
        id: "ws_1",
        status: "completed",
        action: { type: "search", query: "x" },
      },
      { type: "function_call_output", call_id: "c0", output: "result" },
    ]);
    assertChatInvariants(messages);
  });

  test("sequential tool calls stay in separate assistant messages", () => {
    const messages = convertGolden([
      { type: "function_call", call_id: "c1", name: "exec", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "r1" },
      { type: "function_call", call_id: "c2", name: "exec", arguments: "{}" },
      { type: "function_call_output", call_id: "c2", output: "r2" },
    ]);
    assertChatInvariants(messages);
    expect(messages.filter((m) => m.tool_calls?.length === 1).length).toBe(2);
  });

  test("drops function_call_output with empty call_id (LongCat strict upstream)", () => {
    const messages = convertGolden([
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_ok", name: "Read", arguments: '{"file_path":"a.txt"}' },
      { type: "function_call_output", call_id: "call_ok", output: "ok" },
      { type: "function_call_output", call_id: "", output: "orphan" },
    ]);
    assertChatInvariants(messages);
    expect(messages.filter((m) => m.role === "tool").length).toBe(1);
    expect(messages.find((m) => m.role === "tool")?.tool_call_id).toBe("call_ok");
  });

  test("flattens function_call_output part arrays to string tool content (pi image tool results)", () => {
    const messages = convertGolden([
      { type: "message", role: "user", content: [{ type: "input_text", text: "read logo.png" }] },
      { type: "function_call", call_id: "call_img", name: "read", arguments: '{"path":"logo.png"}' },
      {
        type: "function_call_output",
        call_id: "call_img",
        output: [
          { type: "input_text", text: "Image: logo.png" },
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
    assertChatInvariants(messages);
    const tool = messages.find((m) => m.role === "tool");
    expect(tool?.content).toBe("Image: logo.png\n[image: image/png]");
  });

  test("keeps user message part arrays intact", () => {
    const messages = convertGolden([
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "describe" },
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AAAA" },
        ],
      },
    ]);
    const user = messages.find((m) => m.role === "user");
    expect(Array.isArray(user?.content)).toBe(true);
  });

  test("flattens image-only function_call_output to placeholder string", () => {
    const messages = convertGolden([
      { type: "message", role: "user", content: [{ type: "input_text", text: "screenshot" }] },
      { type: "function_call", call_id: "c_shot", name: "bash", arguments: '{"command":"x"}' },
      {
        type: "function_call_output",
        call_id: "c_shot",
        output: [
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,QUJD" },
        ],
      },
    ]);
    assertChatInvariants(messages);
    const tool = messages.find((m) => m.role === "tool");
    expect(tool?.content).toBe("[image: image/png]");
  });
});
