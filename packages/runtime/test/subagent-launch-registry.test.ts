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

test("SubagentLaunchRegistry takeForSubagentStart takes sole pending launch for role", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_coder",
    role: "coder",
    prompt: "Implement API",
  });

  expect(registry.takeForSubagentStart({ role: "coder" })).toMatchObject({
    parentToolUseId: "toolu_coder",
    prompt: "Implement API",
  });
  expect(registry.peek("toolu_coder")).toBeUndefined();
});

test("SubagentLaunchRegistry takeForSubagentStart does not guess with no pending launches", () => {
  const registry = new SubagentLaunchRegistry();
  expect(registry.takeForSubagentStart({ role: "coder" })).toBeUndefined();
});

test("SubagentLaunchRegistry resolveFromStreamParentToolUseId pairs structured parent id", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "call_00_cpu",
    role: "explore",
    prompt: "Gather CPU info",
  });
  registry.noteSubagentAwaitingStream("agent_cpu", "explore");

  expect(registry.resolveFromStreamParentToolUseId("call_00_cpu")).toMatchObject({
    agentId: "agent_cpu",
    launch: {
      parentToolUseId: "call_00_cpu",
      prompt: "Gather CPU info",
    },
    matchMethod: "streamParentToolUseId",
  });
  expect(registry.peek("call_00_cpu")).toBeUndefined();
});

test("SubagentLaunchRegistry resolveFromStreamParentToolUseId supports stream-before-start ordering", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "call_01_gpu",
    role: "explore",
    prompt: "Gather GPU info",
  });

  expect(registry.resolveFromStreamParentToolUseId("call_01_gpu")).toBeUndefined();
  expect(registry.noteSubagentAwaitingStream("agent_gpu", "explore")).toMatchObject({
    agentId: "agent_gpu",
    launch: {
      parentToolUseId: "call_01_gpu",
      prompt: "Gather GPU info",
    },
  });
});

test("SubagentLaunchRegistry resolveFromStreamParentToolUseId pairs parallel explores by parent id", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "call_00_cpu",
    role: "explore",
    prompt: "Gather CPU info",
  });
  registry.register({
    parentToolUseId: "call_01_gpu",
    role: "explore",
    prompt: "Gather GPU info",
  });
  registry.noteSubagentAwaitingStream("agent_cpu", "explore");
  registry.noteSubagentAwaitingStream("agent_gpu", "explore");

  expect(registry.resolveFromStreamParentToolUseId("call_00_cpu")).toMatchObject({
    agentId: "agent_cpu",
    launch: { parentToolUseId: "call_00_cpu" },
  });
  expect(registry.resolveFromStreamParentToolUseId("call_01_gpu")).toMatchObject({
    agentId: "agent_gpu",
    launch: { parentToolUseId: "call_01_gpu" },
  });
});

test("SubagentLaunchRegistry takeForSubagentStart defers to stream when hook callback mismatches", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "call_00_cpu",
    role: "explore",
    prompt: "Gather CPU info",
  });
  registry.register({
    parentToolUseId: "call_01_gpu",
    role: "explore",
    prompt: "Gather GPU info",
  });

  expect(
    registry.takeForSubagentStart({
      role: "explore",
      parentToolUseIds: ["bce7a88e-sdk-internal-uuid"],
    }),
  ).toBeUndefined();
  registry.noteSubagentAwaitingStream("agent_cpu", "explore");
  expect(registry.resolveFromStreamParentToolUseId("call_00_cpu")).toMatchObject({
    agentId: "agent_cpu",
    launch: { parentToolUseId: "call_00_cpu" },
  });
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

test("SubagentLaunchRegistry takeForSubagentStart resolves via parent_tool_use_id when callback mismatches", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_a",
    role: "explore",
    prompt: "Task A",
  });
  registry.register({
    parentToolUseId: "toolu_b",
    role: "explore",
    prompt: "Task B",
  });

  expect(
    registry.takeForSubagentStart({
      role: "explore",
      parentToolUseIds: ["sdk-mismatched-id", "toolu_a"],
    }),
  ).toMatchObject({
    parentToolUseId: "toolu_a",
    prompt: "Task A",
  });
  expect(
    registry.takeForSubagentStart({
      role: "explore",
      parentToolUseIds: ["sdk-mismatched-id-2", "toolu_b"],
    }),
  ).toMatchObject({
    parentToolUseId: "toolu_b",
    prompt: "Task B",
  });
});

test("SubagentLaunchRegistry takeForSubagentStart resolves via unique prompt when ids mismatch", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_a",
    role: "explore",
    prompt: "Gather CPU info",
  });
  registry.register({
    parentToolUseId: "toolu_b",
    role: "explore",
    prompt: "Gather GPU info",
  });

  expect(
    registry.takeForSubagentStart({
      role: "explore",
      parentToolUseIds: ["sdk-mismatched-1"],
      prompt: "Gather GPU info",
    }),
  ).toMatchObject({
    parentToolUseId: "toolu_b",
    prompt: "Gather GPU info",
  });
});

test("SubagentLaunchRegistry takeForSubagentStart refuses ambiguous same-role prompt matches", () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_a",
    role: "explore",
    prompt: "Same task",
  });
  registry.register({
    parentToolUseId: "toolu_b",
    role: "explore",
    prompt: "Same task",
  });

  expect(
    registry.takeForSubagentStart({
      role: "explore",
      parentToolUseIds: ["sdk-mismatched"],
      prompt: "Same task",
    }),
  ).toBeUndefined();
  expect(registry.peek("toolu_a")).toBeDefined();
  expect(registry.peek("toolu_b")).toBeDefined();
});

test("SubagentLaunchRegistry resolves SubagentStart through linked SDK task id", () => {
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

  expect(registry.linkTask("agent_b", "toolu_b")).toMatchObject({
    parentToolUseId: "toolu_b",
  });

  expect(
    registry.takeForSubagentStart({
      role: "coder",
      agentId: "agent_b",
    }),
  ).toMatchObject({
    parentToolUseId: "toolu_b",
    prompt: "Task B",
  });
  expect(registry.peek("toolu_b")).toBeUndefined();
  expect(registry.peek("toolu_a")).toBeDefined();
});
