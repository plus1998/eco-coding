import { expect, test } from "bun:test";
import { SubagentToolUseIndex } from "../src/main/subagent-tool-use-index";

test("SubagentToolUseIndex consumes pending tool uses in start order", () => {
  const index = new SubagentToolUseIndex();
  expect(index.note("toolu_task_a")).toEqual({ pending: true, pendingCount: 1 });
  expect(index.note("toolu_task_b")).toEqual({ pending: true, pendingCount: 2 });

  expect(index.consumeForRole("coder")).toBe("toolu_task_a");
  index.link("toolu_task_a", "agent_coder_a");
  expect(index.consumeForRole("coder")).toBe("toolu_task_b");
  index.link("toolu_task_b", "agent_coder_b");

  expect(index.resolve("toolu_task_a")).toBe("agent_coder_a");
  expect(index.resolve("toolu_task_b")).toBe("agent_coder_b");
  expect(index.mappedCount).toBe(2);
});

test("SubagentToolUseIndex prefers matching roles before unscoped pending tools", () => {
  const index = new SubagentToolUseIndex();
  index.note("toolu_explore", "explore");
  index.note("toolu_unscoped");
  index.note("toolu_coder", "coder");

  expect(index.consumeForRole("coder")).toBe("toolu_coder");
  expect(index.consumeForRole("reviewer")).toBe("toolu_unscoped");
  expect(index.consumeForRole("explore")).toBe("toolu_explore");
});

test("SubagentToolUseIndex link removes pending entries", () => {
  const index = new SubagentToolUseIndex();
  index.note("toolu_task", "coder");
  index.link("toolu_task", "agent_coder");

  expect(index.note("toolu_task", "coder")).toEqual({ pending: false, pendingCount: 0 });
  expect(index.consumeForRole("coder")).toBeUndefined();
  expect(index.resolve("toolu_task")).toBe("agent_coder");
});

test("SubagentToolUseIndex links the next pending tool use for a role atomically", () => {
  const index = new SubagentToolUseIndex();
  index.note("toolu_explore", "explore");
  index.note("toolu_coder", "coder");

  expect(index.linkNextPendingForRole("coder", "agent_coder")).toEqual({
    toolUseId: "toolu_coder",
    mappedCount: 1,
  });
  expect(index.resolve("toolu_coder")).toBe("agent_coder");
  expect(index.consumeForRole("coder")).toBeUndefined();

  expect(index.linkNextPendingForRole("tester", "agent_tester")).toEqual({
    mappedCount: 1,
  });
});
