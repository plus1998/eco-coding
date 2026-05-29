import { expect, test } from "bun:test";
import {
  completeRunningCoderTodos,
  extractCoderTasksFromText,
  findCoderTodoForPrompt,
  mergeCoderTodoItems,
  updateCoderTodoStatus,
} from "../src/main/coder-tasks";

test("extracts numbered Coder Tasks into todo drafts", () => {
  const tasks = extractCoderTasksFromText(`
## Coder Tasks
1. title: Add todo IPC
   scope: shared types and preload
   files/areas: apps/desktop/src/shared/ipc.ts
   parallel_group: A
2. title: Render todo panel
   scope: React UI
   dependencies: task 1

## Review
Check UI.
`);

  expect(tasks).toEqual([
    {
      title: "Add todo IPC",
      detail:
        "title: Add todo IPC\nscope: shared types and preload\nfiles/areas: apps/desktop/src/shared/ipc.ts\nparallel_group: A",
    },
    {
      title: "Render todo panel",
      detail: "title: Render todo panel\nscope: React UI\ndependencies: task 1",
    },
  ]);
});

test("preserves todo status while replacing parsed task details", () => {
  const initial = mergeCoderTodoItems("thr_1", [
    { title: "Add todo IPC", detail: "title: Add todo IPC" },
  ]);
  const running = updateCoderTodoStatus(initial, initial[0]!.id, "running");
  const merged = mergeCoderTodoItems("thr_1", [
    { title: "Add todo IPC", detail: "title: Add todo IPC\nscope: updated" },
  ], running);

  expect(merged[0]).toMatchObject({
    id: initial[0]!.id,
    status: "running",
    detail: "title: Add todo IPC\nscope: updated",
  });
});

test("matches coder prompts to todo titles and completes running items", () => {
  const todos = mergeCoderTodoItems("thr_1", [
    { title: "Add todo IPC", detail: "title: Add todo IPC" },
    { title: "Render todo panel", detail: "title: Render todo panel" },
  ]);

  const matched = findCoderTodoForPrompt(todos, "Please implement: Render todo panel");
  expect(matched?.title).toBe("Render todo panel");

  const running = updateCoderTodoStatus(todos, matched!.id, "running");
  expect(completeRunningCoderTodos(running, "completed")[1]?.status).toBe("completed");
});
