import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  PreCompactHookInput,
  PreToolUseHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
  TaskCreatedHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import {
  buildEcoSdkHooks,
  captureDeferredExitPlanModeFromResult,
  createAskUserQuestionPreToolHook,
  createDisabledSubagentPreToolHook,
  createExitPlanModeAwaitApprovalHook,
  createExitPlanModePermissionRequestHook,
  createExitPlanModePreToolHook,
  createExitPlanModeResumeApproveHook,
  createNonEcoSubagentDenyPreToolHook,
  createNormalizeSubagentPreToolHook,
  createPreCompactHook,
  createReviewerScopePreToolHook,
  createSubagentLaunchPreToolHook,
  createSubagentStartHook,
  createSubagentStopHook,
  createSubagentToolAttributionPreToolHook,
  createTaskCreatedHook,
  resolveSubagentStartParentToolUseId,
  SubagentLaunchRegistry,
  createTaskToolPreToolHook,
  createToolPermissionPreToolHook,
  createWorkflowDenyPreToolHook,
  parseDeferredExitPlanModeResult,
  parseExitPlanModeInput,
  parseExitPlanModeOutput,
} from "../src/eco-sdk-hooks";
import { ecoSubagentKeyForRole, SDK_GENERAL_PURPOSE_AGENT_KEY, SDK_PLAN_AGENT_KEY } from "../src/subagent-availability";

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

test("parseExitPlanModeInput reads injected plan payload", () => {
  const parsed = parseExitPlanModeInput({
    plan: "  ## Plan\n\nShip it.  ",
    planFilePath: "/tmp/plan.md",
    allowedPrompts: ["yes"],
  });

  expect(parsed).toMatchObject({
    plan: "## Plan\n\nShip it.",
    planFilePath: "/tmp/plan.md",
    allowedPrompts: ["yes"],
  });
});

test("parseExitPlanModeInput reads the planContent field used by OpenAI-protocol models", () => {
  expect(parseExitPlanModeInput({ planContent: "## Plan\n\nShip it." }).plan).toBe("## Plan\n\nShip it.");
  expect(parseExitPlanModeInput({ plan_content: "## Plan\n\nShip it." }).plan).toBe("## Plan\n\nShip it.");
});

test("createExitPlanModePreToolHook passes through when PreToolUse injection is missing", async () => {
  const hook = createExitPlanModePreToolHook(() => {
    throw new Error("delegate should not run without plan content");
  });
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected ExitPlanMode hook");
  }

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: {},
      tool_use_id: "tool_exit_pending",
      session_id: "s1",
      cwd: "/tmp/workspace",
    } satisfies PreToolUseHookInput,
    "tool_exit_pending",
    { signal: new AbortController().signal },
  );

  expect(result).toEqual({});
});

test("createExitPlanModePreToolHook ignores stale latest Claude plan file and captures current transcript", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "eco-plan-stale-"));
  try {
    await fs.mkdir(path.join(workspace, ".claude", "plans"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".claude", "plans", "old.md"),
      "## 实现计划\n\n旧计划不应被复用。",
      "utf8",
    );

    const captured: Array<{ plan: string; toolUseId: string }> = [];
    const hook = createExitPlanModePreToolHook(
      (request) => {
        captured.push({ plan: request.plan, toolUseId: request.toolUseId });
      },
      { capturedToolUseIds: new Set<string>() },
      {
        workspacePath: workspace,
        getPhaseTranscript: () => "## 分析结果\n\n本轮需求。\n\n## 实现计划\n\n本轮新计划。",
      },
    );
    if (!hook) {
      throw new Error("Expected ExitPlanMode hook");
    }

    const result = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "ExitPlanMode",
        tool_input: {},
        tool_use_id: "tool_exit_current_transcript",
        session_id: "s1",
        cwd: workspace,
      } satisfies PreToolUseHookInput,
      "tool_exit_current_transcript",
      { signal: new AbortController().signal },
    );

    expect(captured).toEqual([
      {
        plan: "## 实现计划\n\n本轮新计划。",
        toolUseId: "tool_exit_current_transcript",
      },
    ]);
    expect(result.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "defer",
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("createExitPlanModePreToolHook does not submit old Claude plan file without current plan evidence", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "eco-plan-old-only-"));
  try {
    await fs.mkdir(path.join(workspace, ".claude", "plans"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".claude", "plans", "old.md"),
      "## 实现计划\n\n旧计划不应被提交。",
      "utf8",
    );

    const hook = createExitPlanModePreToolHook(
      () => {
        throw new Error("delegate should not run for a stale plan file");
      },
      { capturedToolUseIds: new Set<string>() },
      { workspacePath: workspace },
    );
    if (!hook) {
      throw new Error("Expected ExitPlanMode hook");
    }

    const result = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "ExitPlanMode",
        tool_input: {},
        tool_use_id: "tool_exit_no_current_plan",
        session_id: "s1",
        cwd: workspace,
      } satisfies PreToolUseHookInput,
      "tool_exit_no_current_plan",
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({});
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("createExitPlanModePreToolHook defers after capturing injected plan", async () => {
  const hook = createExitPlanModePreToolHook((request) => {
    expect(request.plan).toContain("Implement plan mode.");
  });
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected ExitPlanMode hook");
  }

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: { allowedPrompts: [{ tool: "Bash", prompt: "run tests" }] },
      tool_use_id: "tool_exit",
      session_id: "s1",
      cwd: "/tmp",
      plan: "## Summary\n\nImplement plan mode.",
      planFilePath: "/tmp/.claude/plans/plan.md",
    } as PreToolUseHookInput & { plan: string; planFilePath: string },
    "tool_exit",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "defer",
  });
});

