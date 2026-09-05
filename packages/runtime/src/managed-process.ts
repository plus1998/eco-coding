/**
 * Managed child process trees (Zed-aligned).
 *
 * - Windows: Job Object + KILL_ON_JOB_CLOSE (nested Assign under Electron works on
 *   Win10+). Fallback: taskkill /T /F when Job create/assign fails.
 * - POSIX: detached process group + killpg (SIGTERM then SIGKILL).
 *
 * Only tracks processes spawned through {@link spawnManagedProcess} /
 * {@link adoptManagedProcess}. Never scans the machine by command line.
 */

import {
  type ChildProcess,
  execFileSync,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { createKillOnCloseJob, type WindowsJobHandle } from "./windows-job-object.js";

export type ManagedKillMode = "graceful" | "force";

export type ManagedProcess = {
  readonly child: ChildProcess;
  readonly pid: number | undefined;
  /** True when a Windows Job owns this tree (crash-safe reap). */
  readonly jobAttached: boolean;
  kill(mode?: ManagedKillMode): void;
  /** Force-kill the tree and release Job / tracking. Idempotent. */
  dispose(): void;
};

export type SpawnManagedProcessOptions = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Stdio for the child. Defaults to pipe/pipe/pipe.
   * POSIX uses `detached: true` so the child leads a new process group.
   */
  stdio?: SpawnOptions["stdio"];
  windowsVerbatimArguments?: boolean;
  windowsHide?: boolean;
  spawnFn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  platform?: NodeJS.Platform;
  /** Test seam — override Job creation (return null to force fallback). */
  createJob?: () => WindowsJobHandle | null;
  execFileSyncFn?: typeof execFileSync;
  killFn?: (pid: number, signal?: NodeJS.Signals | number) => boolean;
  /** Sync sleep between POSIX SIGTERM and SIGKILL (ms). */
  posixGraceMs?: number;
  log?: (line: string) => void;
};

const trackedManaged = new Set<ManagedProcess>();
const managedByChild = new WeakMap<ChildProcess, ManagedProcess>();

const DEFAULT_POSIX_GRACE_MS = 200;

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }
  try {
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    Atomics.wait(view, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // busy wait fallback when Atomics.wait unavailable
    }
  }
}

function taskkillTree(
  pid: number,
  exec: typeof execFileSync,
): void {
  try {
    exec("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    // already gone
  }
}

function killPosixGroup(
  pid: number,
  mode: ManagedKillMode,
  killFn: (pid: number, signal?: NodeJS.Signals | number) => boolean,
  graceMs: number,
): void {
  const term = () => {
    try {
      killFn(-pid, "SIGTERM");
    } catch {
      try {
        killFn(pid, "SIGTERM");
      } catch {
        // gone
      }
    }
  };
  const kill = () => {
    try {
      killFn(-pid, "SIGKILL");
    } catch {
      try {
        killFn(pid, "SIGKILL");
      } catch {
        // gone
      }
    }
  };
  if (mode === "graceful") {
    term();
    sleepSync(graceMs);
  }
  kill();
}

function createManagedProcess(
  child: ChildProcess,
  options: {
    platform: NodeJS.Platform;
    job: WindowsJobHandle | null;
    jobAttached: boolean;
    execFileSyncFn: typeof execFileSync;
    killFn: (pid: number, signal?: NodeJS.Signals | number) => boolean;
    posixGraceMs: number;
    log?: (line: string) => void;
  },
): ManagedProcess {
  let disposed = false;
  const managed: ManagedProcess = {
    child,
    get pid() {
      return child.pid;
    },
    jobAttached: options.jobAttached,
    kill(mode: ManagedKillMode = "force"): void {
      if (disposed) {
        return;
      }
      const pid = child.pid;
      if (options.platform === "win32") {
        if (options.job && options.jobAttached) {
          if (mode === "force") {
            options.job.terminate(1);
          } else {
            // Job has no graceful signal; terminate is the tree kill.
            options.job.terminate(1);
          }
          return;
        }
        if (typeof pid === "number" && pid > 0) {
          taskkillTree(pid, options.execFileSyncFn);
        }
        try {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        } catch {
          // gone
        }
        return;
      }
      if (typeof pid === "number" && pid > 0) {
        killPosixGroup(pid, mode, options.killFn, options.posixGraceMs);
      }
      try {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      } catch {
        // gone
      }
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      try {
        // Kill before flipping disposed — kill() no-ops once disposed.
        managed.kill("force");
      } finally {
        disposed = true;
        trackedManaged.delete(managed);
        managedByChild.delete(child);
        if (options.job) {
          // CloseHandle with KILL_ON_JOB_CLOSE reaps any survivors.
          options.job.close();
        }
      }
    },
  };

  trackedManaged.add(managed);
  managedByChild.set(child, managed);
  child.once("exit", () => {
    if (disposed) {
      return;
    }
    disposed = true;
    trackedManaged.delete(managed);
    managedByChild.delete(child);
    if (options.job) {
      options.job.close();
    }
  });
  return managed;
}

/**
 * Spawn a child and attach platform process-tree ownership.
 * POSIX: `detached: true` (new process group). Windows: Job when available.
 */
export function spawnManagedProcess(options: SpawnManagedProcessOptions): ManagedProcess {
  const platform = options.platform ?? process.platform;
  const spawnFn = options.spawnFn ?? spawn;
  const log = options.log;
  const posixGraceMs = options.posixGraceMs ?? DEFAULT_POSIX_GRACE_MS;
  const killFn = options.killFn ?? ((pid, signal) => process.kill(pid, signal));
  const execFileSyncFn = options.execFileSyncFn ?? execFileSync;

  const child = spawnFn(options.command, [...(options.args ?? [])], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    // New process group on POSIX so kill(-pid) / killpg works.
    ...(platform !== "win32" ? { detached: true } : {}),
    ...(options.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    ...(options.windowsHide !== undefined ? { windowsHide: options.windowsHide } : {}),
  });

  let job: WindowsJobHandle | null = null;
  let jobAttached = false;
  if (platform === "win32") {
    const createJob = options.createJob ?? createKillOnCloseJob;
    job = createJob();
    const pid = child.pid;
    if (job && typeof pid === "number" && pid > 0) {
      jobAttached = job.assignPid(pid);
      if (!jobAttached) {
        log?.(
          `[eco] Windows Job AssignProcessToJobObject failed for pid=${pid}; falling back to taskkill /T`,
        );
        job.close();
        job = null;
      }
    } else if (job) {
      // No pid yet (spawn failure / test fake) — do not keep an empty kill-on-close job.
      job.close();
      job = null;
    } else {
      log?.("[eco] Windows Job Object unavailable; falling back to taskkill /T for process trees");
    }
  }

  return createManagedProcess(child, {
    platform,
    job,
    jobAttached,
    execFileSyncFn,
    killFn,
    posixGraceMs,
    ...(log ? { log } : {}),
  });
}

/** Look up management for a child returned by ACP spawn helpers. */
export function getManagedProcess(child: ChildProcess): ManagedProcess | undefined {
  return managedByChild.get(child);
}

/** Dispose every still-tracked managed process (app quit). */
export function disposeAllManagedProcesses(): number {
  const list = [...trackedManaged];
  for (const managed of list) {
    managed.dispose();
  }
  return list.length;
}

/** Test seam. */
export function resetManagedProcessesForTests(): void {
  trackedManaged.clear();
}
