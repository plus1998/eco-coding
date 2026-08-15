import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync as defaultExistsSync } from "node:fs";
import path from "node:path";

/** Cursor ACP entry — never `--print` / stream-json. */
export const CURSOR_ACP_ARGS = ["acp"] as const;

export type ResolveCursorAgentExecutableOptions = {
  /** Test seam for HOME candidate probing. */
  existsSync?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
};

export type SpawnCursorAcpOptions = {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Test seam — defaults to `node:child_process.spawn`. */
  spawnFn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
};

export function resolveCursorAgentExecutable(
  explicit?: string,
  options: ResolveCursorAgentExecutableOptions = {},
): string {
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? defaultExistsSync;
  const configured = explicit?.trim() || env.CURSOR_AGENT_EXECUTABLE?.trim();
  if (configured) return configured;
  const home = env.HOME?.trim();
  for (const candidate of [
    home ? path.join(home, ".local", "bin", "agent") : "",
    home ? path.join(home, ".cursor", "bin", "agent") : "",
  ]) {
    if (candidate && exists(candidate)) return candidate;
  }
  return "agent";
}

export function spawnCursorAcpProcess(options: SpawnCursorAcpOptions = {}): ChildProcess {
  const executable = resolveCursorAgentExecutable(options.executable, {
    ...(options.env ? { env: options.env } : {}),
  });
  const spawnFn = options.spawnFn ?? spawn;
  const child = spawnFn(executable, [...CURSOR_ACP_ARGS], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    // Ignore stderr so the pipe is never left unread (driver + handshake probe).
    stdio: ["pipe", "pipe", "ignore"],
  });
  // Spawn failures (e.g. ENOENT when Cursor is not installed) surface as an
  // async `error` event; without at least one listener the Electron main
  // process dies with an uncaught exception. This listener makes the event
  // safe to consume later via cursorAcpSpawnError().
  child.on("error", () => {});
  return child;
}

/**
 * Rejects when the child process emits `error` (e.g. spawn ENOENT).
 * Stays pending if the child exits without an error.
 * Never produces an unhandled rejection, even if the caller stops awaiting.
 */
export function cursorAcpSpawnError(child: ChildProcess): Promise<never> {
  const failed = new Promise<never>((_resolve, reject) => {
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = () => {
      cleanup();
    };
    const cleanup = () => {
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
  // Guard: callers may race this against a handshake that finishes first, or
  // drop it entirely (run already ended) — keep it a no-op in those cases.
  failed.catch(() => {});
  return failed;
}