test("createExitPlanModeAwaitApprovalHook allows after integrator approval", async () => {
  const captured: Array<{ plan: string; toolUseId: string }> = [];
  const hook = createExitPlanModeAwaitApprovalHook(
    async () => "approved",
    (request) => {
      captured.push({ plan: request.plan, toolUseId: request.toolUseId });
    },
  );
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected ExitPlanMode await approval hook");
  }

  const result = await hook(
    {
      hook_event_name: "PermissionRequest",
      tool_name: "ExitPlanMode",
      tool_input: {
        plan: "## Summary\n\nShip from permission request.",
      },
      tool_use_id: "tool_exit_perm",
      session_id: "sess_perm",
      cwd: "/tmp/workspace",
    },
    undefined,
    { signal: new AbortController().signal },
  );

  expect(captured[0]?.plan).toContain("Ship from permission request");
  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PermissionRequest",
    decision: { behavior: "allow" },
  });
});

test("createExitPlanModeAwaitApprovalHook denies when integrator rejects", async () => {
  const hook = createExitPlanModeAwaitApprovalHook(async () => "denied");
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected ExitPlanMode await approval hook");
  }

  const result = await hook(
    {
      hook_event_name: "PermissionRequest",
      tool_name: "ExitPlanMode",
      tool_input: { plan: "## Summary\n\nReject me." },
      tool_use_id: "tool_exit_deny",
      session_id: "sess_deny",
      cwd: "/tmp/workspace",
    },
    undefined,
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PermissionRequest",
    decision: { behavior: "deny", interrupt: false },
  });
});

test("createExitPlanModePermissionRequestHook denies SDK approval and captures plan", async () => {
  const captured: Array<{ plan: string; planFilePath?: string }> = [];
  const hook = createExitPlanModePermissionRequestHook((request) => {
    captured.push({
      plan: request.plan,
      ...(request.planFilePath ? { planFilePath: request.planFilePath } : {}),
    });
  });
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected ExitPlanMode permission hook");
  }

  const result = await hook(
    {
      hook_event_name: "PermissionRequest",
      tool_name: "ExitPlanMode",
      tool_input: {
        plan: "## Summary\n\nShip from permission request.",
        filePath: "/tmp/workspace/.claude/plans/plan.md",
      },
      session_id: "sess_perm",
      cwd: "/tmp/workspace",
      transcript_path: "/tmp/transcript.jsonl",
    },
    undefined,
    { signal: new AbortController().signal },
  );

  expect(captured[0]?.plan).toContain("Ship from permission request");
  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PermissionRequest",
    decision: { behavior: "deny", interrupt: true },
  });
  expect(result.continue).toBeUndefined();
});

test("parseExitPlanModeOutput reads SDK tool response", () => {
  expect(
    parseExitPlanModeOutput({
      plan: "  ## Plan\n\nDo it.  ",
      filePath: "/repo/.claude/plans/a.md",
    }),
  ).toEqual({
    plan: "## Plan\n\nDo it.",
    planFilePath: "/repo/.claude/plans/a.md",
  });
});

test("createExitPlanModePreToolHook captures injected plan and defers SDK completion", async () => {
  const captured: Array<{ plan: string; planFilePath?: string; toolUseId: string }> = [];
  const hook = createExitPlanModePreToolHook((request) => {
    captured.push({
      plan: request.plan,
      ...(request.planFilePath ? { planFilePath: request.planFilePath } : {}),
      toolUseId: request.toolUseId,
    });
  });
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected ExitPlanMode hook");
  }

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: {
        allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
      },
      tool_use_id: "tool_exit",
      session_id: "s1",
      cwd: "/tmp",
      plan: "## Summary\n\nImplement plan mode.",
      planFilePath: "/tmp/.claude/plans/plan.md",
    } as PreToolUseHookInput & { plan: string; planFilePath: string },
    "tool_exit",
    { signal: new AbortController().signal },
  );

  expect(captured).toEqual([
    {
      plan: "## Summary\n\nImplement plan mode.",
      planFilePath: "/tmp/.claude/plans/plan.md",
      toolUseId: "tool_exit",
    },
  ]);
  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "defer",
  });
});

test("createExitPlanModeResumeApproveHook allows deferred ExitPlanMode with echoed input", async () => {
  const hook = createExitPlanModeResumeApproveHook();

  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "ExitPlanMode",
      tool_input: { allowedPrompts: [{ tool: "Bash", prompt: "run tests" }] },
      tool_use_id: "tool_exit_resume",
      session_id: "s1",
      cwd: "/tmp/workspace",
      plan: "## Summary\n\nApproved plan.",
      planFilePath: "/tmp/workspace/.claude/plans/plan.md",
    } as PreToolUseHookInput & { plan: string; planFilePath: string },
    "tool_exit_resume",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: {
      allowedPrompts: [{ tool: "Bash", prompt: "run tests" }],
      plan: "## Summary\n\nApproved plan.",
      planFilePath: "/tmp/workspace/.claude/plans/plan.md",
    },
  });
});

test("createExitPlanModeResumeApproveHook ignores other tools", async () => {
  const hook = createExitPlanModeResumeApproveHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_use_id: "tool_bash",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_bash",
    { signal: new AbortController().signal },
  );
  expect(result).toEqual({});
});

test("parseDeferredExitPlanModeResult reads deferred_tool_use from result message", () => {
  const parsed = parseDeferredExitPlanModeResult({
    type: "result",
    subtype: "success",
    stop_reason: "tool_deferred",
    deferred_tool_use: {
      id: "tool_exit_deferred",
      name: "ExitPlanMode",
      input: {
        plan: "## Summary\n\nDeferred plan.",
        planFilePath: "/tmp/workspace/.claude/plans/plan.md",
      },
    },
  });

  expect(parsed).toMatchObject({
    toolUseId: "tool_exit_deferred",
    request: {
      plan: "## Summary\n\nDeferred plan.",
      planFilePath: "/tmp/workspace/.claude/plans/plan.md",
    },
  });

  expect(parseDeferredExitPlanModeResult({ type: "assistant" })).toBeUndefined();
  expect(
    parseDeferredExitPlanModeResult({
      type: "result",
      deferred_tool_use: { id: "x", name: "AskUserQuestion", input: {} },
    }),
  ).toBeUndefined();
});

