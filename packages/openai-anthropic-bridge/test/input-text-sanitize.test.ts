import { describe, expect, test } from "bun:test";
import { type ResponsesRequest, responsesToAnthropicRequest } from "../src/index.js";

function contentTypes(messages: Array<{ content?: unknown }>): string[] {
  const types: string[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content as Array<{ type?: string }>) {
      if (typeof block?.type === "string") types.push(block.type);
    }
  }
  return types;
}

describe("Responses → Anthropic content type sanitization", () => {
  test("converts input_text on normal user messages", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-flash",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    };
    const out = responsesToAnthropicRequest(req);
    expect(contentTypes(out.messages ?? [])).toEqual(["text"]);
    expect(out.messages?.[0]?.content).toEqual([{ type: "text", text: "hello" }]);
  });

  test("converts message items that omit role (raw passthrough regression)", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-flash",
      input: [
        {
          type: "message",
          content: [{ type: "input_text", text: "no-role history" }],
        } as ResponsesRequest["input"] extends Array<infer T> ? T : never,
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "assistant reply" }],
        },
        {
          type: "function_call",
          name: "collaboration__spawn_agent",
          call_id: "call_1",
          arguments: '{"agent_type":"explorer"}',
        },
        {
          type: "function_call_output",
          call_id: "call_1",
          output: "spawned agent-1",
        },
        // Residual content without role/type that used to be forwarded raw.
        {
          content: [{ type: "input_text", text: "follow-up after spawn" }],
        } as ResponsesRequest["input"] extends Array<infer T> ? T : never,
      ],
    };
    const out = responsesToAnthropicRequest(req);
    const types = contentTypes(out.messages ?? []);
    expect(types.includes("input_text")).toBe(false);
    expect(types.includes("output_text")).toBe(false);
    expect(types).toContain("text");
    expect(types).toContain("tool_use");
    expect(types).toContain("tool_result");
  });

  test("maps Codex multi-agent encrypted_content task payload to Anthropic text", () => {
    const req: ResponsesRequest = {
      model: "deepseek-v4-flash",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Message Type: NEW_TASK\nTask name: /root/sqrt_worker\nSender: /root\nPayload:\n",
            },
            {
              type: "encrypted_content",
              encrypted_content:
                '请计算 25 的平方根，将结果字符串加上前缀"Final:"，返回该字符串。只返回该字符串即可。',
            } as never,
          ],
        },
      ],
    };
    const out = responsesToAnthropicRequest(req);
    const types = contentTypes(out.messages ?? []);
    expect(types.includes("encrypted_content")).toBe(false);
    expect(types).toEqual(["text", "text"]);
    const texts = (out.messages?.[0]?.content as Array<{ text?: string }>).map((b) => b.text ?? "");
    expect(texts[0]).toContain("NEW_TASK");
    expect(texts[1]).toContain("平方根");
  });
});
