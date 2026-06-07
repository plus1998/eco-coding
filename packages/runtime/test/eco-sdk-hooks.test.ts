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
  createToolPermissionPreToolHook,
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

test("createSubagentToolAttributionPreToolHook forwards dynamic Eco agent role", async () => {
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
      tool_input: { subagent_type: "eco_researcher", prompt: "Research." },
      tool_use_id: "tool_researcher",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_researcher",
    { signal: new AbortController().signal },
  );

  expect(calls).toEqual([{ toolUseId: "tool_researcher", role: "researcher" }]);
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

test("createNonEcoSubagentDenyPreToolHook allows dynamic Eco agent keys", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook(["eco_researcher"]);
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "eco_researcher", prompt: "Research this market." },
      tool_use_id: "tool_researcher",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_researcher",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toBeUndefined();
});

test("createNonEcoSubagentDenyPreToolHook denies unlisted dynamic Eco agent keys", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook(["eco_researcher"]);
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "eco_writer", prompt: "Write launch copy." },
      tool_use_id: "tool_writer",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_writer",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("eco_writer");
});

test("createToolPermissionPreToolHook enforces main and subagent tool policies", async () => {
  const hook = createToolPermissionPreToolHook({
    main: { allowed: ["Agent", "Read", "mcp__docs__*"], disallowed: ["Bash"] },
    agents: {
      eco_researcher: { allowed: ["WebSearch"], disallowed: ["Bash"] },
    },
  });
  expect(hook).toBeDefined();

  const mainRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: {},
      tool_use_id: "tool_read",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_read",
    { signal: new AbortController().signal },
  );
  expect(mainRead.hookSpecificOutput).toBeUndefined();

  const mainBash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: {},
      tool_use_id: "tool_bash",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_bash",
    { signal: new AbortController().signal },
  );
  expect(mainBash.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(mainBash.hookSpecificOutput?.permissionDecisionReason).toContain("disallowed");

  const mcpTool = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "mcp__docs__search",
      tool_input: {},
      tool_use_id: "tool_mcp",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_mcp",
    { signal: new AbortController().signal },
  );
  expect(mcpTool.hookSpecificOutput).toBeUndefined();

  const subagentRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: {},
      tool_use_id: "tool_sub_read",
      session_id: "s1",
      cwd: "/tmp",
      agent_id: "agent_1",
      agent_type: "eco_researcher",
    } satisfies PreToolUseHookInput,
    "tool_sub_read",
    { signal: new AbortController().signal },
  );
  expect(subagentRead.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(subagentRead.hookSpecificOutput?.permissionDecisionReason).toContain("not allowed");

  const subagentSearch = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "WebSearch",
      tool_input: {},
      tool_use_id: "tool_sub_search",
      session_id: "s1",
      cwd: "/tmp",
      agent_id: "agent_1",
      agent_type: "eco_researcher",
    } satisfies PreToolUseHookInput,
    "tool_sub_search",
    { signal: new AbortController().signal },
  );
  expect(subagentSearch.hookSpecificOutput).toBeUndefined();

  const unprefixedSubagentSearch = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "WebSearch",
      tool_input: {},
      tool_use_id: "tool_sub_search_unprefixed",
      session_id: "s1",
      cwd: "/tmp",
      agent_id: "agent_2",
      agent_type: "researcher",
    } satisfies PreToolUseHookInput,
    "tool_sub_search_unprefixed",
    { signal: new AbortController().signal },
  );
  expect(unprefixedSubagentSearch.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook enforces structured bash filesystem and network policies", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Bash", "Read", "Write", "WebSearch", "WebFetch"],
        disallowed: [],
        bash: { enabled: true, approval: "risky", commandAllowlist: ["bun test"], commandDenylist: ["rm*"] },
        filesystem: { read: "workspace", write: "none" },
        network: { webSearch: false, webFetch: true },
      },
      agents: {},
    },
    { workspacePath: "/repo" },
  );
  expect(hook).toBeDefined();

  const safeBash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "bun test packages/runtime/test/eco-sdk-hooks.test.ts" },
      tool_use_id: "tool_bash_safe",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_bash_safe",
    { signal: new AbortController().signal },
  );
  expect(safeBash.hookSpecificOutput).toBeUndefined();

  const deniedBash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src" },
      tool_use_id: "tool_bash_deny",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_bash_deny",
    { signal: new AbortController().signal },
  );
  expect(deniedBash.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(deniedBash.hookSpecificOutput?.permissionDecisionReason).toContain("denylist");

  const deniedWrite = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "/repo/output.md" },
      tool_use_id: "tool_write",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_write",
    { signal: new AbortController().signal },
  );
  expect(deniedWrite.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(deniedWrite.hookSpecificOutput?.permissionDecisionReason).toContain("writes are disabled");

  const outsideRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/secret.txt" },
      tool_use_id: "tool_read_outside",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_read_outside",
    { signal: new AbortController().signal },
  );
  expect(outsideRead.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(outsideRead.hookSpecificOutput?.permissionDecisionReason).toContain("outside");

  const disabledSearch = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "WebSearch",
      tool_input: {},
      tool_use_id: "tool_web_search",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_web_search",
    { signal: new AbortController().signal },
  );
  expect(disabledSearch.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(disabledSearch.hookSpecificOutput?.permissionDecisionReason).toContain("WebSearch is disabled");

  const allowedFetch = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "WebFetch",
      tool_input: { url: "https://example.com" },
      tool_use_id: "tool_web_fetch",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_web_fetch",
    { signal: new AbortController().signal },
  );
  expect(allowedFetch.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook asks for risky bash commands", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Bash"],
        disallowed: [],
        bash: { enabled: true, approval: "risky" },
      },
      agents: {},
    },
    { workspacePath: "/repo" },
  );
  expect(hook).toBeDefined();

  const riskyBash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm install left-pad" },
      tool_use_id: "tool_bash_risky",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_bash_risky",
    { signal: new AbortController().signal },
  );

  expect(riskyBash.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
  });
  expect(riskyBash.hookSpecificOutput?.permissionDecisionReason).toContain("Dependency changes");
});

