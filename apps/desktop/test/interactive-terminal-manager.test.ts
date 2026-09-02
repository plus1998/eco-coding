import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type PtyHandler = (data: string) => void;
type ExitHandler = (event: { exitCode: number; signal?: number }) => void;

interface MockPty {
  onData: ReturnType<typeof mock<(handler: PtyHandler) => void>>;
  onExit: ReturnType<typeof mock<(handler: ExitHandler) => void>>;
  write: ReturnType<typeof mock<(data: string) => void>>;
  resize: ReturnType<typeof mock<(cols: number, rows: number) => void>>;
  kill: ReturnType<typeof mock<() => void>>;
  emitData: (data: string) => void;
  emitExit: (exitCode: number, signal?: number) => void;
}

const spawned: MockPty[] = [];
const spawnRequests: Array<{ executable: string; args: string[]; cwd: string }> = [];
let dataHandler: PtyHandler | undefined;
let exitHandler: ExitHandler | undefined;

function createMockPty(): MockPty {
  const mockPty: MockPty = {
    onData: mock((handler: PtyHandler) => {
      dataHandler = handler;
    }),
    onExit: mock((handler: ExitHandler) => {
      exitHandler = handler;
    }),
    write: mock(() => undefined),
    resize: mock(() => undefined),
    kill: mock(() => undefined),
    emitData(data: string) {
      dataHandler?.(data);
    },
    emitExit(exitCode: number, signal?: number) {
      exitHandler?.({ exitCode, ...(signal !== undefined && { signal }) });
    },
  };
  spawned.push(mockPty);
  return mockPty;
}

function requireSpawned(index: number): MockPty {
  const value = spawned[index];
  if (!value) {
    throw new Error(`spawned pty ${index} missing`);
  }
  return value;
}

mock.module("node-pty", () => ({
  spawn: mock((executable: string, args: string[], options: { cwd: string }) => {
    spawnRequests.push({ executable, args, cwd: options.cwd });
    return createMockPty();
  }),
}));

const { InteractiveTerminalManager } = await import("../src/main/interactive-terminal-manager");

describe("InteractiveTerminalManager", () => {
  const workspaceRoot = join(tmpdir(), `eco-terminal-test-${Date.now()}`);
  const events: Array<{ type: string; sessionId: string; [key: string]: unknown }> = [];

  beforeEach(() => {
    events.length = 0;
    spawned.length = 0;
    spawnRequests.length = 0;
    dataHandler = undefined;
    exitHandler = undefined;
    mkdirSync(workspaceRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  test("spawns a session in the workspace directory", () => {
    const manager = new InteractiveTerminalManager((event) => {
      events.push(event as { type: string; sessionId: string });
    });

    const result = manager.spawn(workspaceRoot, { cols: 100, rows: 24 });

    expect(result.sessionId).toBeTruthy();
    expect(spawned).toHaveLength(1);
    expect(manager.get(result.sessionId)?.workspacePath).toBe(workspaceRoot);
    expect(events).toEqual([{ type: "started", sessionId: result.sessionId, workspacePath: workspaceRoot }]);
  });

  test("rejects missing workspace directories", () => {
    const manager = new InteractiveTerminalManager(() => undefined);
    const missingPath = join(workspaceRoot, "missing");

    expect(() => manager.spawn(missingPath)).toThrow(/does not exist/);
    expect(existsSync(missingPath)).toBe(false);
  });

  test("spawns a command directly so its exit completes the session", () => {
    const manager = new InteractiveTerminalManager((event) => {
      events.push(event as { type: string; sessionId: string });
    });

    const { sessionId } = manager.spawnCommand(workspaceRoot, ["npm", "run", "build"]);
    requireSpawned(0).emitExit(0);

    if (process.platform === "win32") {
      expect(spawnRequests[0]?.executable.toLowerCase()).toContain("cmd.exe");
      expect(spawnRequests[0]?.args).toEqual(["/d", "/s", "/c", "npm run build"]);
    } else {
      expect(spawnRequests).toEqual([{ executable: "npm", args: ["run", "build"], cwd: workspaceRoot }]);
    }
    expect(events.at(-1)).toEqual({ type: "exit", sessionId, exitCode: 0 });
    expect(manager.get(sessionId)).toBeUndefined();
  });

  test("supports multiple concurrent sessions", () => {
    const manager = new InteractiveTerminalManager(() => undefined);
    const first = manager.spawn(workspaceRoot);
    const second = manager.spawn(workspaceRoot);

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(spawned).toHaveLength(2);
    expect(manager.get(first.sessionId)?.sessionId).toBe(first.sessionId);
    expect(manager.get(second.sessionId)?.sessionId).toBe(second.sessionId);
    expect(manager.list(workspaceRoot)).toEqual([
      { sessionId: first.sessionId, workspacePath: workspaceRoot },
      { sessionId: second.sessionId, workspacePath: workspaceRoot },
    ]);
  });

  test("writes input and resizes the active session", () => {
    const manager = new InteractiveTerminalManager(() => undefined);
    const { sessionId } = manager.spawn(workspaceRoot);
    const activePty = requireSpawned(0);

    manager.write(sessionId, "ls\n");
    manager.resize(sessionId, 132, 40);

    expect(activePty.write).toHaveBeenCalledWith("ls\n");
    expect(activePty.resize).toHaveBeenCalledWith(132, 40);
  });

  test("emits output and exit events", () => {
    const manager = new InteractiveTerminalManager((event) => {
      events.push(event as { type: string; sessionId: string });
    });
    const { sessionId } = manager.spawn(workspaceRoot);
    const activePty = requireSpawned(0);

    activePty.emitData("hello");
    activePty.emitExit(0);

    expect(events).toEqual([
      { type: "started", sessionId, workspacePath: workspaceRoot },
      { type: "output", sessionId, data: "hello" },
      { type: "exit", sessionId, exitCode: 0 },
    ]);
    expect(manager.get(sessionId)).toBeUndefined();
  });

  test("kill removes the active session", () => {
    const manager = new InteractiveTerminalManager(() => undefined);
    const { sessionId } = manager.spawn(workspaceRoot);
    const activePty = requireSpawned(0);

    expect(manager.kill(sessionId)).toBe(true);
    expect(activePty.kill).toHaveBeenCalled();
    expect(manager.get(sessionId)).toBeUndefined();
    expect(manager.kill(sessionId)).toBe(false);
  });
});
