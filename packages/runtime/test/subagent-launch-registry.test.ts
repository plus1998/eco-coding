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
