import { createHash } from "node:crypto";
import type { RuntimeAgentRole } from "../shared/ipc";
import type { UpstreamApiCompat } from "../shared/api-compat";
import { logEcoDiag, shortThreadId } from "./eco-diag-log";

export interface ProxyRequestShapeRoute {
  role: RuntimeAgentRole;
  provider: { id: string; name: string };
  modelId: string;
  aliasModelId: string;
  apiCompat: UpstreamApiCompat;
}

export interface ProxyRequestShapeInput {
  threadId?: string;
  operation: "messages" | "count_tokens";
  route: ProxyRequestShapeRoute;
  requestedModel?: string;
  requestUrl?: string;
  upstreamUrl?: string;
  stream: boolean;
  converted: boolean;
  clientBody: Record<string, unknown>;
  upstreamBody?: Record<string, unknown>;
}

export interface JsonBodyShapeSummary {
  jsonBytes: number;
  jsonChars: number;
  jsonSha256: string;
  topLevelKeys: string[];
  largestTopLevelFields: Array<{ key: string; bytes: number }>;
  model?: string;
  stream?: boolean;
  maxTokens?: number;
  maxOutputTokens?: number;
  messageCount?: number;
  messageRoles?: Record<string, number>;
  largestMessages?: Array<{
    index: number;
    role?: string;
    bytes: number;
    contentKind: string;
    textChars?: number;
    blockCount?: number;
    blockTypes?: Record<string, number>;
  }>;
  system?: FieldShapeSummary;
  tools?: ToolsShapeSummary;
  input?: FieldShapeSummary;
  instructions?: FieldShapeSummary;
  cacheControlCount: number;
}

interface FieldShapeSummary {
  kind: string;
  bytes: number;
  chars?: number;
  count?: number;
}

interface ToolsShapeSummary {
  count: number;
  bytes: number;
  names: string[];
}

export function summarizeJsonBodyShape(
  body: Record<string, unknown>,
  payload = JSON.stringify(body),
): JsonBodyShapeSummary {
  const topLevelKeys = Object.keys(body).sort();
  const summary: JsonBodyShapeSummary = {
    jsonBytes: Buffer.byteLength(payload, "utf8"),
    jsonChars: payload.length,
    jsonSha256: hashText(payload),
    topLevelKeys,
    largestTopLevelFields: largestFieldShapes(body),
    cacheControlCount: countNestedKey(body, "cache_control") + countNestedKey(body, "cacheControl"),
  };

  if (typeof body.model === "string") {
    summary.model = body.model;
  }
  if (typeof body.stream === "boolean") {
    summary.stream = body.stream;
  }
  if (typeof body.max_tokens === "number") {
    summary.maxTokens = body.max_tokens;
  }
  if (typeof body.max_output_tokens === "number") {
    summary.maxOutputTokens = body.max_output_tokens;
  }

  const messages = body.messages;
  if (Array.isArray(messages)) {
    Object.assign(summary, summarizeMessages(messages));
  }

  const system = summarizeField(body.system);
  if (system) {
    summary.system = system;
  }

  const tools = summarizeTools(body.tools);
  if (tools) {
    summary.tools = tools;
  }

  const input = summarizeField(body.input);
  if (input) {
    summary.input = input;
  }

  const instructions = summarizeField(body.instructions);
  if (instructions) {
    summary.instructions = instructions;
  }

  return summary;
}

export function logProxyRequestShape(input: ProxyRequestShapeInput): void {
  const clientPayload = JSON.stringify(input.clientBody);
  const upstreamPayload = input.upstreamBody ? JSON.stringify(input.upstreamBody) : undefined;
  const client = summarizeJsonBodyShape(input.clientBody, clientPayload);
  const upstream = input.upstreamBody
    ? summarizeJsonBodyShape(input.upstreamBody, upstreamPayload)
    : undefined;

  logEcoDiag("proxy.request_shape", {
    ...(input.threadId && { threadId: shortThreadId(input.threadId) }),
    operation: input.operation,
    role: input.route.role,
    providerId: input.route.provider.id,
    provider: input.route.provider.name,
    apiCompat: input.route.apiCompat,
    modelId: input.route.modelId,
    aliasModelId: input.route.aliasModelId,
    ...(input.requestedModel && { requestedModel: input.requestedModel }),
    ...(input.requestUrl && { clientPath: input.requestUrl.split("?")[0] }),
    ...(input.upstreamUrl && { upstreamUrl: input.upstreamUrl }),
    stream: input.stream,
    converted: input.converted,
    client,
    ...(upstream && { upstream }),
    ...(upstream && { upstreamMinusClientBytes: upstream.jsonBytes - client.jsonBytes }),
  });
}

