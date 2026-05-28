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

export function announceUpstreamLogDestination(extra?: Record<string, unknown>): void {
  const filePath = getUpstreamLogFilePath();
  logUpstream("log-destination", {
    file: filePath,
    hint: "主进程 console.log 在 Electron 下常不可见；请查看 stderr 或此文件。",
    ...extra,
  });
}

export function headersToLoggable(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "x-api-key" || lower === "authorization") {
      result[key] = redactSecret(value);
      return;
    }
    result[key] = value;
  });
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
