import { afterEach, describe, expect, mock, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  disposeAllManagedProcesses,
  resetManagedProcessesForTests,
  spawnManagedProcess,
} from "../src/managed-process.js";
import { createKillOnCloseJob, windowsJobObjectApisAvailable } from "../src/windows-job-object.js";

describe("spawnManagedProcess", () => {
  afterEach(() => {
    resetManagedProcessesForTests();
    mock.restore();
  });

  test("POSIX spawn sets detached for process-group ownership", () => {
    const calls: Array<{ options: import("node:child_process").SpawnOptions }> = [];
    const fake = new EventEmitter() as ChildProcess;
    fake.pid = 4242;
    const spawnFn = ((
      _cmd: string,
      _args: readonly string[],
      options: import("node:child_process").SpawnOptions,
    ) => {
      calls.push({ options });
      return fake;
    }) as typeof import("node:child_process").spawn;

    spawnManagedProcess({
      command: "/bin/true",
      args: [],
      platform: "linux",
      spawnFn,
      createJob: () => null,
      posixGraceMs: 0,
    });
    expect(calls[0]?.options.detached).toBe(true);
  });

  test("POSIX dispose sends SIGKILL to process group", () => {
    const fake = new EventEmitter() as ChildProcess;
    fake.pid = 99;
    fake.killed = false;
    fake.kill = () => {
      fake.killed = true;
      return true;
    };
    const killed: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
    const managed = spawnManagedProcess({
      command: "/bin/true",
      platform: "darwin",
      spawnFn: () => fake,
      createJob: () => null,
      posixGraceMs: 0,
      killFn: (pid, signal) => {
        killed.push({ pid, signal });
        return true;
      },
    });
    managed.dispose();
    expect(killed).toEqual([{ pid: -99, signal: "SIGKILL" }]);
    expect(disposeAllManagedProcesses()).toBe(0);
  });

  test("Windows falls back to taskkill when Job assign fails", () => {
    const fake = new EventEmitter() as ChildProcess;
    fake.pid = 55;
    fake.killed = false;
    fake.kill = () => {
      fake.killed = true;
      return true;
    };
    const taskkill: Array<{ command: string; args: readonly string[] }> = [];
    const job = {
      handle: {},
      assignPid: () => false,
      terminate: () => false,
      close: mock(() => {}),
    };
    const managed = spawnManagedProcess({
      command: "cmd.exe",
      args: ["/c", "echo"],
      platform: "win32",
      spawnFn: () => fake,
      createJob: () => job,
      execFileSyncFn: ((command: string, args: readonly string[]) => {
        taskkill.push({ command, args: [...args] });
        return Buffer.from("");
      }) as typeof import("node:child_process").execFileSync,
      log: () => {},
    });
    expect(managed.jobAttached).toBe(false);
    expect(job.close).toHaveBeenCalled();
    managed.dispose();
    expect(taskkill).toEqual([{ command: "taskkill", args: ["/PID", "55", "/T", "/F"] }]);
  });

  test("Windows Job terminate is used when assign succeeds", () => {
    const fake = new EventEmitter() as ChildProcess;
    fake.pid = 66;
    fake.killed = false;
    fake.kill = () => {
      fake.killed = true;
      return true;
    };
    const terminate = mock(() => true);
    const close = mock(() => {});
    const managed = spawnManagedProcess({
      command: "cmd.exe",
      platform: "win32",
      spawnFn: () => fake,
      createJob: () => ({
        handle: {},
        assignPid: () => true,
        terminate,
        close,
      }),
    });
    expect(managed.jobAttached).toBe(true);
    managed.dispose();
    expect(terminate).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});

describe("windows job object (live)", () => {
  test("createKillOnCloseJob assigns and terminates a real process tree on Windows", async () => {
    if (process.platform !== "win32" || !windowsJobObjectApisAvailable()) {
      return;
    }
    const child = spawn("cmd.exe", ["/d", "/s", "/c", "ping -n 60 127.0.0.1 >nul"], {
      stdio: "ignore",
      windowsHide: true,
    });
    expect(typeof child.pid).toBe("number");
    const job = createKillOnCloseJob();
    expect(job).not.toBeNull();
    expect(job!.assignPid(child.pid!)).toBe(true);
    expect(job!.terminate(1)).toBe(true);
    job!.close();
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(child.exitCode), 3000);
      child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code !== null || child.exitCode !== null).toBe(true);
  });
});
