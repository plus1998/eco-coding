import {
  type ChildProcess,
  execFileSync,
  type SpawnOptions,
} from "node:child_process";
import { existsSync as defaultExistsSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
  disposeAllManagedProcesses,
  getManagedProcess,
  type ManagedProcess,
  type SpawnManagedProcessOptions,
  resetManagedProcessesForTests,
  spawnManagedProcess,
} from "./managed-process.js";

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
  spawnFn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  /** Test seams for Job / process-group ownership. */
  managed?: Pick<
    SpawnManagedProcessOptions,
    "platform" | "createJob" | "killFn" | "execFileSyncFn" | "posixGraceMs" | "log"
  >;
};

const CURSOR_ACP_STDERR_LIMIT = 32 * 1024;
const SENSITIVE_STDERR_VALUE =
  /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|device[_-]?secret|client[_-]?secret|password)["']?\s*[:=]\s*["']?(?:bearer\s+)?([^\s,"';}]+)["']?/gi;
const SENSITIVE_URL_VALUE =
  /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|token)=)[^&#\s]+/gi;
const BEARER_STDERR_VALUE = /\bbearer\s+[^\s,;]+/gi;
const JWT_STDERR_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const COMMON_API_KEY_VALUE = /\b(?:sk|ck|key)-[A-Za-z0-9_-]{12,}\b/g;

export interface CursorAcpDiagnostics {
  readonly stderr: string;
  readonly exitCode?: number;
  readonly exitSignal?: NodeJS.Signals;
}

const cursorAcpDiagnostics = new WeakMap<ChildProcess, CursorAcpDiagnostics>();

/** Bounded, redacted diagnostics captured from Cursor ACP stderr and exit. */
export function getCursorAcpDiagnostics(child: ChildProcess): CursorAcpDiagnostics {
  return cursorAcpDiagnostics.get(child) ?? { stderr: "" };
}

export function redactCursorAcpStderr(value: string): string {
  return value
    .replace(SENSITIVE_STDERR_VALUE, (_match, name: string) => `${name}=[REDACTED]`)
    .replace(SENSITIVE_URL_VALUE, "$1[REDACTED]")
    .replace(BEARER_STDERR_VALUE, "Bearer [REDACTED]")
    .replace(JWT_STDERR_VALUE, "[REDACTED_JWT]")
    .replace(COMMON_API_KEY_VALUE, "[REDACTED_API_KEY]");
}

function captureCursorAcpDiagnostics(child: ChildProcess): void {
  let stderr = "";
  const decoder = new StringDecoder("utf8");
  const update = (next: Partial<CursorAcpDiagnostics>) => {
    cursorAcpDiagnostics.set(child, {
      ...getCursorAcpDiagnostics(child),
      ...next,
    });
  };
  const append = (value: string) => {
    stderr = `${stderr}${value}`.slice(-CURSOR_ACP_STDERR_LIMIT);
    update({ stderr: redactCursorAcpStderr(stderr).trim() });
  };
  child.stderr?.on("data", (chunk: Buffer | string) => {
    append(typeof chunk === "string" ? chunk : decoder.write(chunk));
  });
  child.stderr?.once("end", () => {
    const remainder = decoder.end();
    if (remainder) append(remainder);
  });
  child.once("exit", (code, signal) => {
    update({
      ...(typeof code === "number" ? { exitCode: code } : {}),
      ...(signal ? { exitSignal: signal } : {}),
    });
  });
}

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

export type KillProcessTreeOptions = {
  platform?: NodeJS.Platform;
  execFileSyncFn?: typeof execFileSync;
  killFn?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
};

/**
 * @deprecated Prefer {@link killChildProcessTree} / ManagedProcess.dispose.
 * Kept for tests that assert taskkill / killpg argument shapes.
 */
export function killProcessTree(pid: number, options: KillProcessTreeOptions = {}): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    const exec = options.execFileSyncFn ?? execFileSync;
    try {
      exec("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Process may already be gone.
    }
    return;
  }
  const kill = options.killFn ?? ((target, signal) => process.kill(target, signal));
  try {
    kill(-pid, "SIGKILL");
  } catch {
    try {
      kill(pid, "SIGKILL");
    } catch {
      // Process may already be gone.
    }
  }
}

/**
 * Kill an ACP child and its full process tree (Job / process group / taskkill).
 * Uses the ManagedProcess registered at spawn when present.
 */
export function killChildProcessTree(
  child: ChildProcess,
  options: KillProcessTreeOptions = {},
): void {
  const managed = getManagedProcess(child);
  if (managed) {
    managed.dispose();
    return;
  }
  // Legacy / test fakes without ManagedProcess registration.
  const pid = child.pid;
  if (typeof pid === "number" && pid > 0) {
    killProcessTree(pid, options);
  }
  try {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  } catch {
    // process may already be gone
  }
}

/**
 * Dispose every Cursor ACP tree this process still tracks (app quit).
 * Does not scan the machine for other programs' agents.
 */
export function killTrackedCursorAcpProcesses(_options: KillProcessTreeOptions = {}): number {
  return disposeAllManagedProcesses();
}

/** Test seam — reset tracked managed ACP processes between cases. */
export function resetTrackedCursorAcpPidsForTests(): void {
  resetManagedProcessesForTests();
}

export function spawnCursorAcpProcess(options: SpawnCursorAcpOptions = {}): ChildProcess {
  // options.env is a partial override (e.g. { CURSOR_API_KEY }); merge over
  // process.env so discovery keeps HOME/LOCALAPPDATA/PATH.
  const executable = resolveCursorAgentExecutable(options.executable, {
    env: { ...process.env, ...(options.env ?? {}) },
  });
  const target = wrapForWindowsShellScript(executable, CURSOR_ACP_ARGS);
  const managed = spawnManagedProcess({
    command: target.command,
    args: target.args,
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    ...(options.spawnFn ? { spawnFn: options.spawnFn } : {}),
    log:
      options.managed?.log ??
      ((line) => {
        process.stderr.write(`${line}\n`);
      }),
    ...(options.managed?.platform !== undefined ? { platform: options.managed.platform } : {}),
    ...(options.managed?.createJob !== undefined ? { createJob: options.managed.createJob } : {}),
    ...(options.managed?.killFn ? { killFn: options.managed.killFn } : {}),
    ...(options.managed?.execFileSyncFn ? { execFileSyncFn: options.managed.execFileSyncFn } : {}),
    ...(options.managed?.posixGraceMs !== undefined
      ? { posixGraceMs: options.managed.posixGraceMs }
      : {}),
  });
  const child = managed.child;
  captureCursorAcpDiagnostics(child);
  // Spawn failures (e.g. ENOENT when Cursor is not installed) surface as an
  // async `error` event; without at least one listener the Electron main
  // process dies with an uncaught exception. This listener makes the event
  // safe to consume later via cursorAcpSpawnError().
  child.on("error", () => {});
  return child;
}

/** Return the ManagedProcess for an ACP child when spawn registered one. */
export function getCursorAcpManagedProcess(child: ChildProcess): ManagedProcess | undefined {
  return getManagedProcess(child);
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
