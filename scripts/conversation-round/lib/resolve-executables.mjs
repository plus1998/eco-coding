import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../..");

export function resolveCodexExecutable() {
  const fromEnv = process.env.CODEX_EXECUTABLE?.trim();
  if (fromEnv) return fromEnv;
  const win = path.join(root, "apps/desktop/node_modules/.bin/codex.exe");
  const unix = path.join(root, "apps/desktop/node_modules/.bin/codex");
  if (process.platform === "win32" && fs.existsSync(win)) return win;
  if (fs.existsSync(unix)) return unix;
  throw new Error("Codex executable not found. Install @openai/codex in apps/desktop.");
}

export function resolveClaudeExecutable() {
  const fromEnv = process.env.CLAUDE_EXECUTABLE?.trim();
  if (fromEnv) return fromEnv;
  const platform = process.platform;
  const arch = process.arch;
  const packageName = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const candidate = path.join(root, "apps/desktop/node_modules", packageName, "claude");
  const winCandidate = `${candidate}.exe`;
  if (platform === "win32" && fs.existsSync(winCandidate)) return winCandidate;
  if (fs.existsSync(candidate)) return candidate;
  return undefined;
}

export function resolveNodeExecutable() {
  const fromEnv = process.env.ECO_SMOKE_NODE?.trim();
  if (fromEnv) return fromEnv;
  return process.execPath;
}

export function resolveMcpEchoServerPath() {
  return path.join(root, "scripts/codex-scenario-smoke/mcp-echo-server.mjs");
}
