import { expect, test } from "bun:test";
import type { EcoTaskTrackerHooks } from "@eco/runtime";
import { createSdkTaskRunHooks, type SdkTaskStopStatus } from "../src/main/sdk-task-run-hooks";

function createBaseHooks(input: { calls: string[] }): {
  createHookHandlers(getStopStatus: () => SdkTaskStopStatus): EcoTaskTrackerHooks;
} {
  return {
    createHookHandlers: (getStopStatus) => ({
      peekPendingCoderTodoId: () => "todo_pending",
      onPreToolUse: (toolName) => {
        input.calls.push(`tool:${toolName}`);
      },
      onTaskCreated: (task) => {
        input.calls.push(`created:${task.taskId}`);
      },
      onTaskCompleted: (task) => {
        input.calls.push(`completed:${task.taskId}`);
      },
      onSubagentStart: (subagent) => {
        input.calls.push(`start:${subagent.agentId}`);
      },
      onSubagentStop: (subagent) => {
        input.calls.push(`stop:${subagent.agentId}`);
      },
      onStop: () => {
        input.calls.push(`stop-status:${getStopStatus()}`);
      },
    }),
  };
}

test("createSdkTaskRunHooks builds hook extras with pending todo hints", () => {
  const calls: string[] = [];
  const taskRunHooks = createSdkTaskRunHooks(createBaseHooks({ calls }));

  expect(taskRunHooks.hookContextExtras.peekPendingCoderTodoId?.()).toBe("todo_pending");
  expect(taskRunHooks.hookContextExtras.getStopTodoStatus?.()).toBe("completed");

  taskRunHooks.hookContextExtras.taskTracker?.onPreToolUse("TaskCreate", {});
  expect(calls).toEqual(["tool:TaskCreate"]);
});

test("stopIfUnhandled delegates once and uses the latest owner status", () => {
  const calls: string[] = [];
  const taskRunHooks = createSdkTaskRunHooks(createBaseHooks({ calls }));

  expect(taskRunHooks.stopIfUnhandled("blocked")).toBe(true);
  expect(taskRunHooks.wasStopHandled()).toBe(true);
  expect(taskRunHooks.getStopStatus()).toBe("blocked");
  expect(taskRunHooks.stopIfUnhandled("cancelled")).toBe(false);
  expect(calls).toEqual(["stop-status:blocked"]);
});

test("SDK Stop hook marks stop handled without overwriting owner status", () => {
  const calls: string[] = [];
  const taskRunHooks = createSdkTaskRunHooks(createBaseHooks({ calls }));

  taskRunHooks.setStopStatus("cancelled");
  taskRunHooks.hookContextExtras.taskTracker?.onStop("completed");

  expect(taskRunHooks.wasStopHandled()).toBe(true);
  expect(taskRunHooks.getStopStatus()).toBe("cancelled");
  expect(taskRunHooks.stopIfUnhandled("blocked")).toBe(false);
  expect(calls).toEqual(["stop-status:cancelled"]);
});
