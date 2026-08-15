import { spawn } from "node:child_process";
import { resolveCursorAgentExecutable } from "./acp-cursor-agent.js";

export interface CursorAgentModelOption {
  id: string;
  displayName: string;
  current: boolean;
  default: boolean;
}

export interface CursorAgentModelListOptions {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/** Reads Cursor's account-owned model catalog without involving Eco providers. */
export async function listCursorAgentModels(
  options: CursorAgentModelListOptions = {},
): Promise<CursorAgentModelOption[]> {
  const executable = resolveCursorAgentExecutable(options.executable, {
    ...(options.env ? { env: options.env } : {}),
  });
  const child = spawn(executable, ["models"], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Cursor Agent models exited with code ${exitCode}.`);
  }
  const models = parseCursorAgentModelsOutput(stdout);
  if (models.length === 0) {
    throw new Error("Cursor Agent returned no models.");
  }
  return models;
}

export function parseCursorAgentModelsOutput(output: string): CursorAgentModelOption[] {
  const ansi = /\u001b\[[0-?]*[ -\/]*[@-~]/g;
  const models: CursorAgentModelOption[] = [];
  for (const rawLine of output.replace(ansi, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "Available models" || line.startsWith("Tip:")) continue;
    const match = /^(\S+)\s+-\s+(.+?)(?:\s+\(([^)]*)\))?$/.exec(line);
    if (!match) continue;
    const [, id, displayName, flags = ""] = match;
    if (!id || !displayName) continue;
    const normalizedFlags = flags.toLowerCase();
    models.push({
      id,
      displayName: displayName.trim(),
      current: /(^|[ ,])current([ ,]|$)/.test(normalizedFlags),
      default: /(^|[ ,])default([ ,]|$)/.test(normalizedFlags),
    });
  }
  return models;
}
