import { expect, test } from "bun:test";
import type { ResolvedModelRoute } from "../../model-router/src";
import {
  applyResumeToQueryOptions,
  applySessionStoreToQueryOptions,
  appendToPhaseTranscript,
  buildExecutePhasePrompt,
  buildExecuteResumePrompt,
  buildPlanningPhasePrompt,
  buildQuestionAnswerPrompt,
  ClaudeAgentSdkDriver,
  createAgentDefinitions,
  createCanUseTool,
  createExecutionAgentDefinitions,
  createPlanningAgentDefinitions,
  createQuestionAgentDefinitions,
  buildExecutePhaseSystemAppend,
  createPhaseBoundaryEvent,
  createPlanReadyEvent,
  createSessionCapturedEvent,
  executePhaseSystemAppend,
  extractSdkRunFailure,
  formatAgentEventDisplay,
  formatAgentEventLine,
  formatSdkPayloadMessage,
  getDefaultAllowedTools,
  inferActivityRole,
  isSdkInitMessage,
  isCompactBoundarySdkMessage,
  mapSdkMessageToEvents,
  buildSdkProcessEnv,
  mergeAllowedTools,
  planningPhaseSystemAppend,
  questionAnswerSystemAppend,
  readSdkSessionId,
  resolveAgentSkills,
  resolveSdkSessionOptions,
  toSdkAgentModel,
} from "../src/claude-agent-sdk";
import { parseSubagentMissionMessage } from "../src/agent-mission";