test("captureDeferredExitPlanModeFromResult delegates plan from result payload", async () => {
  const captured: Array<{ plan: string; planFilePath?: string; toolUseId: string }> = [];
  const message = {
    type: "result",
    subtype: "success",
    stop_reason: "tool_deferred",
    deferred_tool_use: {
      id: "tool_exit_deferred",
      name: "ExitPlanMode",
      input: {
        plan: "## Summary\n\nDeferred plan.",
        planFilePath: "/tmp/workspace/.claude/plans/plan.md",
      },
    },
  };

  const handled = await captureDeferredExitPlanModeFromResult(
    message,
    (request) => {
      captured.push({
        plan: request.plan,
        ...(request.planFilePath ? { planFilePath: request.planFilePath } : {}),
        toolUseId: request.toolUseId,
      });
    },
    { capturedToolUseIds: new Set<string>() },
  );

  expect(handled).toBe(true);
  expect(captured).toEqual([
    {
      plan: "## Summary\n\nDeferred plan.",
      planFilePath: "/tmp/workspace/.claude/plans/plan.md",
      toolUseId: "tool_exit_deferred",
    },
  ]);
});

test("captureDeferredExitPlanModeFromResult dedupes against hook capture by tool use id", async () => {
  const state = { capturedToolUseIds: new Set<string>(["tool_exit_deferred"]) };
  const handled = await captureDeferredExitPlanModeFromResult(
    {
      type: "result",
      deferred_tool_use: {
        id: "tool_exit_deferred",
        name: "ExitPlanMode",
        input: { plan: "## Summary\n\nDeferred plan." },
      },
    },
    () => {
      throw new Error("delegate should not run for an already captured tool use");
    },
    state,
  );

  expect(handled).toBe(false);
});

test("createNormalizeSubagentPreToolHook rewrites runtime Agent input to eco key", async () => {
  const hook = createNormalizeSubagentPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "reviewer", prompt: "Review" },
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
    updatedInput: { subagent_type: ecoSubagentKeyForRole("reviewer"), prompt: "Review" },
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
  if (!hook) {
    throw new Error("Expected subagent attribution hook to be created.");
  }

  await hook(
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
  if (!hook) {
    throw new Error("Expected subagent attribution hook to be created.");
  }

  await hook(
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

test("createSubagentToolAttributionPreToolHook forwards general-purpose role", async () => {
  const calls: Array<{ toolUseId: string; role?: string }> = [];
  const hook = createSubagentToolAttributionPreToolHook({
    onTaskToolUse(toolUseId, input) {
      calls.push({ toolUseId, ...(input?.role && { role: input.role }) });
    },
  });
  if (!hook) {
    throw new Error("Expected subagent attribution hook to be created.");
  }

  await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "general-purpose", prompt: "Research and modify." },
      tool_use_id: "tool_general",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_general",
    { signal: new AbortController().signal },
  );

  expect(calls).toEqual([{ toolUseId: "tool_general", role: "general-purpose" }]);
});

test("createSubagentToolAttributionPreToolHook forwards Plan role", async () => {
  const calls: Array<{ toolUseId: string; role?: string }> = [];
  const hook = createSubagentToolAttributionPreToolHook({
    onTaskToolUse(toolUseId, input) {
      calls.push({ toolUseId, ...(input?.role && { role: input.role }) });
    },
  });
  if (!hook) {
    throw new Error("Expected subagent attribution hook to be created.");
  }

  await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Plan", prompt: "Research plan context." },
      tool_use_id: "tool_plan",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_plan",
    { signal: new AbortController().signal },
  );

  expect(calls).toEqual([{ toolUseId: "tool_plan", role: "Plan" }]);
});

test("createNonEcoSubagentDenyPreToolHook allows Agent(general-purpose)", async () => {
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

  expect(result.hookSpecificOutput).toBeUndefined();
});

test("createNonEcoSubagentDenyPreToolHook denies SDK built-ins other than general-purpose", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Plan", prompt: "Plan the work" },
      tool_use_id: "tool_plan",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_plan",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("Plan");
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
    "Use agents registered for this session",
  );
});

test("createNonEcoSubagentDenyPreToolHook denies SDK Explore with session agent guidance", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook();
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Explore", prompt: "Scan repo" },
      tool_use_id: "tool_explore",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_explore",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain("Explore");
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
    "Use agents registered for this session",
  );
});

test("createNonEcoSubagentDenyPreToolHook allows Agent(Plan) when plan mode opens it", async () => {
  const hook = createNonEcoSubagentDenyPreToolHook([], ["Plan"]);
  const result = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "Plan", prompt: "Plan the work" },
      tool_use_id: "tool_plan",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_plan",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toBeUndefined();
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
  expect(result.hookSpecificOutput?.permissionDecisionReason).toContain(
    "Use agents registered for this session",
  );
});

