import { expect, test } from "bun:test";
import { validateSdkExecutionCompletion } from "../src/main/sdk-execution-completion";

test("execution completion rejects open tasks", () => {
  expect(
    validateSdkExecutionCompletion(
      { ok: true },
      {
        openTasks: [{ id: "task_1", title: "Implement panel", status: "running" }],
        hasSubstantiveToolUse: true,
        substantiveToolNames: ["Edit"],
      },
    ),
  ).toMatchObject({ ok: false, incomplete: true });
});

test("execution completion rejects actionless SDK success", () => {
  expect(
    validateSdkExecutionCompletion(
      { ok: true },
      { openTasks: [], hasSubstantiveToolUse: false, substantiveToolNames: [] },
    ),
  ).toEqual({
    ok: false,
    incomplete: true,
    reason: "执行未完成：本轮没有成功执行写入、命令或验证工具，无法确认需求已经实施。",
  });
});

test("execution completion accepts completed tasks with substantive evidence", () => {
  const result = { ok: true } as const;
  expect(
    validateSdkExecutionCompletion(result, {
      openTasks: [],
      hasSubstantiveToolUse: true,
      substantiveToolNames: ["Bash", "Edit"],
    }),
  ).toBe(result);
});

test("execution completion preserves SDK failures", () => {
  const result = { ok: false, reason: "upstream failed" } as const;
  expect(
    validateSdkExecutionCompletion(result, {
      openTasks: [],
      hasSubstantiveToolUse: false,
      substantiveToolNames: [],
    }),
  ).toBe(result);
});