const routes: ResolvedModelRoute[] = [
  {
    role: "planner",
    primary: {
      id: "opus",
      provider: "anthropic",
      displayName: "Opus",
      baseUrl: "https://gateway.test",
      modelId: "claude-opus-4",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  },
  {
    role: "explore",
    primary: {
      id: "haiku",
      provider: "anthropic",
      displayName: "Haiku",
      baseUrl: "https://gateway.test",
      modelId: "claude-haiku-explore",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  },
  {
    role: "coder",
    primary: {
      id: "qwen",
      provider: "custom",
      displayName: "Qwen Coder",
      baseUrl: "https://gateway.test",
      modelId: "qwen-coder-anthropic",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  },
  {
    role: "architect",
    primary: {
      id: "architect-sonnet",
      provider: "anthropic",
      displayName: "Architect Sonnet",
      baseUrl: "https://gateway.test",
      modelId: "claude-sonnet-architect",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  },
  {
    role: "reviewer",
    primary: {
      id: "reviewer-sonnet",
      provider: "anthropic",
      displayName: "Reviewer Sonnet",
      baseUrl: "https://gateway.test",
      modelId: "claude-sonnet-reviewer",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  },
  {
    role: "tester",
    primary: {
      id: "tester-haiku",
      provider: "anthropic",
      displayName: "Tester Haiku",
      baseUrl: "https://gateway.test",
      modelId: "claude-haiku-tester",
      capabilities: ["messages_api"],
      enabled: true,
    },
    fallbacks: [],
  },
];

test("buildSdkProcessEnv forces local router env over inherited Anthropic auth", () => {
  const previous = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
    PATH: process.env.PATH,
  };
  process.env.ANTHROPIC_API_KEY = "real-key";
  process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
  process.env.ANTHROPIC_AUTH_TOKEN = "oauth-token";

  try {
    const env = buildSdkProcessEnv({
      apiKey: "eco-local-model-router",
      baseUrl: "http://127.0.0.1:36037/",
    });
    expect(env.ANTHROPIC_API_KEY).toBe("eco-local-model-router");
    expect(env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:36037");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.PATH).toBe(previous.PATH);
  } finally {
    if (previous.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous.ANTHROPIC_API_KEY;
    if (previous.ANTHROPIC_BASE_URL === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous.ANTHROPIC_BASE_URL;
    if (previous.ANTHROPIC_AUTH_TOKEN === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = previous.ANTHROPIC_AUTH_TOKEN;
  }
});

test("maps Claude family model ids to SDK subagent aliases", () => {
  expect(toSdkAgentModel("claude-opus-4")).toBe("claude-opus-4");
  expect(toSdkAgentModel("claude-sonnet")).toBe("claude-sonnet");
  expect(toSdkAgentModel("claude-haiku")).toBe("claude-haiku");
  expect(toSdkAgentModel("qwen-coder-anthropic")).toBe("qwen-coder-anthropic");
  expect(() => toSdkAgentModel(undefined, "coder")).toThrow(
    "Missing model id for coder subagent. Subagents must use explicit models.",
  );
});

test("includes Agent in default allowed tools", () => {
  expect(getDefaultAllowedTools()).toContain("Agent");
});

test("merges MCP tool allowlist and defaults filesystem session options", () => {
  expect(mergeAllowedTools(["Read", "Grep"], { mcpAllowedTools: ["mcp__github__*"] })).toEqual([
    "Read",
    "Grep",
    "mcp__github__*",
  ]);
  expect(resolveSdkSessionOptions()).toEqual({
    settingSources: ["user", "project"],
    skills: undefined,
    mcpServers: {},
  });
  expect(
    resolveSdkSessionOptions({
      agentSkills: { planner: ["pdf"], coder: ["docx", "lint"] },
    }),
  ).toEqual({
    settingSources: ["user", "project"],
    skills: ["pdf"],
    mcpServers: {},
  });
});

test("creates native SDK subagent definitions", () => {
  const agentSkills = { coder: ["docx"], architect: ["pdf"] };
  const definitions = createAgentDefinitions(routes, agentSkills);
  expect(definitions).toHaveProperty("coder");
  expect(definitions.coder).toMatchObject({
    description: expect.stringContaining("## Coder Tasks"),
    skills: ["docx"],
    model: "qwen-coder-anthropic",
  });
  expect(definitions.architect).toMatchObject({ skills: ["pdf"] });
  expect(definitions.reviewer).not.toHaveProperty("skills");
  expect(resolveAgentSkills("tester", agentSkills)).toEqual([]);
});

test("execution architect prompt requires Coder Tasks section", () => {
  const definitions = createExecutionAgentDefinitions(routes);
  expect(definitions.architect).toMatchObject({
    prompt: expect.stringContaining("## Coder Tasks"),
  });
  expect(definitions.coder).toMatchObject({
    prompt: expect.stringMatching(/runnable, verified code/),
  });
  expect(definitions.tester).toMatchObject({
    prompt: expect.stringContaining("## Test Verdict"),
  });
});

test("reviewer prompt limits scope to current worktree diff", () => {
  const definitions = createExecutionAgentDefinitions(routes);
  expect(definitions.reviewer).toMatchObject({
    description: expect.stringContaining("worktree"),
    prompt: expect.stringMatching(/git diff --name-only HEAD/),
  });
  expect(executePhaseSystemAppend).toContain("Eco prepends");
  expect(executePhaseSystemAppend).toContain("changed file list");
  expect(executePhaseSystemAppend).toMatch(/runnable, verified code/);
});

test("builds phased orchestration prompts", () => {
  const userPrompt = "Add rich text editor styles";
  const analysis = "## 分析结果\n\nNeed to extend styles.css";
  const plan = "## 实现计划\n\n1. Read styles.css\n2. Add editor block";

  expect(buildPlanningPhasePrompt(userPrompt)).toContain("turn 1");
  expect(buildPlanningPhasePrompt(userPrompt)).toContain("AskUserQuestion");
  expect(buildPlanningPhasePrompt(userPrompt)).toContain("mcp__eco_plan__finalize_plan");
  expect(planningPhaseSystemAppend).toContain("explore first, ask second");
  expect(planningPhaseSystemAppend).toContain("Finalization rule");
  expect(buildPlanningPhasePrompt(userPrompt)).toContain("Do NOT call `mcp__eco_plan__finalize_plan`");
  expect(executePhaseSystemAppend).toContain("TaskCreate");
  expect(executePhaseSystemAppend).toContain("TaskUpdate");
  expect(executePhaseSystemAppend).toContain("Exactly ONE step must be in_progress");
  expect(executePhaseSystemAppend).toContain("Architect (conditional)");
  expect(executePhaseSystemAppend).toContain("Coders (parallel)");
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan)).toContain(plan);
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan)).toContain("system-reminder");
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan)).toContain("Pipeline —");
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan, { planUserEdited: true })).toContain(
    "edited this plan in Eco",
  );
});