test("createToolPermissionPreToolHook enforces main and subagent tool policies", async () => {
  const hook = createToolPermissionPreToolHook({
    main: {
      allowed: ["Agent", "Read", "mcp__docs__*"],
      disallowed: ["Bash"],
      mcpServers: ["docs"],
    },
    agents: {
      eco_researcher: {
        allowed: ["WebSearch"],
        disallowed: ["Bash", "Read"],
        mcpServers: [],
        network: { webSearch: true, webFetch: true },
      },
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
  expect(subagentRead.hookSpecificOutput?.permissionDecisionReason).toContain("disallowed");

  const monitorTool = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Monitor",
      tool_input: {},
      tool_use_id: "tool_monitor",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_monitor",
    { signal: new AbortController().signal },
  );
  expect(monitorTool.hookSpecificOutput).toBeUndefined();

  const unconfiguredMcp = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "mcp__slack__post",
      tool_input: {},
      tool_use_id: "tool_slack",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_slack",
    { signal: new AbortController().signal },
  );
  expect(unconfiguredMcp.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(unconfiguredMcp.hookSpecificOutput?.permissionDecisionReason).toContain("not assigned");

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

test("createToolPermissionPreToolHook applies main policy to SDK general-purpose subagent", async () => {
  const hook = createToolPermissionPreToolHook({
    main: {
      allowed: ["Agent", "Read"],
      disallowed: ["Bash"],
      mcpServers: [],
    },
    agents: {
      eco_researcher: {
        allowed: ["WebSearch"],
        disallowed: ["Bash", "Read"],
        mcpServers: [],
        network: { webSearch: true, webFetch: true },
      },
    },
  });
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected tool permission hook");
  }

  const generalPurposeRead = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: {},
      tool_use_id: "tool_gp_read",
      session_id: "s1",
      cwd: "/tmp",
      agent_id: "agent_gp",
      agent_type: SDK_GENERAL_PURPOSE_AGENT_KEY,
    } satisfies PreToolUseHookInput,
    "tool_gp_read",
    { signal: new AbortController().signal },
  );
  expect(generalPurposeRead.hookSpecificOutput).toBeUndefined();

  const generalPurposeBash = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "echo hi" },
      tool_use_id: "tool_gp_bash",
      session_id: "s1",
      cwd: "/tmp",
      agent_id: "agent_gp",
      agent_type: SDK_GENERAL_PURPOSE_AGENT_KEY,
    } satisfies PreToolUseHookInput,
    "tool_gp_bash",
    { signal: new AbortController().signal },
  );
  expect(generalPurposeBash.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(generalPurposeBash.hookSpecificOutput?.permissionDecisionReason).toContain(
    SDK_GENERAL_PURPOSE_AGENT_KEY,
  );
  expect(generalPurposeBash.hookSpecificOutput?.permissionDecisionReason).not.toContain(
    "No Eco tool policy is registered",
  );
});

test("createToolPermissionPreToolHook enforces read-only policy for SDK Plan subagent", async () => {
  const hook = createToolPermissionPreToolHook({
    main: {
      allowed: ["Agent", "Read", "Write", "Bash"],
      disallowed: [],
      mcpServers: [],
      bash: { enabled: true },
      filesystem: { read: "workspace", write: "workspace" },
    },
    agents: {},
  });
  expect(hook).toBeDefined();
  if (!hook) {
    throw new Error("Expected tool permission hook");
  }

  const planWrite = await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "plan.md", content: "draft" },
      tool_use_id: "tool_plan_write",
      session_id: "s1",
      cwd: "/tmp",
      agent_id: "agent_plan",
      agent_type: SDK_PLAN_AGENT_KEY,
    } satisfies PreToolUseHookInput,
    "tool_plan_write",
    { signal: new AbortController().signal },
  );
  expect(planWrite.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
  });
  expect(planWrite.hookSpecificOutput?.permissionDecisionReason).toContain(SDK_PLAN_AGENT_KEY);
});

test("createToolPermissionPreToolHook adds delegation guidance only to main agent policy denials", async () => {
  const hook = createToolPermissionPreToolHook({
    main: {
      allowed: ["Agent", "Read", "Edit", "Bash"],
      disallowed: [],
      mcpServers: [],
      bash: { enabled: false },
      filesystem: { read: "workspace", write: "none" },
    },
    agents: {
      eco_coder: {
        allowed: ["Read", "Edit"],
        disallowed: [],
        mcpServers: [],
        filesystem: { read: "workspace", write: "none" },
      },
    },
  });
  expect(hook).toBeDefined();

  const mainEdit = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/repo/file.ts" },
      tool_use_id: "tool_main_edit",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_main_edit",
    { signal: new AbortController().signal },
  );
  expect(mainEdit.hookSpecificOutput?.permissionDecisionReason).toContain(
    'Tool "Edit" is disallowed for main.',
  );
  expect(mainEdit.hookSpecificOutput?.permissionDecisionReason).toContain(
    "Delegate the work to an enabled subagent via the Agent tool",
  );

  const mainBash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "bun test" },
      tool_use_id: "tool_main_bash",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_main_bash",
    { signal: new AbortController().signal },
  );
  expect(mainBash.hookSpecificOutput?.permissionDecisionReason).toContain(
    'Tool "Bash" is disallowed for main.',
  );
  expect(mainBash.hookSpecificOutput?.permissionDecisionReason).toContain(
    "Delegate the work to an enabled subagent via the Agent tool",
  );

  const subagentEdit = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/repo/file.ts" },
      tool_use_id: "tool_sub_edit",
      session_id: "s1",
      cwd: "/repo",
      agent_id: "agent_1",
      agent_type: "eco_coder",
    } satisfies PreToolUseHookInput,
    "tool_sub_edit",
    { signal: new AbortController().signal },
  );
  expect(subagentEdit.hookSpecificOutput?.permissionDecisionReason).toContain(
    'Tool "Edit" is disallowed for eco_coder.',
  );
  expect(subagentEdit.hookSpecificOutput?.permissionDecisionReason).not.toContain(
    "Delegate the work",
  );
});

