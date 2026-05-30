import { expect, test } from "bun:test";
import {
  buildOtelEnvVars,
  defaultEcoTelemetrySettings,
  mergeResourceAttributes,
} from "../src/otel-env";
import { buildSdkProcessEnv } from "../src/claude-agent-sdk";

test("buildOtelEnvVars returns empty when disabled", () => {
  expect(buildOtelEnvVars({ settings: defaultEcoTelemetrySettings() })).toEqual({});
});

test("buildOtelEnvVars sets OTLP exporters when enabled", () => {
  const env = buildOtelEnvVars({
    settings: {
      ...defaultEcoTelemetrySettings(),
      enabled: true,
      endpoint: "http://collector.example.com:4318/",
      headers: "Authorization=Bearer secret",
    },
    threadId: "thread-abc",
  });

  expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
  expect(env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA).toBe("1");
  expect(env.OTEL_TRACES_EXPORTER).toBe("otlp");
  expect(env.OTEL_METRICS_EXPORTER).toBe("otlp");
  expect(env.OTEL_LOGS_EXPORTER).toBe("otlp");
  expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://collector.example.com:4318");
  expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe("Authorization=Bearer secret");
  expect(env.OTEL_TRACES_EXPORT_INTERVAL).toBe("1000");
  expect(env.OTEL_SERVICE_NAME).toBe("eco-coding");
  expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain("thread.id=thread-abc");
  expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain("eco.client=eco-coding");
});

test("mergeResourceAttributes preserves existing keys", () => {
  const merged = mergeResourceAttributes("deployment.environment=prod", {
    "thread.id": "t1",
  });
  expect(merged).toContain("deployment.environment=prod");
  expect(merged).toContain("thread.id=t1");
});

test("buildSdkProcessEnv merges telemetry env for SDK child process", () => {
  const env = buildSdkProcessEnv({
    apiKey: "router-key",
    baseUrl: "http://127.0.0.1:36037/",
    telemetry: {
      ...defaultEcoTelemetrySettings(),
      enabled: true,
    },
    threadId: "run-1",
  });
  expect(env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
  expect(env.ANTHROPIC_API_KEY).toBe("router-key");
  expect(env.OTEL_RESOURCE_ATTRIBUTES).toContain("thread.id=run-1");
});