test("planning agents include read-only explore subagent", () => {
  const definitions = createPlanningAgentDefinitions(routes);
  expect(definitions.explore).toMatchObject({
    description: expect.stringContaining("read-only"),
    prompt: expect.stringContaining("read-only"),
    tools: expect.arrayContaining(["Grep"]),
    model: "claude-haiku-explore",
  });
});

test("question explore subagent uses explore route model", () => {
  const definitions = createQuestionAgentDefinitions(routes);
  expect(definitions.explore).toMatchObject({ model: "claude-haiku-explore" });
});

test("createExecutionAgentDefinitions omits disabled roles but keeps coder", () => {
  const availability = {
    explore: true,
    architect: true,
    coder: true,
    reviewer: false,
    tester: false,
  };
  const definitions = createExecutionAgentDefinitions(routes, undefined, availability);
  expect(definitions).toHaveProperty("coder");
  expect(definitions).not.toHaveProperty("reviewer");
  expect(definitions).not.toHaveProperty("tester");
});

test("buildExecutePhaseSystemAppend skips reviewer and tester when disabled", () => {
  const append = buildExecutePhaseSystemAppend({
    explore: true,
    architect: true,
    coder: true,
    reviewer: false,
    tester: false,
  });
  expect(append).not.toContain("Agent(reviewer)");
  expect(append).not.toContain("Agent(tester)");
  expect(append).toContain("Reviewer subagent is disabled");
  expect(append).toContain("Tester subagent is disabled");
  expect(append).toContain("Coders (parallel)");
});

test("inferActivityRole maps Agent(explore) to explore", () => {
  expect(
    inferActivityRole({
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Agent",
        input: { subagent_type: "explore", prompt: "Find auth middleware" },
      },
    }),
  ).toBe("explore");
});

test("builds read-only question answering prompts", () => {
  expect(questionAnswerSystemAppend).toContain("ANSWER");
  expect(questionAnswerSystemAppend).toContain("read-only");
  expect(questionAnswerSystemAppend).toContain("Agent(explore)");
  expect(questionAnswerSystemAppend).toContain("Do not create an implementation plan");
  expect(buildQuestionAnswerPrompt("How does routing work?")).toContain("User question:");
  expect(buildQuestionAnswerPrompt("How does routing work?")).toContain("Agent(explore)");
});

test("formats eco phase boundary events", () => {
  const event = createPhaseBoundaryEvent("thr_1", "plan", "【1/2】分析与制定计划");
  expect(formatSdkPayloadMessage(event.payload)).toBe("【1/2】分析与制定计划");
});

test("uses the last SDK result to decide execution success", () => {
  const errorPayload = {
    subtype: "error",
    totalCostUsd: 0.1,
    usage: { input_tokens: 1 },
    result: "subagent failed",
  };
  const successPayload = {
    subtype: "success",
    totalCostUsd: 0.2,
    usage: { input_tokens: 2 },
  };

  expect(extractSdkRunFailure(errorPayload)).toBe("subagent failed");
  expect(extractSdkRunFailure(successPayload)).toBeNull();

  let executionFailure: string | undefined = extractSdkRunFailure(errorPayload) ?? undefined;
  executionFailure = extractSdkRunFailure(successPayload) ?? undefined;
  expect(executionFailure).toBeUndefined();
});

test("extracts SDK error results for execution rollback", () => {
  expect(
    extractSdkRunFailure({
      type: "result",
      subtype: "error",
      result: "Claude Code returned an error result: model not found",
    }),
  ).toBe("Claude Code returned an error result: model not found");
  expect(extractSdkRunFailure({ type: "result", subtype: "success", result: "ok" })).toBeNull();
  expect(
    extractSdkRunFailure({
      subtype: "error",
      totalCostUsd: 0.1,
      result: "model not found",
    }),
  ).toBe("model not found");
});

