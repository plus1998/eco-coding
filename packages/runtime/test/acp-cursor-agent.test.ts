import { afterEach, describe, expect, mock, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  cursorAcpSpawnError,
  getCursorAcpDiagnostics,
  isWindowsShellScript,
  killProcessTree,
  killTrackedCursorAcpProcesses,
  redactCursorAcpStderr,
  resetTrackedCursorAcpPidsForTests,
  resolveCursorAgentExecutable,
  spawnCursorAcpProcess,
  wrapForWindowsShellScript,
} from "../src/acp-cursor-agent.js";

const TEST_TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-acp-agent");

describe("resolveCursorAgentExecutable", () => {
  let tempRoot: string | undefined;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
    mock.restore();
  });

  test("prefers explicit path over env and HOME candidates", () => {
    expect(
      resolveCursorAgentExecutable("/explicit/agent", {
        env: { CURSOR_AGENT_EXECUTABLE: "/from/env/agent", HOME: "/home/x" },
      }),
    ).toBe("/explicit/agent");
  });

  test("uses CURSOR_AGENT_EXECUTABLE when set", () => {
    expect(
      resolveCursorAgentExecutable(undefined, {
        env: { CURSOR_AGENT_EXECUTABLE: "/from/env/agent" },
      }),
    ).toBe("/from/env/agent");
  });

  test("resolves ~/.local/bin/agent then ~/.cursor/bin/agent before bare agent", () => {
    mkdirSync(TEST_TMP, { recursive: true });
    tempRoot = mkdtempSync(path.join(TEST_TMP, "home-"));
    const env = { HOME: tempRoot } as NodeJS.ProcessEnv;

    const localAgent = path.join(tempRoot, ".local", "bin", "agent");
    mkdirSync(path.dirname(localAgent), { recursive: true });
    writeFileSync(localAgent, "#!/bin/sh\n");
    expect(resolveCursorAgentExecutable(undefined, { env })).toBe(localAgent);

    const cursorAgent = path.join(tempRoot, ".cursor", "bin", "agent");
    // Avoid mkdir(".cursor") — sandbox EPERM; inject existsSync instead.
    expect(
      resolveCursorAgentExecutable(undefined, {
        env,
        existsSync: (p) => p === cursorAgent,
      }),
    ).toBe(cursorAgent);

    expect(
      resolveCursorAgentExecutable(undefined, {
        env,
        existsSync: () => false,
        which: () => undefined,
      }),
    ).toBe("agent");
  });

  test("falls back to PATH lookup (where/which) before bare agent", () => {
    expect(
      resolveCursorAgentExecutable(undefined, {
        env: { HOME: "/home/x" } as NodeJS.ProcessEnv,
        existsSync: () => false,
        which: () => "C:\\Users\\x\\AppData\\Local\\cursor-agent\\agent.cmd",
      }),
    ).toBe("C:\\Users\\x\\AppData\\Local\\cursor-agent\\agent.cmd");
  });

  test("uses %LOCALAPPDATA%\\cursor-agent\\agent.cmd when installed by the official installer", () => {
    const localAppData = "C:\\Users\\x\\AppData\\Local";
    const agentCmd = path.join(localAppData, "cursor-agent", "agent.cmd");
    expect(
      resolveCursorAgentExecutable(undefined, {
        env: { LOCALAPPDATA: localAppData } as NodeJS.ProcessEnv,
        existsSync: (p) => p === agentCmd,
        which: () => undefined,
      }),
    ).toBe(agentCmd);
  });
});

describe("isWindowsShellScript", () => {
  test("flags .cmd/.bat/.com as shell scripts, plain executables not", () => {
    expect(isWindowsShellScript("C:\\x\\agent.cmd")).toBe(process.platform === "win32");
    expect(isWindowsShellScript("C:\\x\\agent.bat")).toBe(process.platform === "win32");
    expect(isWindowsShellScript("C:\\x\\agent.exe")).toBe(false);
    expect(isWindowsShellScript("/usr/local/bin/agent")).toBe(false);
  });
});