function summarizeMessages(messages: unknown[]): Partial<JsonBodyShapeSummary> {
  const messageRoles: Record<string, number> = {};
  const messageShapes = messages.map((message, index) => {
    const record = isRecord(message) ? message : {};
    const role = typeof record.role === "string" ? record.role : undefined;
    if (role) {
      messageRoles[role] = (messageRoles[role] ?? 0) + 1;
    }
    const contentSummary = summarizeContent(record.content);
    return {
      index,
      ...(role && { role }),
      bytes: jsonByteLength(message),
      contentKind: contentSummary.kind,
      ...(contentSummary.textChars !== undefined && { textChars: contentSummary.textChars }),
      ...(contentSummary.blockCount !== undefined && { blockCount: contentSummary.blockCount }),
      ...(contentSummary.blockTypes && { blockTypes: contentSummary.blockTypes }),
    };
  });

  return {
    messageCount: messages.length,
    messageRoles,
    largestMessages: messageShapes.sort((left, right) => right.bytes - left.bytes).slice(0, 5),
  };
}

function summarizeContent(content: unknown): {
  kind: string;
  textChars?: number;
  blockCount?: number;
  blockTypes?: Record<string, number>;
} {
  if (typeof content === "string") {
    return { kind: "string", textChars: content.length };
  }
  if (Array.isArray(content)) {
    const blockTypes: Record<string, number> = {};
    let textChars = 0;
    for (const block of content) {
      const type = isRecord(block) && typeof block.type === "string" ? block.type : typeof block;
      blockTypes[type] = (blockTypes[type] ?? 0) + 1;
      if (isRecord(block) && typeof block.text === "string") {
        textChars += block.text.length;
      }
    }
    return {
      kind: "array",
      blockCount: content.length,
      blockTypes,
      ...(textChars > 0 && { textChars }),
    };
  }
  if (content === undefined) {
    return { kind: "missing" };
  }
  if (content === null) {
    return { kind: "null" };
  }
  return { kind: typeof content };
}

function summarizeField(value: unknown): FieldShapeSummary | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return { kind: "string", bytes: Buffer.byteLength(value, "utf8"), chars: value.length };
  }
  if (Array.isArray(value)) {
    return { kind: "array", bytes: jsonByteLength(value), count: value.length };
  }
  if (isRecord(value)) {
    return { kind: "object", bytes: jsonByteLength(value), count: Object.keys(value).length };
  }
  return { kind: value === null ? "null" : typeof value, bytes: jsonByteLength(value) };
}

function summarizeTools(value: unknown): ToolsShapeSummary | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const names = value.flatMap((tool) => {
    if (!isRecord(tool)) {
      return [];
    }
    const name = typeof tool.name === "string" ? tool.name : undefined;
    return name ? [name] : [];
  });
  return {
    count: value.length,
    bytes: jsonByteLength(value),
    names: names.slice(0, 20),
  };
}

function largestFieldShapes(body: Record<string, unknown>): Array<{ key: string; bytes: number }> {
  return Object.entries(body)
    .map(([key, value]) => ({ key, bytes: jsonByteLength(value) }))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 8);
}

function countNestedKey(value: unknown, key: string): number {
  if (Array.isArray(value)) {
    return value.reduce((total, entry) => total + countNestedKey(entry, key), 0);
  }
  if (!isRecord(value)) {
    return 0;
  }
  let total = Object.prototype.hasOwnProperty.call(value, key) ? 1 : 0;
  for (const entry of Object.values(value)) {
    total += countNestedKey(entry, key);
  }
  return total;
}

function jsonByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