test("createToolPermissionPreToolHook denies only explicitly disallowed tools in plan phase", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Read", "Glob", "Grep"],
        disallowed: ["Write", "Edit", "Bash"],
        bash: { enabled: false },
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    { workspacePath: "/repo" },
  );
  expect(hook).toBeDefined();

  const bash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "grep -R foo src" },
      tool_use_id: "tool_plan_bash",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_plan_bash",
    { signal: new AbortController().signal },
  );
  expect(bash.hookSpecificOutput?.permissionDecision).toBe("deny");
  expect(bash.hookSpecificOutput?.permissionDecisionReason).toContain('Tool "Bash" is disallowed for main.');

  const grep = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "foo", path: "/repo/src" },
      tool_use_id: "tool_plan_grep",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_plan_grep",
    { signal: new AbortController().signal },
  );
  expect(grep.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook allows reads under explicitly allowed skill roots", async () => {
  const skillRoot = `${os.homedir()}/.claude/skills/my-skill`;
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Read"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    {
      workspacePath: "/repo/apps/desktop",
      implicitReadAllowRoots: [skillRoot],
    },
  );
  expect(hook).toBeDefined();

  const skillRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: `${skillRoot}/references/guide.md` },
      tool_use_id: "tool_skill_read",
      session_id: "s1",
      cwd: "/repo/apps/desktop",
    } satisfies PreToolUseHookInput,
    "tool_skill_read",
    { signal: new AbortController().signal },
  );
  expect(skillRead.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook allows tilde paths under explicitly allowed skill roots", async () => {
  const skillRoot = `${os.homedir()}/.claude/skills/my-skill`;
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Read"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    {
      workspacePath: "/repo/apps/desktop",
      implicitReadAllowRoots: [skillRoot],
    },
  );
  expect(hook).toBeDefined();

  const skillRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "~/.claude/skills/my-skill/references/guide.md" },
      tool_use_id: "tool_skill_read_tilde",
      session_id: "s1",
      cwd: "/repo/apps/desktop",
    } satisfies PreToolUseHookInput,
    "tool_skill_read_tilde",
    { signal: new AbortController().signal },
  );
  expect(skillRead.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook asks before reading user skills that were not explicitly allowed", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Read"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    {
      workspacePath: "/repo/apps/desktop",
    },
  );
  expect(hook).toBeDefined();

  const skillRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "~/.claude/skills/my-skill/references/guide.md" },
      tool_use_id: "tool_skill_read_requires_approval",
      session_id: "s1",
      cwd: "/repo/apps/desktop",
    } satisfies PreToolUseHookInput,
    "tool_skill_read_requires_approval",
    { signal: new AbortController().signal },
  );
  expect(skillRead.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
  });
});

test("createToolPermissionPreToolHook asks for Glob patterns outside the workspace", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Glob"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    {
      workspacePath: "/repo/apps/desktop",
    },
  );
  expect(hook).toBeDefined();

  const glob = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "/tmp/external/**/*.ts" },
      tool_use_id: "tool_glob_external",
      session_id: "s1",
      cwd: "/repo/apps/desktop",
    } satisfies PreToolUseHookInput,
    "tool_glob_external",
    { signal: new AbortController().signal },
  );
  expect(glob.hookSpecificOutput).toMatchObject({
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
  });
});

test("createToolPermissionPreToolHook allows Glob from explore cwd when workspace is a subdirectory", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Read", "Glob", "Grep"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    { workspacePath: "/repo/apps/desktop" },
  );
  expect(hook).toBeDefined();

  const exploreGlob = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "**/*.ts", path: "/repo" },
      tool_use_id: "tool_explore_glob",
      session_id: "s1",
      cwd: "/repo",
      agent_type: "eco_explore",
    } satisfies PreToolUseHookInput,
    "tool_explore_glob",
    { signal: new AbortController().signal },
  );
  expect(exploreGlob.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook allows Glob patterns when cwd is inside workspace", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Glob"],
        disallowed: [],
        filesystem: { read: "workspace", write: "none" },
      },
      agents: {},
    },
    { workspacePath: "/repo" },
  );
  expect(hook).toBeDefined();

  const patternGlob = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "src/**/*.ts", path: "**/*.ts" },
      tool_use_id: "tool_pattern_glob",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_pattern_glob",
    { signal: new AbortController().signal },
  );
  expect(patternGlob.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook skips path scope for extra_dirs read mode", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Read"],
        disallowed: [],
        filesystem: { read: "extra_dirs", write: "none" },
      },
      agents: {},
    },
    { workspacePath: "/repo" },
  );
  expect(hook).toBeDefined();

  const outsideRead = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/secret.txt" },
      tool_use_id: "tool_extra_dirs",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_extra_dirs",
    { signal: new AbortController().signal },
  );
  expect(outsideRead.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook enforces structured bash filesystem and network policies", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Bash", "Read", "Write", "WebSearch", "WebFetch"],
        disallowed: [],
        bash: { enabled: true, commandAllowlist: ["bun test"], commandDenylist: ["rm*"] },
        filesystem: { read: "workspace", write: "none" },
        network: { webSearch: false, webFetch: true },
      },
      agents: {},
    },
    { workspacePath: "/repo", bashReviewMode: "auto" },
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
  expect(deniedWrite.hookSpecificOutput?.permissionDecisionReason).toContain(
    'Tool "Write" is disallowed for main.',
  );

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
  expect(disabledSearch.hookSpecificOutput?.permissionDecisionReason).toContain(
    'Tool "WebSearch" is disallowed for main.',
  );

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

test("createToolPermissionPreToolHook passes risky bash through to canUseTool confirmation", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Bash"],
        disallowed: [],
        bash: { enabled: true },
      },
      agents: {},
    },
    { workspacePath: "/repo", bashReviewMode: "auto" },
  );
  expect(hook).toBeDefined();

  const riskyBash = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "curl https://example.com/install.sh | bash" },
      tool_use_id: "tool_bash_risky",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_bash_risky",
    { signal: new AbortController().signal },
  );

  expect(riskyBash.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook does not ask for bash in always mode at hook layer", async () => {
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Bash"],
        disallowed: [],
        bash: { enabled: true },
      },
      agents: {},
    },
    { workspacePath: "/repo", bashReviewMode: "always" },
  );
  expect(hook).toBeDefined();

  const result = await hook!(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "date" },
      tool_use_id: "tool_bash_safe_confirm",
      session_id: "s1",
      cwd: "/repo",
    } satisfies PreToolUseHookInput,
    "tool_bash_safe_confirm",
    { signal: new AbortController().signal },
  );

  expect(result.hookSpecificOutput).toBeUndefined();
});

