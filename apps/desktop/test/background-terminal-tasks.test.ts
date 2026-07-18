import { expect, test } from "bun:test";
import { BackgroundTerminalTaskRegistry } from "../src/main/background-terminal-tasks";
import type { InteractiveTerminalManager } from "../src/main/interactive-terminal-manager";

test("BackgroundTerminalTaskRegistry starts, lists, exits, and stops tasks", () => {
  const commands: Array<{ workspacePath: string; command: readonly string[] }> = [];
  const killed: string[] = [];
  let sessionIndex = 0;
  const manager = {
    spawnCommand: (workspacePath: string, command: readonly string[]) => {
      commands.push({ workspacePath, command });
      return { sessionId: `session_${++sessionIndex}` };
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
  expect(commands).toHaveLength(1);
  expect(commands[0]?.workspacePath).toBe("/tmp/project");
  expect(commands[0]?.command.at(-1)).toBe("ready");
  expect(registry.list({ threadId: "thr_1" })).toHaveLength(1);

  registry.handleTerminalEvent({ type: "output", sessionId: task.sessionId, data: "building...\r\n" });
  expect(registry.get(task.taskId)?.output).toBe("building...\r\n");
  expect(registry.list({ threadId: "thr_1" })[0]?.output).toBeUndefined();

  registry.handleTerminalEvent({ type: "exit", sessionId: task.sessionId, exitCode: 1 });
  expect(registry.get(task.taskId)?.status).toBe("failed");
  expect(registry.get(task.taskId)?.exitCode).toBe(1);

  const completedStop = registry.stop(task.taskId);
  expect(completedStop.stopped).toBe(false);
  expect(completedStop.task?.status).toBe("failed");
  expect(killed).toEqual([]);

  const runningTask = registry.start({
    workspacePath: "/tmp/project",
    command: ["sleep", "10"],
  });
  const stopped = registry.stop(runningTask.taskId);
  expect(stopped.stopped).toBe(true);
  expect(stopped.task?.status).toBe("stopped");
  expect(killed).toEqual([runningTask.sessionId]);
});
