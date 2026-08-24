import { expect, test } from "bun:test";
import {
  applyAcpPlanProgress,
  coderTodosFromAcpPlan,
  isAcpPlanTodoPayload,
  mapAcpPlanEntryStatus,
  mapAcpPlanStatusToCoder,
  parseAcpPlanEntries,
} from "../src/main/acp-plan-progress";
import type { CoderTodoItem } from "../src/shared/ipc";

test("ACP plan payload guard accepts liveType acp.plan with entries", () => {
  expect(isAcpPlanTodoPayload({ liveType: "acp.plan", entries: [] })).toBe(true);
  expect(isAcpPlanTodoPayload({ liveType: "acp.plan", entries: [{ content: "A" }] })).toBe(true);
  expect(isAcpPlanTodoPayload({ liveType: "todo.updated", entries: [] })).toBe(false);
  expect(isAcpPlanTodoPayload({ liveType: "acp.plan" })).toBe(false);
  expect(isAcpPlanTodoPayload(null)).toBe(false);
});

test("parseAcpPlanEntries reads content/status/priority and skips invalid rows", () => {
  expect(
    parseAcpPlanEntries([
      { content: "核对 ACP", priority: "medium", status: "pending" },
      { content: "  ", status: "completed" },
      null,
      { step: "legacy step field", status: "in_progress" },
      { content: "Done", status: "completed", priority: "high" },
    ]),
  ).toEqual([
    { content: "核对 ACP", status: "pending", priority: "medium" },
    { content: "legacy step field", status: "in_progress" },
    { content: "Done", status: "completed", priority: "high" },
  ]);
});

test("ACP plan maps statuses and preserves ids by normalized content", () => {
  expect(mapAcpPlanEntryStatus("pending")).toBe("pending");
  expect(mapAcpPlanEntryStatus("in_progress")).toBe("in_progress");
  expect(mapAcpPlanEntryStatus("inProgress")).toBe("in_progress");
  expect(mapAcpPlanEntryStatus("running")).toBe("in_progress");
  expect(mapAcpPlanEntryStatus("completed")).toBe("completed");
  expect(mapAcpPlanStatusToCoder("in_progress")).toBe("running");

  const first = coderTodosFromAcpPlan(
    "thr_1",
    [
      { content: "Inspect protocol", status: "completed" },
      { content: "Wire progress", status: "in_progress", priority: "high" },
    ],
    [],
    "2026-08-24T00:00:00.000Z",
  );
  const second = coderTodosFromAcpPlan(
    "thr_1",
    [
      { content: " wire   progress ", status: "completed" },
      { content: "Run tests", status: "pending" },
    ],
    first,
    "2026-08-24T00:01:00.000Z",
  );

  expect(first[1]).toMatchObject({
    title: "Wire progress",
    detail: "Wire progress (high)",
    status: "running",
  });
  expect(second).toHaveLength(2);
  expect(second[0]?.id).toBe(first[1]?.id);
  expect(second[0]).toMatchObject({
    title: "wire   progress",
    status: "completed",
    position: 0,
    updatedAt: "2026-08-24T00:01:00.000Z",
  });
  expect(second[1]?.id).not.toBe(first[1]?.id);
});

test("applyAcpPlanProgress replaces todos and emits the snapshot", () => {
  let stored: CoderTodoItem[] = [
    {
      id: "old",
      threadId: "thr_1",
      title: "Old task",
      detail: "Old task",
      status: "running",
      position: 0,
      updatedAt: "2026-08-08T00:00:00.000Z",
    },
  ];
  const emitted: CoderTodoItem[][] = [];
  const services = {
    listTodos: () => stored,
    replaceTodos: (_threadId: string, todos: CoderTodoItem[]) => {
      stored = todos;
    },
    emitTodoList: (_threadId: string, todos: CoderTodoItem[]) => emitted.push(todos),
  };

  applyAcpPlanProgress({
    threadId: "thr_1",
    entries: [
      { content: "核对 ACP 协议对接", priority: "medium", status: "pending" },
      { content: "端到端验证", priority: "medium", status: "in_progress" },
    ],
    services,
    now: "2026-08-24T00:00:00.000Z",
  });

  expect(stored).toEqual(emitted[0]);
  expect(stored).toMatchObject([
    { title: "核对 ACP 协议对接", status: "pending", position: 0 },
    { title: "端到端验证", status: "running", position: 1 },
  ]);

  applyAcpPlanProgress({
    threadId: "thr_1",
    entries: [],
    services,
    now: "2026-08-24T00:01:00.000Z",
  });
  expect(stored).toEqual([]);
  expect(emitted.at(-1)).toEqual([]);
});
