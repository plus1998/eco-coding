import { expect, test } from "bun:test";
import { BackgroundTerminalTaskRegistry } from "../src/main/background-terminal-tasks";
import type { InteractiveTerminalManager } from "../src/main/interactive-terminal-manager";

test("BackgroundTerminalTaskRegistry starts, lists, exits, and stops tasks", () => {
  const writes: Array<{ sessionId: string; data: string }> = [];
  const killed: string[] = [];
  let sessionIndex = 0;
  const manager = {
    spawn: () => ({ sessionId: `session_${++sessionIndex}` }),
    write: (sessionId: string, data: string) => {
      writes.push({ sessionId, data });
    },
    kill: (sessionId: string) => {
      killed.push(sessionId);
      return true;
    },
  } as unknown as InteractiveTerminalManager;
  const registry = new BackgroundTerminalTaskRegistry(manager);

  const task = registry.start({
    workspacePath: "/tmp/project",
    command: ["echo", "ready"],
    label: "dev server",
    threadId: "thr_1",
  });

  expect(task.taskId).toBeTruthy();
  expect(task.sessionId).toBe("session_1");
  expect(task.status).toBe("running");
  expect(task.threadId).toBe("thr_1");
  expect(writes).toHaveLength(1);
  expect(writes[0]?.data.endsWith("ready\r")).toBe(true);
  expect(registry.list({ threadId: "thr_1" })).toHaveLength(1);

  registry.handleTerminalEvent({ type: "exit", sessionId: task.sessionId, exitCode: 1 });
  expect(registry.get(task.taskId)?.status).toBe("failed");
  expect(registry.get(task.taskId)?.exitCode).toBe(1);

  const stopped = registry.stop(task.taskId);
  expect(stopped.stopped).toBe(true);
  expect(stopped.task?.status).toBe("stopped");
  expect(killed).toEqual([task.sessionId]);
});
