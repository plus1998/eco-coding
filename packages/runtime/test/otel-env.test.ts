import { expect, test } from "bun:test";
import { parseOtelLogsPayload, parseOtelTracesPayload } from "../src/otel-activity";
import { buildBuiltinOtelEnv } from "../src/otel-env";
import { buildSdkProcessEnv } from "../src/claude-agent-sdk";

test("buildBuiltinOtelEnv targets local JSON OTLP receiver", () => {
  const env = buildBuiltinOtelEnv({
    endpoint: "http://127.0.0.1:4318",
    threadId: "thread-1",
  });
  expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
  expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
  expect(env.OTEL_LOG_TOOL_DETAILS).toBe("1");
  expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain("thread.id=thread-1");
});

test("parseOtelTracesPayload maps llm_request failures", () => {
  const lines = parseOtelTracesPayload({
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "thread.id", value: { stringValue: "t1" } }],
        },
        scopeSpans: [
          {
            spans: [
              {
                name: "claude_code.llm_request",
                endTimeUnixNano: "1000",
                attributes: [
                  { key: "success", value: { stringValue: "false" } },
                  { key: "error", value: { stringValue: "rate limited" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  expect(lines[0]?.message).toContain("API error ·");
  expect(lines[0]?.apiError?.message).toContain("频繁");
});

test("parseOtelLogsPayload maps api_error events with structured metadata", () => {
  const { lines } = parseOtelLogsPayload({
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "thread.id", value: { stringValue: "t3" } }],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "api_error" } },
                  { key: "subagent_type", value: { stringValue: "reviewer" } },
                  { key: "model", value: { stringValue: "eco-reviewer-1" } },
                  {
                    key: "error",
                    value: {
                      stringValue:
                        '502 {"error":{"message":"Upstream request failed","type":"upstream_error"}}',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  expect(lines[0]?.role).toBe("reviewer");
  expect(lines[0]?.apiError?.statusCode).toBe(502);
  expect(lines[0]?.apiError?.code).toBe("upstream_error");
  expect(lines[0]?.message).toContain("API error · 502 ·");
});

test("parseOtelLogsPayload maps tool_result and api_request usage", () => {
  const { lines, usage } = parseOtelLogsPayload({
    resourceLogs: [
      {
        resource: {
          attributes: [{ key: "thread.id", value: { stringValue: "t2" } }],
        },
        scopeLogs: [
          {
            logRecords: [
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "tool_result" } },
                  { key: "tool_name", value: { stringValue: "Bash" } },
                  { key: "success", value: { stringValue: "true" } },
                  { key: "duration_ms", value: { intValue: "800" } },
                  {
                    key: "tool_parameters",
                    value: { stringValue: '{"full_command":"npm test"}' },
                  },
                ],
              },
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "api_request" } },
                  { key: "model", value: { stringValue: "claude-sonnet-4" } },
                  { key: "input_tokens", value: { intValue: "100" } },
                  { key: "output_tokens", value: { intValue: "50" } },
                  { key: "cost_usd", value: { doubleValue: 0.002 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  expect(lines[0]?.message).toBe("Tool: Bash · npm test (0.8s)");
  expect(usage[0]?.inputTokens).toBe(100);
  expect(usage[0]?.outputTokens).toBe(50);
  expect(usage[0]?.costUsd).toBe(0.002);
});

test("buildSdkProcessEnv merges builtin otel env", () => {
  const env = buildSdkProcessEnv({
    apiKey: "router-key",
    baseUrl: "http://127.0.0.1:36037/",
    otel: { endpoint: "http://127.0.0.1:4318", threadId: "run-1" },
  });
  expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
  expect(env.ANTHROPIC_API_KEY).toBe("router-key");
});