test("creates plan.ready event with transcript payload", () => {
  const event = createPlanReadyEvent("thr_1", {
    userPrompt: "Add styles",
    analysis: "Need CSS",
    plan: "1. Edit styles.css",
  });
  expect(event.type).toBe("plan.ready");
  expect(formatAgentEventLine(event)).toBe("计划已生成，等待确认。");
});

test("appends stream deltas into phase transcript", () => {
  let transcript = "";
  transcript = appendToPhaseTranscript(
    transcript,
    {
      id: "1",
      threadId: "thr_1",
      agentId: "a",
      role: "planner",
      type: "message.delta",
      timestamp: "",
      payload: {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } },
      },
    },
  );
  transcript = appendToPhaseTranscript(
    transcript,
    {
      id: "2",
      threadId: "thr_1",
      agentId: "a",
      role: "planner",
      type: "message.delta",
      timestamp: "",
      payload: {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      },
    },
  );
  expect(transcript).toBe("hello");
});

test("formats assistant, thinking, and stream payloads for UI output", () => {
  expect(
    formatSdkPayloadMessage({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello from the agent." }],
      },
    }),
  ).toBe("Hello from the agent.");

  expect(
    formatSdkPayloadMessage({
      type: "assistant",
      message: {
        content: [{ type: "thinking", thinking: "Let me inspect the repo layout first." }],
      },
    }),
  ).toBe("Let me inspect the repo layout first.");

  expect(
    formatSdkPayloadMessage({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial" },
      },
    }),
  ).toBe("partial");

  expect(
    formatSdkPayloadMessage({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "Planning the patch…" },
      },
    }),
  ).toBe("Planning the patch…");

  const toolDisplay = formatAgentEventDisplay({
    type: "tool.started",
    role: "coder",
    payload: {
      type: "tool_use",
      tool_name: "Read",
      input: { file_path: "/tmp/project/src/styles.css" },
    },
  });
  expect(toolDisplay).toEqual({
    message: "Tool: Read · styles.css",
    role: "coder",
    stream: false,
  });

  const askDisplay = formatAgentEventDisplay({
    type: "tool.started",
    role: "planner",
    payload: {
      type: "tool_use",
      tool_name: "AskUserQuestion",
      input: {
        questions: [{ question: "导出未建联名单要按哪个建联口径筛选？", options: [{ label: "A" }] }],
      },
    },
  });
  expect(askDisplay?.message).toContain("导出未建联");

  const agentDisplay = formatAgentEventDisplay({
    type: "tool.started",
    role: "planner",
    payload: {
      type: "tool_use",
      tool_name: "Agent",
      input: { subagent_type: "coder", prompt: "Add markdown rendering" },
    },
  });
  expect(agentDisplay?.role).toBe("coder");
  const mission = parseSubagentMissionMessage(agentDisplay?.message ?? "");
  expect(mission?.role).toBe("coder");
  expect(mission?.summary).toContain("markdown");

  expect(
    mapSdkMessageToEvents(
      {
        type: "assistant",
        uuid: "sdk_3",
        session_id: "session_1",
        message: {
          content: [
            { type: "text", text: "Already streamed elsewhere." },
            { type: "tool_use", name: "Read", input: { file_path: "/tmp/a.ts" } },
          ],
        },
      },
      "thr_1",
    ),
  ).toHaveLength(1);

  expect(
    inferActivityRole({
      type: "message.delta",
      role: "planner",
      payload: {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "hmm" },
        },
      },
    }),
  ).toBe("thinking");
});

test("ignores SDK messages without displayable text", () => {
  expect(
    mapSdkMessageToEvents(
      {
        type: "system",
        subtype: "thinking_tokens",
        estimated_tokens: 42,
        estimated_tokens_delta: 3,
        uuid: "sdk_2",
        session_id: "session_1",
      },
      "thr_1",
    ),
  ).toEqual([]);
});

