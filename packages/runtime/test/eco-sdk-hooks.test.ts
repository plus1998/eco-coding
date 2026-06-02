import { expect, test } from "bun:test";
import {
  buildEcoSdkHooks,
  createAskUserQuestionPreToolHook,
  createFinalizePlanPreToolHook,
  createDisabledSubagentPreToolHook,
  createReviewerScopePreToolHook,
  createTaskToolPreToolHook,
} from "../src/eco-sdk-hooks";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

test("createAskUserQuestionPreToolHook returns updated input", async () => {
  const hook = createAskUserQuestionPreToolHook(async () => ({
    questions: [{ question: "Q", answer: "REST" }],
  }));
  expect(hook).toBeDefined();

  const result = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: { questions: [{ question: "Q", options: [{ label: "REST" }] }] },
      tool_use_id: "tool_1",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_1",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: { questions: [{ question: "Q", answer: "REST" }] },
  });
});

test("createFinalizePlanPreToolHook returns updated input", async () => {
  const hook = createFinalizePlanPreToolHook(async () => ({
    analysis: "normalized analysis",
    plan: "normalized plan",
  }));
  expect(hook).toBeDefined();

  const result = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "FinalizePlan",
      tool_input: { analysis: "  a  ", plan: "  p " },
      tool_use_id: "tool_fp_1",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_fp_1",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: { analysis: "normalized analysis", plan: "normalized plan" },
  });
});

test("createReviewerScopePreToolHook injects changed files for Agent(reviewer)", async () => {
  const hook = createReviewerScopePreToolHook(async () => ["src/api.ts"]);
  expect(hook).toBeDefined();

  const result = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "Review the plan." },
      tool_use_id: "tool_2",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_2",
    { signal: new AbortController().signal },
  );

  const updatedInput = result.hookSpecificOutput?.updatedInput as Record<string, unknown>;
  expect(typeof updatedInput.prompt).toBe("string");
  expect(updatedInput.prompt).toContain("src/api.ts");
  expect(updatedInput.prompt).toContain("Review the plan.");
});

test("createTaskToolPreToolHook forwards tool input to tracker", async () => {
  const calls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
  const hook = createTaskToolPreToolHook({
    onPreToolUse(toolName, input) {
      calls.push({ toolName, input });
    },
    onTaskCreated() {},
    onTaskCompleted() {},
    onSubagentStart() {},
    onSubagentStop() {},
    onStop() {},
  });

  await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "TaskCreate",
      tool_input: { subject: "Run tests" },
      tool_use_id: "tool_3",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_3",
    { signal: new AbortController().signal },
  );

  expect(calls).toEqual([{ toolName: "TaskCreate", input: { subject: "Run tests" } }]);
});

test("createDisabledSubagentPreToolHook denies Agent for disabled roles", async () => {
  const hook = createDisabledSubagentPreToolHook({
    explore: true,
    architect: true,
    coder: true,
    reviewer: false,
    tester: true,
  });
  expect(hook).toBeDefined();

  const result = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "Review." },
      tool_use_id: "tool_r",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_r",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
});

test("buildEcoSdkHooks registers expected hook events", () => {
  const hooks = buildEcoSdkHooks({
    askUserQuestion: async () => ({}),
    resolveChangedFiles: async () => [],
    taskTracker: {
      onPreToolUse() {},
      onTaskCreated() {},
      onTaskCompleted() {},
      onSubagentStart() {},
      onSubagentStop() {},
      onStop() {},
    },
    onNotification() {},
  });

  expect(hooks.PreToolUse?.length).toBeGreaterThanOrEqual(3);
  expect(hooks.TaskCreated).toHaveLength(1);
  expect(hooks.TaskCompleted).toHaveLength(1);
  expect(hooks.SubagentStart).toHaveLength(1);
  expect(hooks.SubagentStop).toHaveLength(1);
  expect(hooks.Stop).toHaveLength(1);
  expect(hooks.Notification).toHaveLength(1);
});
