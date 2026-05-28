import { expect, test } from "bun:test";
import type { AgentEvent } from "../../shared/src";
import { type TerminalProcess, TerminalSessionManager, type TerminalSpawnRequest } from "../src";

const request: TerminalSpawnRequest = {
  sessionId: "term_1",
  threadId: "thr_1",
  agentId: "tester",
  command: ["bun", "test"],
  cwd: "/repo",
  workspacePath: "/repo",
};

class FakeProcess implements TerminalProcess {
  dataHandlers: Array<(data: string) => void> = [];
  exitHandlers: Array<(exitCode: number, signal?: string) => void> = [];
  killed = false;

  write(): void {}
  resize(): void {}
  kill(): void {
    this.killed = true;
  }
  onData(callback: (data: string) => void): void {
    this.dataHandlers.push(callback);
  }
  onExit(callback: (exitCode: number, signal?: string) => void): void {
    this.exitHandlers.push(callback);
  }
}

test("starts allowed terminal sessions and emits output events", () => {
  const events: AgentEvent[] = [];
  const process = new FakeProcess();
  const manager = new TerminalSessionManager(
    {
      spawn: () => process,
    },
    (event) => events.push(event),
  );

  const result = manager.start(request);
  expect(result.ok).toBe(true);

  process.dataHandlers[0]?.("ok\n");
  expect(events[0]).toMatchObject({
    type: "terminal.output",
    payload: { terminalSessionId: "term_1", data: "ok\n" },
  });
});

test("blocks terminal sessions that require approval", () => {
  const manager = new TerminalSessionManager(
    {
      spawn: () => new FakeProcess(),
    },
    () => {},
  );

  const result = manager.start({ ...request, command: ["rm", "-rf", "src"] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.decision.action).toBe("ask");
  }
});

test("removes terminal sessions after exit", () => {
  const process = new FakeProcess();
  const manager = new TerminalSessionManager(
    {
      spawn: () => process,
    },
    () => {},
  );

  manager.start(request);
  expect(manager.get("term_1")).toBeDefined();
  process.exitHandlers[0]?.(0);
  expect(manager.get("term_1")).toBeUndefined();
});
