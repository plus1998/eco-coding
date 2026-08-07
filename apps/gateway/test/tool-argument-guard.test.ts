import { afterEach, describe, expect, test } from "bun:test";
import { createTestGatewayFetchHandler } from "./test-bridge-rewrite.js";
import {
  CodexToolArgumentFailureCircuitBreaker,
  codexToolArgumentFailureCircuitBreaker,
  normalizeResponsesToolArgumentResponse,
} from "../src/tool-argument-guard.js";
import type { GatewayProvider } from "../src/types.js";

const provider: GatewayProvider = {
  id: "responses",
  name: "Responses mock",
  upstreamKind: "responses",
  baseUrl: "https://responses.test",
  apiKey: "test-key",
  upstreamModelId: "test-model",
  models: ["test-model"],
};

afterEach(() => codexToolArgumentFailureCircuitBreaker.clear());

describe("Codex tool argument guard", () => {
  test("normalizes streaming done events using the tool name from output_item.added", async () => {
    const sse = [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"write_stdin","arguments":""}}',
      "",
      "event: response.function_call_arguments.delta",
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":"{\\"session_id\\":"}',
      "",
      "event: response.function_call_arguments.delta",
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":"85031.0}"}',
      "",
      "event: response.function_call_arguments.done",
      'data: {"type":"response.function_call_arguments.done","output_index":0,"item_id":"fc_1","arguments":"{\\"session_id\\":85031.0}"}',
      "",
      "event: response.output_item.done",
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"write_stdin","arguments":"{\\"session_id\\":85031.0}"}}',
      "",
    ].join("\n");
    const response = await normalizeResponsesToolArgumentResponse(
      new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    );
    const text = await response.text();

    expect(text).toContain('arguments":"{\\"session_id\\":85031}"');
    expect(text).toContain('delta":"{\\"session_id\\":85031}"');
    expect(text).not.toContain("85031.0");
  });

  test("normalizes non-streaming Responses output", async () => {
    const response = await normalizeResponsesToolArgumentResponse(
      Response.json({
        id: "resp_1",
        object: "response",
        model: "test-model",
        output: [
          {
            type: "function_call",
            name: "exec_command",
            arguments: '{"cmd":"bun test","yield_time_ms":120000.0}',
          },
        ],
      }),
    );
    const body = (await response.json()) as { output: { arguments: string }[] };

    expect(body.output[0]?.arguments).toBe('{"cmd":"bun test","yield_time_ms":120000}');
  });

  test("preserves buffered argument deltas when a stream ends before done", async () => {
    const sse = [
      "event: response.output_item.added",
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"fc_1","name":"write_stdin"}}',
      "",
      "event: response.function_call_arguments.delta",
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"session_id\\":"}',
      "",
    ].join("\n");
    const response = await normalizeResponsesToolArgumentResponse(
      new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    );

    expect(await response.text()).toContain('delta":"{\\"session_id\\":"');
  });

  test("trips on the third identical parse failure and resets after a successful output", () => {
    const breaker = new CodexToolArgumentFailureCircuitBreaker();
    const failure =
      "failed to parse function arguments: invalid type: floating point `85031.0`, expected i32 at line 1 column 21";
    const observe = (output: string) =>
      breaker.observe({
        threadId: "thread-1",
        turnId: "turn-1",
        responsesInput: [{ type: "function_call_output", output }],
      });

    expect(observe(failure)).toMatchObject({ count: 1, tripped: false });
    expect(observe(failure)).toMatchObject({ count: 2, tripped: false });
    expect(observe(failure)).toMatchObject({ count: 3, tripped: true });
    expect(observe("Process exited with code 0")).toBeUndefined();
    expect(observe(failure)).toMatchObject({ count: 1, tripped: false });
  });

  test("gateway rectifies schemas and stops the third retry before fetching upstream", async () => {
    let fetchCount = 0;
    let forwardedSessionType: unknown;
    const handler = createTestGatewayFetchHandler(
      { host: "127.0.0.1", port: 0, providers: [provider] },
      async (_url, init) => {
        fetchCount += 1;
        const body = JSON.parse(String(init?.body)) as {
          tools?: { parameters?: { properties?: { session_id?: { type?: unknown } } } }[];
        };
        forwardedSessionType = body.tools?.[0]?.parameters?.properties?.session_id?.type;
        return Response.json({
          id: `resp_${fetchCount}`,
          object: "response",
          model: "test-model",
          status: "completed",
          output: [],
        });
      },
    );
    const failure =
      "failed to parse function arguments: invalid type: floating point `85031.0`, expected i32 at line 1 column 21";
    const makeRequest = () =>
      new Request("http://127.0.0.1/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "thread-loop",
            turn_id: "turn-loop",
            request_kind: "turn",
          }),
        },
        body: JSON.stringify({
          model: "test-model",
          stream: true,
          input: [{ type: "function_call_output", call_id: "call_1", output: failure }],
          tools: [
            {
              type: "function",
              name: "write_stdin",
              parameters: {
                type: "object",
                properties: { session_id: { type: "number" } },
              },
            },
          ],
        }),
      });

    expect((await handler(makeRequest())).status).toBe(200);
    expect((await handler(makeRequest())).status).toBe(200);
    const stopped = await handler(makeRequest());
    const stoppedBody = await stopped.text();

    expect(fetchCount).toBe(2);
    expect(forwardedSessionType).toBe("integer");
    expect(stoppedBody).toContain('"code":"tool_argument_parse_loop"');
  });
});