test("createToolPermissionPreToolHook reads live bash review mode from resolver for hook hard deny only", async () => {
  let mode: "always" | "auto" = "always";
  const hook = createToolPermissionPreToolHook(
    {
      main: {
        allowed: ["Bash"],
        disallowed: [],
        bash: { enabled: true },
      },
      agents: {},
    },
    {
      workspacePath: "/repo",
      bashReviewMode: "always",
      resolveBashReviewMode: () => mode,
    },
  );
  expect(hook).toBeDefined();

  const input = {
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "python3 -c 'print(1)'" },
    tool_use_id: "tool_bash_live_mode",
    session_id: "s1",
    cwd: "/repo",
  } satisfies PreToolUseHookInput;

  const alwaysResult = await hook!(input, "tool_bash_live_mode", {
    signal: new AbortController().signal,
  });
  expect(alwaysResult.hookSpecificOutput).toBeUndefined();

  mode = "auto";
  const autoResult = await hook!(input, "tool_bash_live_mode", {
    signal: new AbortController().signal,
  });
  expect(autoResult.hookSpecificOutput).toBeUndefined();
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
      reason:
        'Tool "Bash" is disallowed for main. This is the active Eco profile policy for the main orchestrator, not a transient error. Delegate the work to an enabled subagent via the Agent tool instead of retrying.',
      actor: "main",
    },
  ]);
});

test("createDisabledSubagentPreToolHook ignores SDK built-in Explore", async () => {
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

  expect(result.hookSpecificOutput).toBeUndefined();
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

test("resolveSubagentStartParentToolUseId prefers hook callback toolUseID", () => {
  expect(
    resolveSubagentStartParentToolUseId(
      {
        hook_event_name: "SubagentStart",
        agent_id: "agent_coder_b",
        agent_type: "coder",
        session_id: "s1",
        cwd: "/tmp",
      } satisfies SubagentStartHookInput,
      "toolu_task_b",
    ),
  ).toBe("toolu_task_b");
});

test("createSubagentStartHook forwards parentToolUseId and launch metadata out of order", async () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_task_a",
    role: "coder",
    prompt: "Implement A",
    todoIdHint: "todo-a",
  });
  registry.register({
    parentToolUseId: "toolu_task_b",
    role: "coder",
    prompt: "Implement B",
    todoIdHint: "todo-b",
  });

  const starts: Array<Record<string, unknown>> = [];
  const startHook = createSubagentStartHook({
    subagentLaunchRegistry: registry,
    subagentSessions: {
      phase: "execution",
      threadId: "thr_parallel",
      onStart(input) {
        starts.push(input);
      },
      onStop() {},
      resolveResume: () => undefined,
    },
  });

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_coder_b",
      agent_type: "coder",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    "toolu_task_b",
    { signal: new AbortController().signal },
  );
  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_coder_a",
      agent_type: "coder",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    "toolu_task_a",
    { signal: new AbortController().signal },
  );

  expect(starts).toEqual([
    {
      agentId: "agent_coder_b",
      agentType: "coder",
      parentToolUseId: "toolu_task_b",
      prompt: "Implement B",
      todoId: "todo-b",
    },
    {
      agentId: "agent_coder_a",
      agentType: "coder",
      parentToolUseId: "toolu_task_a",
      prompt: "Implement A",
      todoId: "todo-a",
    },
  ]);
});

test("TaskCreated hook links SDK task id so SubagentStart can resolve without callback toolUseID", async () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_task_a",
    role: "coder",
    prompt: "Implement A",
    todoIdHint: "todo-a",
  });
  registry.register({
    parentToolUseId: "toolu_task_b",
    role: "coder",
    prompt: "Implement B",
    todoIdHint: "todo-b",
  });

  const createdTasks: Array<{ taskId: string; subject: string }> = [];
  const taskCreatedHook = createTaskCreatedHook(
    {
      onPreToolUse() {},
      onTaskCreated(input) {
        createdTasks.push({ taskId: input.taskId, subject: input.subject });
      },
      onTaskCompleted() {},
      onSubagentStart() {},
      onSubagentStop() {},
      onStop() {},
    },
    registry,
  );
  const starts: Array<Record<string, unknown>> = [];
  const startHook = createSubagentStartHook({
    subagentLaunchRegistry: registry,
    subagentSessions: {
      phase: "execution",
      threadId: "thr_parallel",
      onStart(input) {
        starts.push(input);
      },
      onStop() {},
      resolveResume: () => undefined,
    },
  });

  await taskCreatedHook(
    {
      hook_event_name: "TaskCreated",
      task_id: "agent_coder_b",
      task_subject: "Implement B",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies TaskCreatedHookInput,
    "toolu_task_b",
    { signal: new AbortController().signal },
  );
  await taskCreatedHook(
    {
      hook_event_name: "TaskCreated",
      task_id: "agent_coder_a",
      task_subject: "Implement A",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies TaskCreatedHookInput,
    "toolu_task_a",
    { signal: new AbortController().signal },
  );

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_coder_b",
      agent_type: "coder",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    undefined,
    { signal: new AbortController().signal },
  );
  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_coder_a",
      agent_type: "coder",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    undefined,
    { signal: new AbortController().signal },
  );

  expect(createdTasks).toEqual([
    { taskId: "agent_coder_b", subject: "Implement B" },
    { taskId: "agent_coder_a", subject: "Implement A" },
  ]);
  expect(starts).toEqual([
    {
      agentId: "agent_coder_b",
      agentType: "coder",
      parentToolUseId: "toolu_task_b",
      prompt: "Implement B",
      todoId: "todo-b",
    },
    {
      agentId: "agent_coder_a",
      agentType: "coder",
      parentToolUseId: "toolu_task_a",
      prompt: "Implement A",
      todoId: "todo-a",
    },
  ]);
});

