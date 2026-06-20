/**
 * Map Claude Code OTLP (JSON) signals to eco-coding activity lines.
 * @see https://code.claude.com/docs/en/monitoring-usage
 */

import {
  formatApiErrorActivitySummary,
  parseOtelApiErrorAttribute,
  type ThreadApiErrorInfo,
} from "./api-error.js";
import type { RuntimeAgentRole } from "../../shared/src";
import { normalizeSdkSubagentType } from "./subagent-resume.js";

export type { ThreadApiErrorInfo };

export type OtelActivityRole = RuntimeAgentRole | "system" | "thinking" | "tool";

export interface OtelActivityLine {
  threadId: string;
  message: string;
  role: OtelActivityRole;
  stream?: boolean;
  toolName?: string;
  toolDetail?: string;
  toolUseId?: string;
  durationMs?: number;
  toolStatus?: "completed" | "failed";
  /** Set when OTLP event.name is api_error (or llm_request failed). */
  apiError?: ThreadApiErrorInfo;
}

export interface OtelUsageUpdate {
  threadId: string;
  role: OtelActivityRole;
  modelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
}

interface OtlpKeyValue {
  key?: string;
  value?: OtlpAnyValue;
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

const NON_AGENT_OTEL_ROLES = new Set([
  "assistant",
  "main",
  "system",
  "thinking",
  "tool",
  "user",
]);

export function parseOtelTracesPayload(
  payload: unknown,
  fallbackThreadId?: string,
): OtelActivityLine[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const resourceSpans = (payload as { resourceSpans?: unknown[] }).resourceSpans;
  if (!Array.isArray(resourceSpans)) {
    return [];
  }

  const lines: OtelActivityLine[] = [];
  for (const resourceSpan of resourceSpans) {
    if (!resourceSpan || typeof resourceSpan !== "object") {
      continue;
    }
    const record = resourceSpan as {
      resource?: { attributes?: OtlpKeyValue[] };
      scopeSpans?: Array<{ spans?: unknown[] }>;
    };
    const threadId =
      readAttributeString(record.resource?.attributes, "thread.id") ?? fallbackThreadId;
    if (!threadId) {
      continue;
    }

    for (const scopeSpan of record.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        const line = spanToActivityLine(span, threadId);
        if (line) {
          lines.push(line);
        }
      }
    }
  }
  return lines;
}

export function parseOtelLogsPayload(
  payload: unknown,
  fallbackThreadId?: string,
): { lines: OtelActivityLine[]; usage: OtelUsageUpdate[] } {
  if (!payload || typeof payload !== "object") {
    return { lines: [], usage: [] };
  }
  const resourceLogs = (payload as { resourceLogs?: unknown[] }).resourceLogs;
  if (!Array.isArray(resourceLogs)) {
    return { lines: [], usage: [] };
  }

  const lines: OtelActivityLine[] = [];
  const usage: OtelUsageUpdate[] = [];

  for (const resourceLog of resourceLogs) {
    if (!resourceLog || typeof resourceLog !== "object") {
      continue;
    }
    const record = resourceLog as {
      resource?: { attributes?: OtlpKeyValue[] };
      scopeLogs?: Array<{ logRecords?: unknown[] }>;
    };
    const threadId =
      readAttributeString(record.resource?.attributes, "thread.id") ?? fallbackThreadId;
    if (!threadId) {
      continue;
    }

    for (const scopeLog of record.scopeLogs ?? []) {
      for (const logRecord of scopeLog.logRecords ?? []) {
        const parsed = logRecordToActivity(logRecord, threadId);
        if (parsed.line) {
          lines.push(parsed.line);
        }
        if (parsed.usage) {
          usage.push(parsed.usage);
        }
      }
    }
  }

  return { lines, usage };
}

function spanToActivityLine(span: unknown, threadId: string): OtelActivityLine | null {
  if (!span || typeof span !== "object") {
    return null;
  }
  const record = span as {
    name?: string;
    endTimeUnixNano?: string;
    attributes?: OtlpKeyValue[];
    status?: { code?: number; message?: string };
  };

  // Only emit completed spans (avoid duplicate in-progress noise).
  if (!record.endTimeUnixNano) {
    return null;
  }

  const name = record.name ?? "";
  const attrs = record.attributes;
  const role = inferRoleFromOtelAttributes(attrs);

  if (name === "claude_code.llm_request") {
    const success = readAttributeString(attrs, "success");
    if (success === "false") {
      const error = readAttributeString(attrs, "error") ?? record.status?.message ?? "模型请求失败";
      const model = readAttributeString(attrs, "model");
      return buildOtelApiErrorLine(threadId, role, error, model);
    }
    return null;
  }

  if (name === "claude_code.tool.blocked_on_user") {
    const decision = readAttributeString(attrs, "decision");
    if (decision === "reject") {
      return { threadId, role: "system", message: "工具调用被拒绝" };
    }
    return null;
  }

  return null;
}

