import { execFileSync, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync as defaultExistsSync } from "node:fs";
import path from "node:path";

/** Cursor ACP entry — never `--print` / stream-json. */
export const CURSOR_ACP_ARGS = ["acp"] as const;

export type ResolveCursorAgentExecutableOptions = {
  /** Test seam for HOME candidate probing. */
  existsSync?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
  /** Test seam for PATH lookup (defaults to `where.exe` / `which`). */
  which?: (name: string, env: NodeJS.ProcessEnv) => string | undefined;
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

/**
 * Resolve a bare command name on PATH: `where.exe` on Windows, `which` elsewhere.
 * Returns the first hit (full path) or undefined. On Windows this is what finds
 * `.cmd` shims, which `spawn(name)` cannot resolve by itself (CreateProcess only
 * tries `.exe`).
 */
function defaultWhich(name: string, env: NodeJS.ProcessEnv): string | undefined {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("where.exe", [name], {
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out
        .toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    }
    const out = execFileSync("which", [name], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = out.toString().split("\n")[0]?.trim();
    return first || undefined;
  } catch {
    return undefined;
  }
}

/** True when the executable is a Windows .cmd/.bat/.com shim (not directly spawnable). */
export function isWindowsShellScript(executable: string): boolean {
  return process.platform === "win32" && /\.(cmd|bat|com)$/i.test(path.basename(executable));
}

/**
 * Spawns Windows `.cmd`/`.bat` shims via `cmd.exe /d /s /c`.
 *
 * Why not `shell: true`: Node's argument quoting escapes backslashes, and
 * cmd.exe then mangles Windows paths (e.g. `C:\x\y.cmd` → `C:xy.cmd`).
 * Verbatim args keep the command line untouched for cmd.
 * Plain executables pass through unchanged.
 */
export function wrapForWindowsShellScript(
  executable: string,
  args: readonly string[],
): {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
} {
  if (!isWindowsShellScript(executable)) {
    return { command: executable, args: [...args], windowsVerbatimArguments: false };
  }
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", `"${executable}" ${args.join(" ")}`],
    windowsVerbatimArguments: true,
  };
}

export function resolveCursorAgentExecutable(
  explicit?: string,
  options: ResolveCursorAgentExecutableOptions = {},
): string {
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? defaultExistsSync;
  const configured = explicit?.trim() || env.CURSOR_AGENT_EXECUTABLE?.trim();
  if (configured) return configured;
  const home = env.HOME?.trim();
  // Cursor Agent 官方安装位置（Windows: %LOCALAPPDATA%\cursor-agent\agent.cmd；
  // POSIX: ~/.local/bin/agent、~/.cursor/bin/agent）。
  const candidates = [
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "cursor-agent", "agent.cmd") : "",
    home ? path.join(home, ".local", "bin", "agent") : "",
    home ? path.join(home, ".cursor", "bin", "agent") : "",
  ];
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  const fromPath = (options.which ?? defaultWhich)("agent", env);
  if (fromPath) return fromPath;
  return "agent";
}

export function spawnCursorAcpProcess(options: SpawnCursorAcpOptions = {}): ChildProcess {
  const executable = resolveCursorAgentExecutable(options.executable, {
    ...(options.env ? { env: options.env } : {}),
  });
  const spawnFn = options.spawnFn ?? spawn;
  const target = wrapForWindowsShellScript(executable, CURSOR_ACP_ARGS);
  const child = spawnFn(target.command, target.args, {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    // Ignore stderr so the pipe is never left unread (driver + handshake probe).
    stdio: ["pipe", "pipe", "ignore"],
    ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
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
