/**
 * Built-in OpenTelemetry env for Claude Agent SDK CLI subprocess.
 * Telemetry is always exported to eco-coding's local OTLP receiver (not external Jaeger).
 * @see https://code.claude.com/docs/en/agent-sdk/observability
 */

export interface EcoBuiltinOtelOptions {
  /** Local OTLP HTTP endpoint, e.g. http://127.0.0.1:4318 */
  endpoint: string;
  threadId: string;
}

export function buildBuiltinOtelEnv(options: EcoBuiltinOtelOptions): Record<string, string> {
  const endpoint = options.endpoint.trim().replace(/\/+$/, "");
  if (!endpoint || !options.threadId.trim()) {
    return {};
  }

  const interval = "1000";
  return {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_TRACES_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "otlp",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_TRACES_EXPORT_INTERVAL: interval,
    OTEL_LOGS_EXPORT_INTERVAL: interval,
    OTEL_METRIC_EXPORT_INTERVAL: interval,
    OTEL_SERVICE_NAME: "eco-coding",
    OTEL_LOG_TOOL_DETAILS: "1",
    OTEL_RESOURCE_ATTRIBUTES: mergeResourceAttributes(undefined, {
      "eco.client": "eco-coding",
      "thread.id": options.threadId.trim(),
    }),
  };
}

export function mergeResourceAttributes(
  existing: string | undefined,
  add: Record<string, string>,
): string {
  const map = parseResourceAttributes(existing);
  for (const [key, value] of Object.entries(add)) {
    if (value.trim()) {
      map.set(key, value.trim());
    }
  }
  return serializeResourceAttributes(map);
}

function parseResourceAttributes(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) {
    return map;
  }
  for (const segment of raw.split(",")) {
    const eq = segment.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = segment.slice(0, eq).trim();
    const encoded = segment.slice(eq + 1);
    if (!key) {
      continue;
    }
    try {
      map.set(key, decodeURIComponent(encoded));
    } catch {
      map.set(key, encoded);
    }
  }
  return map;
}

function serializeResourceAttributes(map: Map<string, string>): string {
  return [...map.entries()]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(",");
}