function logRecordToActivity(
  logRecord: unknown,
  threadId: string,
): { line?: OtelActivityLine; usage?: OtelUsageUpdate } {
  if (!logRecord || typeof logRecord !== "object") {
    return {};
  }
  const record = logRecord as { attributes?: OtlpKeyValue[]; body?: OtlpAnyValue };
  const attrs = record.attributes;
  const eventName = readAttributeString(attrs, "event.name");
  const role = inferRoleFromOtelAttributes(attrs);

  if (eventName === "tool_result") {
    const toolName = readAttributeString(attrs, "tool_name");
    if (!toolName) {
      return {};
    }
    const success = readAttributeString(attrs, "success");
    const detail = formatToolDetailFromLog(attrs);
    const durationMs = readAttributeNumber(attrs, "duration_ms");
    const toolUseId = readOtelToolUseId(attrs);
    const suffix = durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : "";
    const detailPreview = previewToolDetailForMessage(detail);
    if (success === "false") {
      const error = readAttributeString(attrs, "error") ?? readAttributeString(attrs, "error_type");
      return {
        line: {
          threadId,
          role,
          message: error
            ? `Tool failed: ${toolName} · ${error}`
            : `Tool failed: ${toolName}`,
          toolName,
          ...(detail && { toolDetail: detail }),
          ...(toolUseId && { toolUseId }),
          ...(durationMs !== undefined && { durationMs }),
          toolStatus: "failed",
        },
      };
    }
    return {
      line: {
        threadId,
        role,
        message: detailPreview
          ? `Tool: ${toolName} · ${detailPreview}${suffix}`
          : `Tool: ${toolName}${suffix}`,
        toolName,
        ...(detail && { toolDetail: detail }),
        ...(toolUseId && { toolUseId }),
        ...(durationMs !== undefined && { durationMs }),
        toolStatus: "completed",
      },
    };
  }

  if (eventName === "tool_decision") {
    const decision = readAttributeString(attrs, "decision");
    const toolName = readAttributeString(attrs, "tool_name");
    if (decision === "reject" && toolName) {
      return {
        line: { threadId, role: "system", message: `Permission denied for ${toolName}` },
      };
    }
    return {};
  }

  if (eventName === "api_error") {
    const error = readAttributeString(attrs, "error") ?? "API 请求失败";
    const model = readAttributeString(attrs, "model");
    return {
      line: buildOtelApiErrorLine(threadId, role, error, model),
    };
  }

  if (eventName === "api_request") {
    const inputTokens = readAttributeNumber(attrs, "input_tokens") ?? 0;
    const outputTokens = readAttributeNumber(attrs, "output_tokens") ?? 0;
    const costUsd = readAttributeNumber(attrs, "cost_usd");
    const model = readAttributeString(attrs, "model");
    const cacheRead =
      readAttributeNumber(attrs, "cache_read_tokens") ??
      readAttributeNumber(attrs, "cache_read_input_tokens");
    const cacheCreation =
      readAttributeNumber(attrs, "cache_creation_tokens") ??
      readAttributeNumber(attrs, "cache_creation_input_tokens");
    return {
      usage: {
        threadId,
        role,
        ...(model && { modelId: model }),
        inputTokens,
        outputTokens,
        cacheReadTokens: cacheRead ?? 0,
        cacheCreationTokens: cacheCreation ?? 0,
        ...(costUsd !== undefined && { costUsd }),
      },
    };
  }

  if (eventName === "compaction") {
    return { line: { threadId, role: "system", message: "Compacting context…" } };
  }

  const body = readAnyValueString(record.body);
  if (eventName === "api_retries_exhausted" || body?.includes("retry")) {
    return {};
  }

  return {};
}