test("createSubagentLaunchPreToolHook registers launch and forwards attribution", async () => {
  const registry = new SubagentLaunchRegistry();
  const taskTools: Array<{ toolUseId: string; role?: string }> = [];
  const hook = createSubagentLaunchPreToolHook({
    registry,
    attribution: {
      onTaskToolUse(toolUseId, input) {
        taskTools.push({ toolUseId, ...(input?.role && { role: input.role }) });
      },
    },
  });

  await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "coder", prompt: "Implement API", eco_todo_id: "todo-1" },
      tool_use_id: "toolu_delegate",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "toolu_delegate",
    { signal: new AbortController().signal },
  );

  expect(taskTools).toEqual([{ toolUseId: "toolu_delegate", role: "coder" }]);
  expect(registry.peek("toolu_delegate")).toMatchObject({
    parentToolUseId: "toolu_delegate",
    role: "coder",
    prompt: "Implement API",
    todoIdHint: "todo-1",
  });
});

test("createSubagentLaunchPreToolHook forwards SDK built-in general-purpose role", async () => {
  const registry = new SubagentLaunchRegistry();
  const taskTools: Array<{ toolUseId: string; role?: string }> = [];
  const hook = createSubagentLaunchPreToolHook({
    registry,
    attribution: {
      onTaskToolUse(toolUseId, input) {
        taskTools.push({ toolUseId, ...(input?.role && { role: input.role }) });
      },
    },
  });

  await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: SDK_GENERAL_PURPOSE_AGENT_KEY, prompt: "Research and modify." },
      tool_use_id: "tool_general",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_general",
    { signal: new AbortController().signal },
  );

  expect(taskTools).toEqual([{ toolUseId: "tool_general", role: SDK_GENERAL_PURPOSE_AGENT_KEY }]);
  expect(registry.peek("tool_general")).toMatchObject({
    parentToolUseId: "tool_general",
    role: SDK_GENERAL_PURPOSE_AGENT_KEY,
    prompt: "Research and modify.",
  });
});

test("createSubagentLaunchPreToolHook forwards SDK built-in Plan role", async () => {
  const registry = new SubagentLaunchRegistry();
  const taskTools: Array<{ toolUseId: string; role?: string }> = [];
  const hook = createSubagentLaunchPreToolHook({
    registry,
    attribution: {
      onTaskToolUse(toolUseId, input) {
        taskTools.push({ toolUseId, ...(input?.role && { role: input.role }) });
      },
    },
  });

  await hook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: SDK_PLAN_AGENT_KEY, prompt: "Research plan context." },
      tool_use_id: "tool_plan",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies PreToolUseHookInput,
    "tool_plan",
    { signal: new AbortController().signal },
  );

  expect(taskTools).toEqual([{ toolUseId: "tool_plan", role: SDK_PLAN_AGENT_KEY }]);
  expect(registry.peek("tool_plan")).toMatchObject({
    parentToolUseId: "tool_plan",
    role: SDK_PLAN_AGENT_KEY,
    prompt: "Research plan context.",
  });
});

test("buildEcoSdkHooks launch hook attributes SDK built-in Agent delegations", async () => {
  const taskTools: Array<{ toolUseId: string; role?: string }> = [];
  const hooks = buildEcoSdkHooks({
    subagentSessions: {
      phase: "execution",
      threadId: "thr_builtin",
      onStart() {},
      onStop() {},
      resolveResume: () => undefined,
    },
    subagentAttribution: {
      onTaskToolUse(toolUseId, input) {
        taskTools.push({ toolUseId, ...(input?.role && { role: input.role }) });
      },
    },
    onNotification() {},
    onPreCompact: async () => {},
  });
  const agentPreToolHooks =
    hooks.PreToolUse?.filter((matcher) => !matcher.matcher || /Agent|Task/.test(matcher.matcher))
      .flatMap((matcher) => matcher.hooks) ?? [];
  for (const hook of agentPreToolHooks) {
    await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Agent",
        tool_input: { subagent_type: SDK_GENERAL_PURPOSE_AGENT_KEY, prompt: "Complex task." },
        tool_use_id: "tool_builtin",
        session_id: "s1",
        cwd: "/tmp",
      } satisfies PreToolUseHookInput,
      "tool_builtin",
      { signal: new AbortController().signal },
    );
  }

  expect(taskTools).toEqual([{ toolUseId: "tool_builtin", role: SDK_GENERAL_PURPOSE_AGENT_KEY }]);
});

test("createSubagentStartHook defers launch until stream parent_tool_use_id when hook ids mismatch", async () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_coder",
    role: "coder",
    prompt: "Implement export filters",
    todoIdHint: "todo-1",
  });

  const starts: Array<Record<string, unknown>> = [];
  const delegations: Array<Record<string, unknown>> = [];
  const startHook = createSubagentStartHook({
    subagentLaunchRegistry: registry,
    subagentSessions: {
      phase: "execution",
      threadId: "thr_single_launch",
      onStart(input) {
        starts.push(input);
      },
      onDelegationLinked(input) {
        delegations.push(input);
      },
      onStop() {},
      resolveResume: () => undefined,
    },
  });

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_coder_a",
      agent_type: "coder",
      session_id: "s1",
      cwd: "/tmp",
    } satisfies SubagentStartHookInput,
    undefined,
    { signal: new AbortController().signal },
  );

  expect(starts).toEqual([
    {
      agentId: "agent_coder_a",
      agentType: "coder",
    },
  ]);
  expect(delegations).toEqual([]);
  expect(registry.peek("toolu_coder")).toBeDefined();

  const linked = registry.resolveFromStreamParentToolUseId("toolu_coder");
  expect(linked).toMatchObject({
    agentId: "agent_coder_a",
    launch: { parentToolUseId: "toolu_coder", prompt: "Implement export filters" },
  });
});