describe("wrapForWindowsShellScript", () => {
  test("passes plain executables through unchanged", () => {
    expect(wrapForWindowsShellScript("/usr/local/bin/agent", ["acp"])).toEqual({
      command: "/usr/local/bin/agent",
      args: ["acp"],
      windowsVerbatimArguments: false,
    });
  });

  test("wraps Windows .cmd shims via cmd.exe /d /s /c with verbatim args", () => {
    const shim = path.win32.join("C:", "x", "agent.cmd");
    const onWin = process.platform === "win32";
    const result = wrapForWindowsShellScript(shim, ["acp"]);
    if (onWin) {
      expect(result).toEqual({
        command: "cmd.exe",
        args: ["/d", "/s", "/c", `"${shim}" acp`],
        windowsVerbatimArguments: true,
      });
    } else {
      expect(result).toEqual({
        command: shim,
        args: ["acp"],
        windowsVerbatimArguments: false,
      });
    }
  });
});

describe("spawnCursorAcpProcess", () => {
  afterEach(() => {
    resetTrackedCursorAcpPidsForTests();
    mock.restore();
  });

  test('spawns with args ["acp"] and never --print', () => {
    const calls: Array<{ file: string; args: string[]; options: import("node:child_process").SpawnOptions }> =
      [];
    const fakeChild = new EventEmitter() as ChildProcess;
    fakeChild.stdin = null;
    fakeChild.stdout = null;
    fakeChild.stderr = null;

    const spawnFn = ((file: string, args: string[], options: import("node:child_process").SpawnOptions) => {
      calls.push({ file, args: [...args], options });
      return fakeChild;
    }) as typeof import("node:child_process").spawn;

    const child = spawnCursorAcpProcess({
      executable: "/bin/eco-fake-agent",
      cwd: "/tmp/ws",
      spawnFn,
      managed: { platform: "linux", createJob: () => null, posixGraceMs: 0 },
    });

    expect(child).toBe(fakeChild);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("/bin/eco-fake-agent");
    expect(calls[0]?.args).toEqual(["acp"]);
    expect(calls[0]?.args).not.toContain("--print");
    expect(calls[0]?.args.some((a) => a.includes("stream-json"))).toBe(false);
    expect(calls[0]?.options.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(calls[0]?.options.detached).toBe(true);
  });

  test("captures bounded redacted stderr and process exit diagnostics", () => {
    const fakeChild = new EventEmitter() as ChildProcess;
    const stderr = new PassThrough();
    fakeChild.stdin = null;
    fakeChild.stdout = null;
    fakeChild.stderr = stderr as unknown as ChildProcess["stderr"];
    const spawnFn = (() => fakeChild) as typeof import("node:child_process").spawn;

    const child = spawnCursorAcpProcess({
      executable: "/bin/eco-fake-agent",
      spawnFn,
      managed: { platform: "linux", createJob: () => null, posixGraceMs: 0 },
    });
    stderr.write(
      'provider failed authorization: Bearer secret-bearer api_key="sk-secret-1234567890" url=https://example.test/?token=url-secret',
    );
    fakeChild.emit("exit", 17, null);

    expect(getCursorAcpDiagnostics(child)).toEqual({
      stderr:
        "provider failed authorization=[REDACTED] api_key=[REDACTED] url=https://example.test/?token=[REDACTED]",
      exitCode: 17,
    });
    expect(JSON.stringify(getCursorAcpDiagnostics(child))).not.toContain("secret");
  });

  test("redacts JWT, bearer, common key, and named secret values", () => {
    const redacted = redactCursorAcpStderr(
      "Authorization=Bearer opaque-token password: hunter2 jwt=eyJabc.def.ghi ck-abcdefghijklmnop",
    );
    expect(redacted).not.toContain("opaque-token");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("eyJabc.def.ghi");
    expect(redacted).not.toContain("ck-abcdefghijklmnop");
  });

  test("spawns Windows .cmd shims via cmd.exe with verbatim args, not shell: true", () => {
    const calls: Array<{ file: string; args: string[]; options: import("node:child_process").SpawnOptions }> =
      [];
    const fakeChild = new EventEmitter() as ChildProcess;
    fakeChild.stdin = null;
    fakeChild.stdout = null;
    fakeChild.stderr = null;

    const spawnFn = ((file: string, args: string[], options: import("node:child_process").SpawnOptions) => {
      calls.push({ file, args: [...args], options });
      return fakeChild;
    }) as typeof import("node:child_process").spawn;

    const shim = path.win32.join("C:", "Users", "x", "AppData", "Local", "cursor-agent", "agent.cmd");
    spawnCursorAcpProcess({
      executable: shim,
      spawnFn,
      managed: { platform: process.platform, createJob: () => null, posixGraceMs: 0 },
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    if (process.platform === "win32") {
      expect(call.file).toBe("cmd.exe");
      expect(call.args).toEqual(["/d", "/s", "/c", `"${shim}" acp`]);
      expect(call.options.windowsVerbatimArguments).toBe(true);
      expect(call.options.shell).toBeUndefined();
    } else {
      expect(call.file).toBe(shim);
      expect(call.args).toEqual(["acp"]);
    }
  });

  test("spawn ENOENT surfaces as child error event, not an uncaught exception", async () => {
    const fakeChild = new EventEmitter() as ChildProcess;
    const spawnFn = (() => fakeChild) as typeof import("node:child_process").spawn;

    const child = spawnCursorAcpProcess({
      executable: "agent",
      spawnFn,
      managed: { platform: "linux", createJob: () => null, posixGraceMs: 0 },
    });

    const enoent = Object.assign(new Error("spawn agent ENOENT"), {
      code: "ENOENT",
      errno: -4058,
    });
    // Async delivery, like real child_process.
    setImmediate(() => {
      fakeChild.emit("error", enoent);
    });

    const failed = await cursorAcpSpawnError(child).then(
      () => "settled" as const,
      (error: Error) => error,
    );
    expect(failed).toBe(enoent);
  });
});

describe("cursorAcpSpawnError", () => {
  test("does not settle when the child exits without error", async () => {
    const fakeChild = new EventEmitter() as ChildProcess;
    const pending = cursorAcpSpawnError(fakeChild);
    fakeChild.emit("exit", 0, null);

    // Must remain pending (Promise<never>) and never produce an unhandled rejection.
    const outcome = await Promise.race([
      pending.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"no-settle">((resolve) => {
        setTimeout(() => resolve("no-settle"), 25);
      }),
    ]);
    expect(outcome).toBe("no-settle");
  });
});

describe("killProcessTree / tracked ACP cleanup", () => {
  afterEach(() => {
    resetTrackedCursorAcpPidsForTests();
    mock.restore();
  });

  test("killProcessTree uses taskkill /T /F on Windows", () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    killProcessTree(4242, {
      platform: "win32",
      execFileSyncFn: ((command: string, args: readonly string[]) => {
        calls.push({ command, args: [...args] });
        return Buffer.from("");
      }) as typeof import("node:child_process").execFileSync,
    });
    expect(calls).toEqual([{ command: "taskkill", args: ["/PID", "4242", "/T", "/F"] }]);
  });

  test("killProcessTree prefers process-group SIGKILL on POSIX", () => {
    const killed: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
    killProcessTree(99, {
      platform: "linux",
      killFn: (pid, signal) => {
        killed.push({ pid, signal });
        return true;
      },
    });
    expect(killed).toEqual([{ pid: -99, signal: "SIGKILL" }]);
  });

  test("killTrackedCursorAcpProcesses disposes spawn-tracked managed processes", () => {
    const killed: Array<{ pid: number; signal?: NodeJS.Signals | number }> = [];
    const child = {
      pid: 777,
      killed: false,
      kill() {
        this.killed = true;
        return true;
      },
      on() {
        return this;
      },
      once() {
        return this;
      },
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    } as unknown as ChildProcess;
    const spawnFn = mock(() => child);
    spawnCursorAcpProcess({
      spawnFn,
      executable: "/fake/agent",
      managed: {
        platform: "linux",
        createJob: () => null,
        posixGraceMs: 0,
        killFn: (pid, signal) => {
          killed.push({ pid, signal });
          return true;
        },
      },
    });
    const count = killTrackedCursorAcpProcesses();
    expect(count).toBe(1);
    expect(killed).toEqual([{ pid: -777, signal: "SIGKILL" }]);
    expect(killTrackedCursorAcpProcesses()).toBe(0);
  });
});
