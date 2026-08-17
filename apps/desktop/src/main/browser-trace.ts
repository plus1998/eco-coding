import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let logFilePath: string | undefined;
let writeChain: Promise<void> = Promise.resolve();

function resolveLogFilePath(): string | undefined {
  if (logFilePath) {
    return logFilePath;
  }
  try {
    const electron = require("electron") as {
      app?: { getPath?: (name: string) => string };
    };
    const userData = electron.app?.getPath?.("userData")?.trim();
    if (!userData) {
      return undefined;
    }
    const dir = path.join(userData, "logs");
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, "eco-browser-trace.log");
    return logFilePath;
  } catch {
    return undefined;
  }
}

function formatLine(scope: string, message: string, extra?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const payload =
    extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  return `${ts} [eco-browser-trace][${scope}] ${message}${payload}\n`;
}

/**
 * Browser MCP / CDP diagnostic trail.
 * Always on (stderr + userData/logs/eco-browser-trace.log) so tool timeouts can be localized.
 */
export function browserTrace(
  scope: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const line = formatLine(scope, message, extra);
  try {
    process.stderr.write(line);
  } catch {
    // ignore
  }
  const file = resolveLogFilePath();
  if (!file) {
    return;
  }
  writeChain = writeChain
    .then(() => fs.promises.appendFile(file, line, "utf8"))
    .catch(() => {
      // ignore disk errors
    });
}

export function browserTraceTimer(
  scope: string,
  label: string,
): (extra?: Record<string, unknown>) => void {
  const started = Date.now();
  browserTrace(scope, `${label}:start`);
  return (extra) => {
    browserTrace(scope, `${label}:done`, {
      elapsedMs: Date.now() - started,
      ...extra,
    });
  };
}

export function getBrowserTraceLogPath(): string | undefined {
  return resolveLogFilePath();
}