test("createSubagentStartHook resolves launch via parent_tool_use_id when callback mismatches", async () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_agent_a",
    role: "explore",
    prompt: "Gather CPU info",
  });
  registry.register({
    parentToolUseId: "toolu_agent_b",
    role: "explore",
    prompt: "Gather GPU info",
  });

  const starts: Array<Record<string, unknown>> = [];
  const startHook = createSubagentStartHook({
    subagentLaunchRegistry: registry,
    subagentSessions: {
      phase: "execution",
      threadId: "thr_mismatch",
      onStart(input) {
        starts.push(input);
      },
      onStop() {},
      resolveResume: () => undefined,
    },
  });

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_explore_a",
      agent_type: "explore",
      session_id: "s1",
      cwd: "/tmp",
      parent_tool_use_id: "toolu_agent_a",
    } as SubagentStartHookInput & { parent_tool_use_id: string },
    "976064d8-4f4c-4746-a2d7-e78e49d7a2bd",
    { signal: new AbortController().signal },
  );
  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_explore_b",
      agent_type: "explore",
      session_id: "s1",
      cwd: "/tmp",
      parent_tool_use_id: "toolu_agent_b",
    } as SubagentStartHookInput & { parent_tool_use_id: string },
    "13ae346a-8e35-4790-97aa-b0f0376c8821",
    { signal: new AbortController().signal },
  );

  expect(starts).toEqual([
    {
      agentId: "agent_explore_a",
      agentType: "explore",
      parentToolUseId: "toolu_agent_a",
      prompt: "Gather CPU info",
    },
    {
      agentId: "agent_explore_b",
      agentType: "explore",
      parentToolUseId: "toolu_agent_b",
      prompt: "Gather GPU info",
    },
  ]);
});

test("createSubagentStartHook resolves launch via unique prompt when ids mismatch", async () => {
  const registry = new SubagentLaunchRegistry();
  registry.register({
    parentToolUseId: "toolu_agent_a",
    role: "explore",
    prompt: "Gather CPU info",
  });
  registry.register({
    parentToolUseId: "toolu_agent_b",
    role: "explore",
    prompt: "Gather GPU info",
  });

  const starts: Array<Record<string, unknown>> = [];
  const startHook = createSubagentStartHook({
    subagentLaunchRegistry: registry,
    subagentSessions: {
      phase: "execution",
      threadId: "thr_prompt_match",
      onStart(input) {
        starts.push(input);
      },
      onStop() {},
      resolveResume: () => undefined,
    },
  });

  await startHook(
    {
      hook_event_name: "SubagentStart",
      agent_id: "agent_explore_b",
      agent_type: "explore",
      session_id: "s1",
      cwd: "/tmp",
      prompt: "Gather GPU info",
    } as SubagentStartHookInput & { prompt: string },
    "sdk-mismatched-callback",
    { signal: new AbortController().signal },
  );

  expect(starts).toEqual([
    {
      agentId: "agent_explore_b",
      agentType: "explore",
      parentToolUseId: "toolu_agent_b",
      prompt: "Gather GPU info",
    },
  ]);
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

test("buildEcoSdkHooks registers ExitPlanMode resume approve hook only without planning capture", async () => {
  const exitPlanInput = {
    hook_event_name: "PreToolUse",
    tool_name: "ExitPlanMode",
    tool_input: { allowedPrompts: [] },
    tool_use_id: "tool_exit",
    session_id: "s1",
    cwd: "/tmp/workspace",
    plan: "## Summary\n\nApproved plan.",
  } as PreToolUseHookInput & { plan: string };

  const executionHooks = buildEcoSdkHooks({ approveDeferredExitPlanMode: true });
  const exitPlanMatchers = executionHooks.PreToolUse?.filter(
    (matcher) => matcher.matcher === "ExitPlanMode",
  );
  expect(exitPlanMatchers).toHaveLength(1);
  const approveResult = await exitPlanMatchers![0]!.hooks[0]!(exitPlanInput, "tool_exit", {
    signal: new AbortController().signal,
  });
  expect(approveResult.hookSpecificOutput).toMatchObject({
    permissionDecision: "allow",
    updatedInput: { plan: "## Summary\n\nApproved plan." },
  });

  const planningHooks = buildEcoSdkHooks({
    onExitPlanMode: () => {},
    awaitPlanApproval: async () => "approved",
  });
  const planningPermissionMatchers = planningHooks.PermissionRequest?.filter(
    (matcher) => matcher.matcher === "ExitPlanMode",
  );
  expect(planningPermissionMatchers).toHaveLength(1);
  expect(planningHooks.PreToolUse?.filter((matcher) => matcher.matcher === "ExitPlanMode") ?? []).toHaveLength(
    0,
  );
  const allowResult = await planningPermissionMatchers![0]!.hooks[0]!(
    {
      hook_event_name: "PermissionRequest",
      tool_name: "ExitPlanMode",
      tool_input: { plan: "## Summary\n\nApproved plan." },
      tool_use_id: "tool_exit",
      session_id: "s1",
      cwd: "/tmp/workspace",
    },
    undefined,
    { signal: new AbortController().signal },
  );
  expect(allowResult.hookSpecificOutput).toMatchObject({
    hookEventName: "PermissionRequest",
    decision: { behavior: "allow" },
  });
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
