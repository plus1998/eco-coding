import { describe, expect, test } from "bun:test";
import {
  rectifyThinkingBudget,
  shouldRectifyThinkingBudget,
} from "../src/upstream/thinking-budget-rectifier.js";
import {
  rectifyAnthropicRequest,
  shouldRectifyThinkingSignature,
} from "../src/upstream/thinking-rectifier.js";
import {
  forwardAnthropicMessages,
  forwardAnthropicMessagesBody,
} from "../src/upstream/anthropic-messages.js";
import type { GatewayProvider, ResolvedProviderRoute } from "../src/types.js";
import type { AnthropicRequest } from "@eco/openai-anthropic-bridge";

describe("thinking signature rectifier", () => {
  test("detects invalid signature in thinking block", () => {
    expect(
      shouldRectifyThinkingSignature(
        "messages.1.content.0: Invalid `signature` in `thinking` block",
      ),
    ).toBe(true);
  });

  test("detects thought signature is not valid", () => {
    expect(
      shouldRectifyThinkingSignature(
        "Unable to submit request because Thought signature is not valid",
      ),
    ).toBe(true);
  });

  test("does not trigger on unrelated errors", () => {
    expect(shouldRectifyThinkingSignature("Request timeout")).toBe(false);
    expect(shouldRectifyThinkingSignature(undefined)).toBe(false);
  });

  test("rectify removes thinking blocks and signature fields", () => {
    const body: Record<string, unknown> = {
      model: "claude-test",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "t", signature: "sig" },
            { type: "text", text: "hello", signature: "sig_text" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "WebSearch",
              input: {},
              signature: "sig_tool",
            },
            { type: "redacted_thinking", data: "r", signature: "sig_redacted" },
          ],
        },
      ],
    };

    const result = rectifyAnthropicRequest(body);
    expect(result.applied).toBe(true);
    expect(result.removedThinkingBlocks).toBe(1);
    expect(result.removedRedactedThinkingBlocks).toBe(1);
    expect(result.removedSignatureFields).toBe(2);

    const content = (body.messages as Array<{ content: Array<{ type: string }> }>)[0]
      ?.content;
    expect(content).toHaveLength(2);
    expect(content?.[0]?.type).toBe("text");
    expect(content?.[1]?.type).toBe("tool_use");
    expect(content?.[0]).not.toHaveProperty("signature");
  });
});

describe("thinking budget rectifier", () => {
  test("detects budget_tokens + thinking + 1024 constraint", () => {
    expect(
      shouldRectifyThinkingBudget(
        "thinking.budget_tokens: Input should be greater than or equal to 1024",
      ),
    ).toBe(true);
  });

  test("does not trigger without 1024 constraint", () => {
    expect(
      shouldRectifyThinkingBudget("budget_tokens must be less than max_tokens"),
    ).toBe(false);
  });

  test("rectify sets budget and max_tokens", () => {
    const body: Record<string, unknown> = {
      model: "claude-test",
      thinking: { type: "enabled", budget_tokens: 512 },
      max_tokens: 1024,
    };
    const result = rectifyThinkingBudget(body);
    expect(result.applied).toBe(true);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 32000 });
    expect(body.max_tokens).toBe(64000);
  });

  test("skips adaptive thinking", () => {
    const body: Record<string, unknown> = {
      model: "claude-test",
      thinking: { type: "adaptive", budget_tokens: 512 },
      max_tokens: 1024,
    };
    const result = rectifyThinkingBudget(body);
    expect(result.applied).toBe(false);
    expect(body.max_tokens).toBe(1024);
  });
});

describe("forwardAnthropicMessages rectifier retries", () => {
  const provider: GatewayProvider = {
    id: "anthropic",
    name: "Anthropic mock",
    upstreamKind: "anthropic-messages",
    baseUrl: "https://mock.anthropic.test",
    apiKey: "test-key",
    upstreamModelId: "claude-sonnet-4-20250514",
    models: ["claude-sonnet-4-20250514"],
  };
  const route: ResolvedProviderRoute = {
    provider,
    requestedModel: "claude-sonnet-4-20250514",
    upstreamModelId: "claude-sonnet-4-20250514",
  };

  test("retries once after signature rectifier on invalid signature error", async () => {
    let calls = 0;
    const logs: string[] = [];
    const anthropicBody: AnthropicRequest = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "t", signature: "bad" },
            { type: "text", text: "hi" },
          ],
        },
      ],
    };

    const mockFetch: typeof fetch = async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: Array<{ type: string }> }>;
      };
      if (calls === 1) {
        expect(
          body.messages.some((m) =>
            m.content.some((b) => b.type === "thinking"),
          ),
        ).toBe(true);
        return new Response(
          JSON.stringify({
            error: {
              message: "Invalid `signature` in `thinking` block",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }
      expect(
        body.messages.every((m) =>
          m.content.every((b) => b.type !== "thinking"),
        ),
      ).toBe(true);
      return Response.json({
        id: "msg_ok",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });
    };

    const response = await forwardAnthropicMessagesBody(
      route,
      anthropicBody,
      new Headers({ "content-type": "application/json" }),
      mockFetch,
      (line) => logs.push(line),
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(logs.some((l) => l.includes("[RECT-001]"))).toBe(true);
    expect(logs.some((l) => l.includes("[RECT-002]"))).toBe(true);
    const json = (await response.json()) as { output?: unknown[] };
    expect(json.output).toBeDefined();
  });

  test("retries once after budget rectifier", async () => {
    let calls = 0;
    const logs: string[] = [];
    const mockFetch: typeof fetch = async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as {
        thinking?: { budget_tokens?: number };
        max_tokens?: number;
      };
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                "thinking.budget_tokens: Input should be greater than or equal to 1024",
            },
          }),
          { status: 400 },
        );
      }
      expect(body.thinking?.budget_tokens).toBe(32000);
      expect(body.max_tokens).toBe(64000);
      return Response.json({
        id: "msg_ok",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-20250514",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });
    };

    const response = await forwardAnthropicMessages(
      route,
      {
        model: "claude-sonnet-4-20250514",
        reasoning: { effort: "high" },
        max_output_tokens: 512,
        input: JSON.stringify([
          {
            type: "message",
            role: "user",
            content: JSON.stringify([{ type: "input_text", text: "Hi" }]),
          },
        ]),
      },
      new Headers({ "content-type": "application/json" }),
      mockFetch,
      (line) => logs.push(line),
    );

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
    expect(logs.some((l) => l.includes("[RECT-010]"))).toBe(true);
    expect(logs.some((l) => l.includes("[RECT-011]"))).toBe(true);
  });
});
