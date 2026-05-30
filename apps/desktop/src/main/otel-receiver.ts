import http from "node:http";
import {
  parseOtelLogsPayload,
  parseOtelTracesPayload,
  type OtelActivityLine,
  type OtelUsageUpdate,
} from "@eco/runtime";
import { logUpstream } from "./upstream-log";

export interface OtelReceiverCallbacks {
  onActivity: (line: OtelActivityLine) => void;
  onUsage: (usage: OtelUsageUpdate) => void;
}

export class LocalOtelReceiver {
  private server: http.Server | undefined;
  private endpoint = "";

  async start(callbacks: OtelReceiverCallbacks): Promise<string> {
    if (this.server) {
      return this.endpoint;
    }

    this.server = http.createServer(async (request, response) => {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end();
        return;
      }

      const path = request.url?.split("?")[0] ?? "";
      if (path !== "/v1/traces" && path !== "/v1/logs" && path !== "/v1/metrics") {
        response.statusCode = 404;
        response.end();
        return;
      }

      try {
        const body = await readRequestBody(request);
        if (path === "/v1/traces") {
          handleTraces(body, callbacks);
        } else if (path === "/v1/logs") {
          handleLogs(body, callbacks);
        } else {
          logUpstream("otel-metrics", { bytes: body.length });
        }
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end("{}");
      } catch (error) {
        logUpstream("otel-ingest-error", {
          path,
          message: error instanceof Error ? error.message : String(error),
        });
        response.statusCode = 400;
        response.end();
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to bind local OTLP receiver.");
    }
    this.endpoint = `http://127.0.0.1:${address.port}`;
    logUpstream("otel-receiver-ready", { endpoint: this.endpoint });
    return this.endpoint;
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = undefined;
    this.endpoint = "";
  }
}

function handleTraces(body: Buffer, callbacks: OtelReceiverCallbacks): void {
  const payload = parseJsonBody(body);
  logUpstream("otel-traces", summarizePayload(payload));
  for (const line of parseOtelTracesPayload(payload)) {
    callbacks.onActivity(line);
  }
}

function handleLogs(body: Buffer, callbacks: OtelReceiverCallbacks): void {
  const payload = parseJsonBody(body);
  logUpstream("otel-logs", summarizePayload(payload));
  const { lines, usage } = parseOtelLogsPayload(payload);
  for (const line of lines) {
    callbacks.onActivity(line);
  }
  for (const record of usage) {
    callbacks.onUsage(record);
  }
}

function parseJsonBody(body: Buffer): unknown {
  const contentType = "application/json";
  void contentType;
  const text = body.toString("utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text) as unknown;
}

function readRequestBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function summarizePayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { kind: "unknown" };
  }
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.resourceSpans)) {
    return { kind: "traces", batches: record.resourceSpans.length };
  }
  if (Array.isArray(record.resourceLogs)) {
    return { kind: "logs", batches: record.resourceLogs.length };
  }
  if (Array.isArray(record.resourceMetrics)) {
    return { kind: "metrics", batches: record.resourceMetrics.length };
  }
  return { kind: "unknown", keys: Object.keys(record) };
}

export const localOtelReceiver = new LocalOtelReceiver();