test("maps assistant message usage to usage.recorded events", () => {
  const events = mapSdkMessageToEvents(
    {
      type: "assistant",
      uuid: "sdk_u1",
      session_id: "session_1",
      message: {
        id: "msg_abc",
        usage: { input_tokens: 1200, output_tokens: 80 },
        content: [{ type: "text", text: "ok" }],
      },
    },
    "thr_1",
  );

  const usageEvent = events.find((event) => event.type === "usage.recorded");
  expect(usageEvent).toBeDefined();
  expect((usageEvent?.payload as { messageId?: string }).messageId).toBe("msg_abc");
});

test("preserves subagent metadata on tool_use events", () => {
  const events = mapSdkMessageToEvents(
    {
      type: "assistant",
      uuid: "sdk_subagent_1",
      session_id: "session_coder_1",
      parent_tool_use_id: "tool_parent_1",
      subagent_type: "coder",
      message: {
        content: [
          {
            type: "tool_use",
            id: "tool_child_1",
            name: "Read",
            input: { file_path: "/tmp/work.ts" },
          },
        ],
      },
    },
    "thr_1",
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "tool.started",
    agentId: "session_coder_1",
    role: "coder",
    payload: {
      type: "tool_use",
      tool_name: "Read",
      tool_use_id: "tool_child_1",
      parent_tool_use_id: "tool_parent_1",
      subagent_type: "coder",
    },
  });
});

test("maps SDK result messages to usage events", () => {
  const events = mapSdkMessageToEvents(
    {
      type: "result",
      subtype: "success",
      uuid: "sdk_1",
      session_id: "session_1",
      total_cost_usd: 0.12,
      usage: { input_tokens: 10, output_tokens: 20 },
      modelUsage: { "claude-opus-4": { input_tokens: 10 } },
    },
    "thr_1",
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    id: "sdk_1:usage",
    type: "usage.recorded",
    agentId: "session_1",
  });
});

test("formatAgentEventLine omits usage.recorded display text", () => {
  expect(
    formatAgentEventLine({
      type: "usage.recorded",
      payload: { totalCostUsd: 2.1695, usage: { input_tokens: 1, output_tokens: 1 } },
      role: "planner",
    }),
  ).toBeNull();
});

test("formatSdkPayloadMessage omits result cost lines", () => {
  expect(
    formatAgentEventLine({
      type: "tool.completed",
      payload: { type: "result", total_cost_usd: 2.1695, subtype: "success" },
      role: "planner",
    }),
  ).toBeNull();
});

test("adapts SDK permission callbacks to app approval decisions", async () => {
  const canUseTool = createCanUseTool(async (request) => {
    expect(request.toolName).toBe("Bash");
    expect(request.toolUseId).toBe("tool_1");
    return { behavior: "deny", message: "Approval required", interrupt: true };
  });

  const decision = await canUseTool(
    "Bash",
    { command: "rm -rf src" },
    {
      toolUseID: "tool_1",
      signal: new AbortController().signal,
    },
  );

  expect(decision).toEqual({
    behavior: "deny",
    message: "Approval required",
    interrupt: true,
  });
});

test("maps SDK compact_boundary system messages", () => {
  const message = {
    type: "system",
    subtype: "compact_boundary",
    uuid: "sdk_compact_1",
    session_id: "session_1",
    compact_metadata: {
      trigger: "auto",
      pre_tokens: 180_000,
      post_tokens: 42_000,
    },
  };
  expect(isCompactBoundarySdkMessage(message)).toBe(true);

  const events = mapSdkMessageToEvents(message, "thr_1");
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "agent.started",
    payload: {
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "auto",
        pre_tokens: 180_000,
        post_tokens: 42_000,
      },
    },
  });
});

test("maps standalone compact_boundary message type", () => {
  const message = {
    type: "compact_boundary",
    uuid: "sdk_compact_2",
    session_id: "session_1",
    compact_metadata: { trigger: "manual", pre_tokens: 100_000 },
  };
  expect(isCompactBoundarySdkMessage(message)).toBe(true);
  const events = mapSdkMessageToEvents(message, "thr_1");
  expect(events[0]?.payload).toMatchObject({
    subtype: "compact_boundary",
    compact_metadata: { trigger: "manual", pre_tokens: 100_000 },
  });
});

