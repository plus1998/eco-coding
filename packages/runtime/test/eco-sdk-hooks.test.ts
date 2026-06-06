import { expect, test } from "bun:test";
import {
  buildEcoSdkHooks,
  createAskUserQuestionPreToolHook,
  createDisabledSubagentPreToolHook,
  createNonEcoSubagentDenyPreToolHook,
  createNormalizeSubagentPreToolHook,
  createPreCompactHook,
  createReviewerScopePreToolHook,
  createSubagentStartHook,
  createSubagentStopHook,
  createSubagentToolAttributionPreToolHook,
  createTaskToolPreToolHook,
  createWorkflowDenyPreToolHook,
} from "../src/eco-sdk-hooks";
import type {
  PreCompactHookInput,
  PreToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { ecoSubagentKeyForRole } from "../src/subagent-availability";

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

test("createNormalizeSubagentPreToolHook rewrites legacy Agent input to eco key", async () => {
  const hook = createNormalizeSubagentPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "Scan repo" },
      tool_use_id: "tool_norm",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_norm",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: { subagent_type: ecoSubagentKeyForRole("explore"), prompt: "Scan repo" },
  });
});

test("createReviewerScopePreToolHook injects changed files and preserves eco reviewer key", async () => {
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
  expect(updatedInput.subagent_type).toBe(ecoSubagentKeyForRole("reviewer"));
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

test("createSubagentToolAttributionPreToolHook forwards tool use id with role", async () => {
  const calls: Array<{ toolUseId: string; role?: string }> = [];
  const hook = createSubagentToolAttributionPreToolHook({
    onTaskToolUse(toolUseId, input) {
      calls.push({ toolUseId, ...(input?.role && { role: input.role }) });
    },
  });

  await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "coder", prompt: "Implement." },
      tool_use_id: "tool_agent",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_agent",
    { signal: new AbortController().signal },
  );

  expect(calls).toEqual([{ toolUseId: "tool_agent", role: "coder" }]);
});

test("createNonEcoSubagentDenyPreToolHook denies Agent(general-purpose)", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "general-purpose", prompt: "Research codebase" },
      tool_use_id: "tool_gp",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_gp",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("general-purpose");
});

test("createNonEcoSubagentDenyPreToolHook allows eco_* subagent keys", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: ecoSubagentKeyForRole("coder"), prompt: "Implement." },
      tool_use_id: "tool_c",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_c",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toBeUndefined();
});

test("createDisabledSubagentPreToolHook denies Agent(Explore) when explore is disabled", async () => {
  const hook = createDisabledSubagentPreToolHook({
    explore: false,
    architect: true,
    coder: true,
    reviewer: true,
    tester: true,
  });

  const result = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "Scan repo" },
      tool_use_id: "tool_e",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_e",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
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

test("subagent lifecycle hooks normalize eco agent keys back to roles", async () => {
  const starts: Array<{ agentId: string; agentType: string }> = [];
  const stops: Array<{ agentId: string; agentType: string }> = [];
  const startHook = createSubagentStartHook({
    taskTracker: {
      onPreToolUse() {},
      onTaskCreated() {},
      onTaskCompleted() {},
      onSubagentStart(input) {
        starts.push(input);
      },
      onSubagentStop() {},
      onStop() {},
    },
  });
  const stopHook = createSubagentStopHook({
    taskTracker: {
      onPreToolUse() {},
      onTaskCreated() {},
      onTaskCompleted() {},
      onSubagentStart() {},
      onSubagentStop(input) {
        stops.push(input);
      },
      onStop() {},
    },
  });

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_coder",
      agent_type: ecoSubagentKeyForRole("coder"),
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    undefined,
    { signal: new AbortController().signal },
  );
  await stopHook(
    {
      hook_event_name: "SubagentStop",
      agent_id: "agent_coder",
      agent_type: ecoSubagentKeyForRole("coder"),
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStopHookInput,
    undefined,
    { signal: new AbortController().signal },
  );

  expect(starts).toEqual([{ agentId: "agent_coder", agentType: "coder" }]);
  expect(stops).toEqual([{ agentId: "agent_coder", agentType: "coder" }]);
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
    onPreCompact: async () => {},
  });

  expect(hooks.PreToolUse?.length).toBeGreaterThanOrEqual(3);

  const withResume = buildEcoSdkHooks({
    subagentSessions: {
      phase: "execution",
      threadId: "thr_resume",
      onStart() {},
      onStop() {},
      resolveResume: () => "agent-resume-1",
    },
    onNotification() {},
    onPreCompact: async () => {},
  });
  expect(withResume.PreToolUse?.length).toBeGreaterThanOrEqual(2);
  expect(hooks.TaskCreated).toHaveLength(1);
  expect(hooks.TaskCompleted).toHaveLength(1);
  expect(hooks.SubagentStart).toHaveLength(1);
  expect(hooks.SubagentStop).toHaveLength(1);
  expect(hooks.Stop).toHaveLength(1);
  expect(hooks.Notification).toHaveLength(1);
  expect(hooks.PreCompact).toHaveLength(1);
});

test("createPreCompactHook delegates trigger and session id", async () => {
  const calls: Array<{ trigger: string; sessionId?: string }> = [];
  const hook = createPreCompactHook(async (input) => {
    calls.push(input);
  });
  expect(hook).toBeDefined();

  await hook!(
    {
      hook_event_name: "PreCompact",
      trigger: "auto",
      custom_instructions: null,
      session_id: "sess_compact",
      cwd: "/tmp",
      transcript_path: "/tmp/transcript.jsonl",
    } satisfies PreCompactHookInput,
    undefined,
    { signal: new AbortController().signal },
  );

  expect(calls).toEqual([{ trigger: "auto", sessionId: "sess_compact" }]);
});

test("createWorkflowDenyPreToolHook denies Workflow tool", async () => {
  const hook = createWorkflowDenyPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Workflow",
      tool_input: {},
      tool_use_id: "tool_wf",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_wf",
    { signal: new AbortController().signal },
  );
  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
});
