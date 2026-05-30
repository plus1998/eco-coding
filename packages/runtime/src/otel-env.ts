/**
 * OpenTelemetry env for Claude Agent SDK (CLI subprocess).
 * @see https://code.claude.com/docs/en/agent-sdk/observability
 */
export interface EcoTelemetrySettings {
  enabled: boolean;
  /** OTLP HTTP endpoint, e.g. http://localhost:4318 */
  endpoint: string;
  /** OTEL_EXPORTER_OTLP_HEADERS value, e.g. Authorization=Bearer token */
  headers?: string;
  serviceName: string;
  traces: boolean;
  metrics: boolean;
  logs: boolean;
  /** Shorter intervals suit desktop sessions (default 1000ms). */
  exportIntervalMs: number;
}

export const defaultEcoTelemetrySettings = (): EcoTelemetrySettings => ({
  enabled: false,
  endpoint: "http://localhost:4318",
  serviceName: "eco-coding",
  traces: true,
  metrics: true,
  logs: true,
  exportIntervalMs: 1000,
});

export interface BuildOtelEnvInput {
  settings: EcoTelemetrySettings;
  threadId?: string;
  /** Existing OTEL_RESOURCE_ATTRIBUTES from process.env (merged, not replaced). */
  inheritedResourceAttributes?: string;
}

export function buildOtelEnvVars(input: BuildOtelEnvInput): Record<string, string> {
  const { settings } = input;
  if (!settings.enabled) {
    return {};
  }

  const endpoint = settings.endpoint.trim().replace(/\/+$/, "");
  if (!endpoint) {
    return {};
  }

  const interval = String(Math.max(500, settings.exportIntervalMs));
  const env: Record<string, string> = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    OTEL_METRIC_EXPORT_INTERVAL: interval,
    OTEL_LOGS_EXPORT_INTERVAL: interval,
    OTEL_TRACES_EXPORT_INTERVAL: interval,
    OTEL_SERVICE_NAME: settings.serviceName.trim() || "eco-coding",
  };

  if (settings.traces) {
    env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = "1";
    env.OTEL_TRACES_EXPORTER = "otlp";
  }
  if (settings.metrics) {
    env.OTEL_METRICS_EXPORTER = "otlp";
  }
  if (settings.logs) {
    env.OTEL_LOGS_EXPORTER = "otlp";
  }

  const headers = settings.headers?.trim();
  if (headers) {
    env.OTEL_EXPORTER_OTLP_HEADERS = headers;
  }

  const resourceAttributes: Record<string, string> = {
    "eco.client": "eco-coding",
  };
  if (input.threadId?.trim()) {
    resourceAttributes["thread.id"] = input.threadId.trim();
  }

  env.OTEL_RESOURCE_ATTRIBUTES = mergeResourceAttributes(
    input.inheritedResourceAttributes,
    resourceAttributes,
  );

  return env;
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

  for (const segment of splitResourceAttributeSegments(raw)) {
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

/** Split OTEL_RESOURCE_ATTRIBUTES on commas not inside percent-encoded values. */
function splitResourceAttributeSegments(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === ",") {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) {
    segments.push(current);
  }
  return segments;
}

function serializeResourceAttributes(map: Map<string, string>): string {
  return [...map.entries()]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join(",");
}