test("createToolPermissionPreToolHook reports denied permissions for audit", async () => {
  const decisions: Array<{ toolName: string; toolUseId: string; reason: string; actor: string }> = [];
  const hook = createToolPermissionPreToolHook(
    {
      main: { allowed: ["Read"], disallowed: ["Bash"] },
      agents: {},
    },
    {
      onDecision: (decision) => {
        decisions.push({
          toolName: decision.toolName,
          toolUseId: decision.toolUseId,
          reason: decision.reason,
          actor: decision.actor,
        });
      },
    },
  );
  expect(hook).toBeDefined();

  await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "rm -rf src" },
      tool_use_id: "tool_audit",
      session_id: "session_1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_audit",
    { signal: new AbortController().signal },
  );

  expect(decisions).toEqual([
    {
      toolName: "Bash",
      toolUseId: "tool_audit",
      reason: 'Tool "Bash" is disallowed for main.',
      actor: "main",
    },
  ]);
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

test("subagent lifecycle hooks normalize dynamic Eco agent keys", async () => {
  const starts: Array<{ agentId: string; agentType: string }> = [];
  const stops: Array<{ agentId: string; agentType: string }> = [];
  const startHook = createSubagentStartHook({
    subagentSessions: {
      phase: "execution",
      threadId: "thr_dynamic",
      onStart(input) {
        starts.push(input);
      },
      onStop() {},
      resolveResume: () => undefined,
    },
  });
  const stopHook = createSubagentStopHook({
    subagentSessions: {
      phase: "execution",
      threadId: "thr_dynamic",
      onStart() {},
      onStop(input) {
        stops.push(input);
      },
      resolveResume: () => undefined,
    },
  });

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_researcher",
      agent_type: "eco_researcher",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    undefined,
    { signal: new AbortController().signal },
  );
  await stopHook(
    {
      hook_event_name: "SubagentStop",
      agent_id: "agent_researcher",
      agent_type: "eco_researcher",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStopHookInput,
    undefined,
    { signal: new AbortController().signal },
  );

  expect(starts).toEqual([{ agentId: "agent_researcher", agentType: "researcher" }]);
  expect(stops).toEqual([{ agentId: "agent_researcher", agentType: "researcher" }]);
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
