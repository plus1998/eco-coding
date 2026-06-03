import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UPSTREAM_LOG_PREFIX = "[eco-upstream]";
const MAX_LOG_BODY_CHARS = 12_000;

let logFilePath: string | undefined;

export function getUpstreamLogFilePath(): string {
  if (!logFilePath) {
    const baseDir =
      process.env.ECO_UPSTREAM_LOG_DIR?.trim() ||
      path.join(os.homedir(), ".eco-coding", "logs");
    logFilePath = path.join(baseDir, "upstream.log");
  }
  return logFilePath;
}

export function logUpstream(phase: string, payload: Record<string, unknown>): void {
  const line = `${UPSTREAM_LOG_PREFIX} ${phase} ${JSON.stringify(payload, null, 2)}\n`;
  process.stderr.write(line);
  appendUpstreamLogFile(line);
}

/** Errors: stderr + upstream.log + main-process console.error (visible in Electron main devtools). */
export function logUpstreamError(phase: string, payload: Record<string, unknown>): void {
  logUpstream(phase, payload);
  console.error(UPSTREAM_LOG_PREFIX, phase, payload);
}

export function announceUpstreamLogDestination(extra?: Record<string, unknown>): void {
  const filePath = getUpstreamLogFilePath();
  logUpstream("log-destination", {
    file: filePath,
    hint: "主进程 console.log 在 Electron 下常不可见；请查看 stderr 或此文件。",
    ...extra,
  });
}

type LoggableHeadersInput =
  | Headers
  | Record<string, string | string[] | undefined>;

function appendLoggableHeader(
  result: Record<string, string>,
  key: string,
  value: string,
): void {
  const lower = key.toLowerCase();
  if (lower === "x-api-key" || lower === "authorization") {
    result[key] = redactSecret(value);
    return;
  }
  result[key] = value;
}

/** Accepts fetch `Headers` or plain header maps (e.g. from `buildOpenAIHeaders`). */
export function headersToLoggable(headers: LoggableHeadersInput): Record<string, string> {
  const result: Record<string, string> = {};

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      appendLoggableHeader(result, key, value);
    });
    return result;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        appendLoggableHeader(result, key, entry);
      }
    } else {
      appendLoggableHeader(result, key, value);
    }
  }
  return result;
}

export function redactSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "***";
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)} (${trimmed.length} chars)`;
}

export function parseJsonForLog(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function truncateForLog(raw: string): string {
  if (raw.length <= MAX_LOG_BODY_CHARS) {
    return raw;
  }
  return `${raw.slice(0, MAX_LOG_BODY_CHARS)}\n… [truncated ${raw.length - MAX_LOG_BODY_CHARS} chars]`;
}

/** Unwrap undici/Node fetch errors (often only "fetch failed" at the top). */
export function formatUpstreamFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const message = current.message.trim();
    if (message && !parts.includes(message)) {
      parts.push(message);
    }
    const code = (current as NodeJS.ErrnoException).code;
    if (typeof code === "string" && code.length > 0 && !parts.some((part) => part.includes(code))) {
      parts.push(`[${code}]`);
    }
    current = current.cause;
  }

  return parts.length > 0 ? parts.join(" · ") : "fetch failed";
}

function appendUpstreamLogFile(line: string): void {
  try {
    const filePath = getUpstreamLogFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${UPSTREAM_LOG_PREFIX} log-file-error ${message}\n`);
  }
}