function previewToolDetailForMessage(detail: string | undefined, maxLength = 80): string | undefined {
  const trimmed = detail?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}…` : trimmed;
}

function formatToolDetailFromLog(attrs?: OtlpKeyValue[]): string | undefined {
  const paramsRaw = readAttributeString(attrs, "tool_parameters");
  if (paramsRaw) {
    try {
      const params = JSON.parse(paramsRaw) as Record<string, unknown>;
      const command =
        (typeof params.full_command === "string" && params.full_command) ||
        (typeof params.bash_command === "string" && params.bash_command);
      if (command) {
        return command;
      }
      const subagent =
        (typeof params.subagent_type === "string" && params.subagent_type) || undefined;
      if (subagent) {
        return formatSubagentLabel(subagent);
      }
      const skill = typeof params.skill_name === "string" ? params.skill_name : undefined;
      if (skill) {
        return `${skill} 技能`;
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const inputRaw = readAttributeString(attrs, "tool_input");
  if (inputRaw) {
    try {
      const input = JSON.parse(inputRaw) as Record<string, unknown>;
      const filePath =
        (typeof input.file_path === "string" && input.file_path) ||
        (typeof input.path === "string" && input.path);
      if (filePath) {
        return pathBasename(filePath);
      }
      const query = typeof input.query === "string" ? input.query.trim() : "";
      if (query) {
        return query.length > 80 ? `${query.slice(0, 77)}…` : query;
      }
      const url = typeof input.url === "string" ? input.url.trim() : "";
      if (url) {
        return url.length > 80 ? `${url.slice(0, 77)}…` : url;
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

function inferRoleFromOtelAttributes(attrs?: OtlpKeyValue[]): OtelActivityRole {
  const querySource = normalizeOtelAgentRole(readAttributeString(attrs, "query_source"));
  if (querySource) {
    return querySource;
  }
  const agentName = normalizeOtelAgentRole(readAttributeString(attrs, "agent.name"));
  if (agentName) {
    return agentName;
  }
  const subagent = normalizeOtelAgentRole(readAttributeString(attrs, "subagent_type"));
  if (subagent) {
    return subagent;
  }
  return "planner";
}

function normalizeOtelAgentRole(value: string | undefined): RuntimeAgentRole | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const sdkRole = normalizeSdkSubagentType(trimmed);
  if (sdkRole && !isNonAgentOtelRole(sdkRole)) {
    return sdkRole;
  }
  const candidate = trimmed.startsWith("eco_") ? trimmed.slice(4) : trimmed;
  const normalized = candidate.trim().toLowerCase();
  if (!normalized || isNonAgentOtelRole(normalized)) {
    return undefined;
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function isNonAgentOtelRole(role: string): boolean {
  return NON_AGENT_OTEL_ROLES.has(role.trim().toLowerCase());
}

function formatSubagentLabel(role: string): string {
  const normalized = role.startsWith("eco_") ? role.slice(4) : role;
  const labels: Record<string, string> = {
    explore: "探索",
    architect: "架构",
    coder: "编码",
    reviewer: "审查",
    tester: "测试",
  };
  return labels[normalized] ?? normalized;
}

function readOtelToolUseId(attrs: OtlpKeyValue[] | undefined): string | undefined {
  return (
    readAttributeString(attrs, "tool_use_id") ??
    readAttributeString(attrs, "tool.id") ??
    readAttributeString(attrs, "tool_use.id") ??
    readAttributeString(attrs, "tool.call_id")
  );
}

function readAttributeString(attrs: OtlpKeyValue[] | undefined, key: string): string | undefined {
  if (!attrs) {
    return undefined;
  }
  for (const entry of attrs) {
    if (entry.key !== key) {
      continue;
    }
    const value = readAnyValueString(entry.value);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readAttributeNumber(attrs: OtlpKeyValue[] | undefined, key: string): number | undefined {
  const raw = readAttributeString(attrs, key);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readAnyValueString(value: OtlpAnyValue | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value.stringValue === "string" && value.stringValue.trim()) {
    return value.stringValue;
  }
  if (value.intValue !== undefined) {
    return String(value.intValue);
  }
  if (value.doubleValue !== undefined) {
    return String(value.doubleValue);
  }
  if (value.boolValue !== undefined) {
    return value.boolValue ? "true" : "false";
  }
  return undefined;
}

function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function buildOtelApiErrorLine(
  threadId: string,
  role: OtelActivityRole,
  rawError: string,
  model?: string,
): OtelActivityLine {
  const apiError = parseOtelApiErrorAttribute(rawError, model);
  if (apiError) {
    return {
      threadId,
      role,
      message: formatApiErrorActivitySummary(apiError),
      apiError,
    };
  }
  const trimmed = rawError.trim() || "API 请求失败";
  return {
    threadId,
    role,
    message: trimmed.startsWith("API error") ? trimmed : `API error · ${trimmed}`,
    apiError: {
      message: trimmed,
      ...(model && { model }),
    },
  };
}
