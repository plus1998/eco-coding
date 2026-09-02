import { expect, test } from "bun:test";
import { mergeCoderTodoItems } from "../src/main/coder-tasks";
import {
  coderTodosFromTodoWrite,
  mapTodoWriteStatusToCoder,
  parseTodoWriteToolInput,
} from "../src/main/todo-write";

test("parseTodoWriteToolInput reads todos array", () => {
  const items = parseTodoWriteToolInput({
    todos: [
      {
        content: "补齐回传抑制实体",
        activeForm: "正在补齐回传抑制实体",
        status: "completed",
      },
      {
        content: "修正队列原子计数",
        activeForm: "正在修正队列原子计数",
        status: "in_progress",
      },
      { content: "补齐前端配置项", status: "pending" },
    ],
  });

  expect(items).toHaveLength(3);
  expect(items[1]?.status).toBe("in_progress");
});

test("coderTodosFromTodoWrite maps statuses like Codex update_plan", () => {
  const first = coderTodosFromTodoWrite("thr_1", [
    { content: "Step A", status: "pending" },
    { content: "Step B", status: "pending" },
  ]);
  const second = coderTodosFromTodoWrite(
    "thr_1",
    [
      { content: "Step A", status: "completed" },
      { content: "Step B", status: "in_progress", activeForm: "Working on Step B" },
    ],
    first,
  );

  expect(mapTodoWriteStatusToCoder("in_progress")).toBe("running");
  expect(second[0]?.status).toBe("completed");
  expect(second[0]?.id).toBe(first[0]?.id);
  expect(second[1]?.status).toBe("running");
  expect(second[1]?.detail).toBe("Working on Step B");
});

test("TodoWrite replaces list order and length", () => {
  const initial = mergeCoderTodoItems("thr_1", [{ title: "Old task", detail: "Old task" }]);
  const replaced = coderTodosFromTodoWrite(
    "thr_1",
    [
      { content: "New 1", status: "in_progress" },
      { content: "New 2", status: "pending" },
    ],
    initial,
  );

  expect(replaced).toHaveLength(2);
  expect(replaced[0]?.title).toBe("New 1");
});
