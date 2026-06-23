import { expect, test } from "bun:test";
import { SubagentLaunchRegistry } from "../src/subagent-launch-registry";

test("SubagentLaunchRegistry take removes launch by parentToolUseId", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_a",
    role: "coder",
    prompt: "Task A",
  });
  registry.register({
    parentToolUseId: "toolu_b",
    role: "coder",
    prompt: "Task B",
  });

  expect(registry.take("toolu_b")).toMatchObject({
    parentToolUseId: "toolu_b",
    prompt: "Task B",
  });
  expect(registry.peek("toolu_b")).toBeUndefined();
  expect(registry.take("toolu_a")).toMatchObject({
    parentToolUseId: "toolu_a",
    prompt: "Task A",
  });
});

test("SubagentLaunchRegistry takeForSubagentStart resolves single pending launch without parentToolUseId", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_coder",
    role: "coder",
    prompt: "Implement API",
  });

  expect(
    registry.takeForSubagentStart({
      role: "coder",
    }),
  ).toMatchObject({
    parentToolUseId: "toolu_coder",
    prompt: "Implement API",
  });
});

test("SubagentLaunchRegistry takeForSubagentStart resolves unique role match without parentToolUseId", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_explore",
    role: "explore",
    prompt: "Map auth module",
  });
  registry.register({
    parentToolUseId: "toolu_coder",
    role: "coder",
    prompt: "Implement API",
  });

  expect(
    registry.takeForSubagentStart({
      role: "coder",
    }),
  ).toMatchObject({
    parentToolUseId: "toolu_coder",
    prompt: "Implement API",
  });
  expect(registry.peek("toolu_explore")).toBeDefined();
});

test("SubagentLaunchRegistry takeForSubagentStart refuses ambiguous same-role launches", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_a",
    role: "coder",
    prompt: "Task A",
  });
  registry.register({
    parentToolUseId: "toolu_b",
    role: "coder",
    prompt: "Task B",
  });

  expect(
    registry.takeForSubagentStart({
      role: "coder",
    }),
  ).toBeUndefined();
  expect(registry.peek("toolu_a")).toBeDefined();
  expect(registry.peek("toolu_b")).toBeDefined();
});