test("maps SDK task_progress system messages to todo.updated events", () => {
  const events = mapSdkMessageToEvents(
    {
      type: "system",
      subtype: "task_progress",
      task_id: "task_abc",
      description: "Inspecting auth module",
      last_tool_name: "Read",
      uuid: "sdk_task_1",
      session_id: "session_1",
    },
    "thr_1",
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "todo.updated",
    payload: {
      sdkKind: "task_progress",
      task_id: "task_abc",
      description: "Inspecting auth module",
    },
  });
});

test("does not map task_started system messages (handled by SDK hooks)", () => {
  const events = mapSdkMessageToEvents(
    {
      type: "system",
      subtype: "task_started",
      task_id: "task_abc",
      description: "Review changes",
      uuid: "sdk_task_1",
      session_id: "session_1",
    },
    "thr_1",
  );

  expect(events).toHaveLength(0);
});

test("formatAgentEventLine renders todo.updated task progress for activity", () => {
  expect(
    formatAgentEventLine({
      type: "todo.updated",
      role: "planner",
      payload: {
        sdkKind: "task_progress",
        task_id: "task_abc",
        description: "Inspecting auth module",
        last_tool_name: "Read",
      },
    }),
  ).toBe("Tool: Read · Inspecting auth module");

  expect(
    inferActivityRole({
      type: "todo.updated",
      role: "planner",
      payload: {
        sdkKind: "task_started",
        task_id: "task_abc",
        description: "Implement feature",
        subagent_type: "coder",
      },
    }),
  ).toBe("coder");
});

test("applyResumeToQueryOptions sets resume and forkSession", () => {
  const options: Record<string, unknown> = {};
  applyResumeToQueryOptions(options, { resumeSessionId: "sess-123", forkSession: true });
  expect(options.resume).toBe("sess-123");
  expect(options.forkSession).toBe(true);
});

test("applySessionStoreToQueryOptions disables file checkpointing", () => {
  const withStore: Record<string, unknown> = { enableFileCheckpointing: true };
  applySessionStoreToQueryOptions(withStore, { append: async () => {}, load: async () => null });
  expect(withStore.sessionStore).toBeDefined();
  expect(withStore.enableFileCheckpointing).toBeUndefined();

  const withoutStore: Record<string, unknown> = {};
  applySessionStoreToQueryOptions(withoutStore);
  expect(withoutStore.enableFileCheckpointing).toBe(true);
});

test("createSessionCapturedEvent and init message helpers", () => {
  const init = {
    type: "system",
    subtype: "init",
    session_id: "sess-abc",
  };
  expect(isSdkInitMessage(init)).toBe(true);
  expect(readSdkSessionId(init)).toBe("sess-abc");

  const event = createSessionCapturedEvent("thr_1", "sess-abc", "/tmp/worktree");
  expect(event.type).toBe("session.captured");
  expect(event.payload).toEqual({ sessionId: "sess-abc", cwd: "/tmp/worktree" });
});

test("buildExecuteResumePrompt inlines approved plan when resuming", () => {
  const prompt = buildExecuteResumePrompt({
    userPrompt: "Add feature X",
    analysis: "Needs tests",
    plan: "Do the thing",
    approvedPlanFile: ".eco/approved-plans/thr_1.md",
  });
  expect(prompt).toContain("phase 2 execution");
  expect(prompt).toContain("Do the thing");
  expect(prompt).toContain("Add feature X");
  expect(prompt).toContain(".eco/approved-plans/thr_1.md");
  expect(prompt).not.toContain("from our conversation above");
  expect(buildExecuteResumePrompt({
    userPrompt: "x",
    analysis: "y",
    plan: "Edited",
    planUserEdited: true,
  })).toContain("user edited this plan");
});

