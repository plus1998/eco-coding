import { describe, expect, test } from "bun:test";
import {
  newResponsesToolArgumentStreamState,
  normalizeCodexIntegerToolSchemas,
  normalizeCodexToolArguments,
  normalizeResponsesStreamToolArguments,
  normalizeResponsesToolArguments,
} from "../src/codex-tool-arguments.js";

describe("Codex integer tool argument compatibility", () => {
  test("canonicalizes safe whole-number arguments for strict Codex handlers", () => {
    const raw = '{"session_id":85031.0,"yield_time_ms":120000.0,"chars":""}';

    expect(normalizeCodexToolArguments("write_stdin", raw)).toBe(
      '{"session_id":85031,"yield_time_ms":120000,"chars":""}',
    );
    expect(
      normalizeCodexToolArguments("functions.exec_command", '{"cmd":"bun test","yield_time_ms":15000.0}'),
    ).toBe('{"cmd":"bun test","yield_time_ms":15000}');
  });

  test("does not hide invalid fractions, unsafe integers, or unknown tools", () => {
    const fraction = '{"session_id":85031.5}';
    const mixedFraction = '{"session_id":85031.5,"yield_time_ms":120000.0}';
    const unsafe = '{"session_id":9007199254740992.0}';
    const unknown = '{"session_id":85031.0}';

    expect(normalizeCodexToolArguments("write_stdin", fraction)).toBe(fraction);
    expect(normalizeCodexToolArguments("write_stdin", mixedFraction)).toBe(mixedFraction);
    expect(normalizeCodexToolArguments("write_stdin", unsafe)).toBe(unsafe);
    expect(normalizeCodexToolArguments("vendor_tool", unknown)).toBe(unknown);
  });

  test("rectifies only known integer-backed fields in tool schemas", () => {
    const request = normalizeCodexIntegerToolSchemas({
      model: "test",
      input: [],
      tools: [
        {
          type: "function",
          name: "write_stdin",
          parameters: {
            type: "object",
            properties: {
              session_id: { type: "number" },
              chars: { type: "string" },
            },
          },
        },
        {
          type: "function",
          name: "vendor_tool",
          parameters: { type: "object", properties: { count: { type: "number" } } },
        },
      ],
    });
    const firstProperties = (
      request.tools?.[0]?.parameters as { properties: Record<string, { type: string }> }
    ).properties;
    const secondProperties = (
      request.tools?.[1]?.parameters as { properties: Record<string, { type: string }> }
    ).properties;

    expect(firstProperties.session_id?.type).toBe("integer");
    expect(firstProperties.chars?.type).toBe("string");
    expect(secondProperties.count?.type).toBe("number");
  });

  test("normalizes buffered and streaming terminal function call payloads", () => {
    const buffered = normalizeResponsesToolArguments({
      id: "resp_1",
      object: "response",
      model: "test",
      output: [
        {
          type: "function_call",
          name: "write_stdin",
          arguments: '{"session_id":85031.0}',
        },
      ],
    });
    expect(buffered.output?.[0]?.arguments).toBe('{"session_id":85031}');

    const state = newResponsesToolArgumentStreamState();
    normalizeResponsesStreamToolArguments(
      {
        type: "response.output_item.added",
        output_index: 3,
        item: { type: "function_call", id: "fc_1", name: "write_stdin", call_id: "call_1" },
      },
      state,
    );
    const done = normalizeResponsesStreamToolArguments(
      {
        type: "response.function_call_arguments.done",
        output_index: 3,
        item_id: "fc_1",
        arguments: '{"session_id":85031.0}',
      },
      state,
    );
    expect(done.arguments).toBe('{"session_id":85031}');
  });
});