test("ClaudeAgentSdkDriver forwards resume options to SDK query", async () => {
  const capturedOptions: Record<string, unknown>[] = [];
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    loadSdk: async () => ({
      query: ({ options }) => {
        capturedOptions.push(options);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "system",
              subtype: "init",
              session_id: "sess-resume-test",
              uuid: "init-1",
            };
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-resume-test",
              uuid: "result-1",
            };
          },
          close: () => {},
        };
      },
    }),
  });

  const events: string[] = [];
  for await (const event of driver.runQuestion({
    threadId: "thr_resume",
    prompt: "Follow up",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
    signal: new AbortController().signal,
    resume: { resumeSessionId: "sess-resume-test" },
  })) {
    events.push(event.type);
  }

  expect(capturedOptions[0]?.resume).toBe("sess-resume-test");
  expect(events).toContain("session.captured");
});

test("ClaudeAgentSdkDriver forwards excludeDynamicSections to systemPrompt", async () => {
  const capturedOptions: Record<string, unknown>[] = [];
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    excludeDynamicSections: true,
    loadSdk: async () => ({
      query: ({ options }) => {
        capturedOptions.push(options);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-cache-test",
              uuid: "result-1",
            };
          },
          close: () => {},
        };
      },
    }),
  });

  for await (const _event of driver.runQuestion({
    threadId: "thr_cache",
    prompt: "What changed?",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree-a",
    routes,
    signal: new AbortController().signal,
  })) {
    // drain
  }

  expect(capturedOptions[0]?.systemPrompt).toMatchObject({
    type: "preset",
    preset: "claude_code",
    excludeDynamicSections: true,
  });
});

test("ClaudeAgentSdkDriver planning registers finalize_plan MCP tool", async () => {
  const capturedOptions: Record<string, unknown>[] = [];
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    loadSdk: async () => ({
      query: ({ options }) => {
        capturedOptions.push(options);
        return {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "sess-plan",
            uuid: "init-plan",
          };
          yield {
            type: "result",
            subtype: "success",
            session_id: "sess-plan",
            uuid: "result-plan",
          };
          },
          close: () => {},
        };
      },
    }),
  });

  let error: unknown;
  try {
    for await (const event of driver.run({
      threadId: "thr_plan_tool",
      prompt: "Add markdown rendering",
      workspacePath: "/tmp/workspace",
      worktreePath: "/tmp/worktree",
      routes,
      signal: new AbortController().signal,
    })) {
      void event;
    }
  } catch (caught) {
    error = caught;
  }
  expect(capturedOptions[0]?.allowedTools).toContain("mcp__eco_plan__finalize_plan");
  expect(capturedOptions[0]?.mcpServers).toBeDefined();
  expect(
    Object.prototype.hasOwnProperty.call(
      (capturedOptions[0]?.mcpServers ?? {}) as Record<string, unknown>,
      "eco_plan",
    ),
  ).toBe(true);
  expect(String(error)).toContain("未提交 FinalizePlan");
});

test("ClaudeAgentSdkDriver planning fails without FinalizePlan", async () => {
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    loadSdk: async () => ({
      query: () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            type: "system",
            subtype: "init",
            session_id: "sess-plan-missing",
            uuid: "init-plan-missing",
          };
          yield {
            type: "assistant",
            uuid: "assistant-plan-missing",
            session_id: "sess-plan-missing",
            message: {
              content: [{ type: "text", text: "Here is analysis only." }],
            },
          };
          yield {
            type: "result",
            subtype: "success",
            session_id: "sess-plan-missing",
            uuid: "result-plan-missing",
          };
        },
        close: () => {},
      }),
    }),
  });

  let error: unknown;
  try {
    for await (const _event of driver.run({
      threadId: "thr_plan_missing",
      prompt: "Plan this feature",
      workspacePath: "/tmp/workspace",
      worktreePath: "/tmp/worktree",
      routes,
      signal: new AbortController().signal,
    })) {
      // drain
    }
  } catch (caught) {
    error = caught;
  }

  expect(String(error)).toContain("未提交 FinalizePlan");
});
