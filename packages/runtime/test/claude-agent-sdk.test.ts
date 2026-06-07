import { expect, test } from "bun:test";
import type { ResolvedModelRoute } from "../../model-router/src";
import {
  applyResumeToQueryOptions,
  applySessionStoreToQueryOptions,
  readSdkUserMessageCheckpointId,
  appendToPhaseTranscript,
  buildExecutePhasePrompt,
  buildExecuteResumePrompt,
  buildExecutionPromptWithFollowUp,
  buildPlanningPhasePrompt,
  buildQuestionAnswerPrompt,
  ClaudeAgentSdkDriver,
  createAgentDefinitions,
  createCanUseTool,
  createExecutionAgentDefinitions,
  createPlanningAgentDefinitions,
  createQuestionAgentDefinitions,
  deleteClaudeAgentSdkSession,
  buildExecutePhaseSystemAppend,
  createPhaseBoundaryEvent,
  createPlanReadyEvent,
  createSessionCapturedEvent,
  createToolPermissionDeniedEvent,
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
  applyEcoSdkSettings,
  buildSdkProcessEnv,
  createAutonomousAgentDefinitions,
  mergeAllowedTools,
  planningPhaseSystemAppend,
  questionAnswerSystemAppend,
  readSdkSessionId,
  resolveAgentSkills,
  resolveSdkSessionOptions,
  toSdkAgentModel,
} from "../src/claude-agent-sdk";
import { parseSubagentMissionMessage } from "../src/agent-mission";
import type { EcoAgentRuntimeConfig, EcoToolPolicy } from "../src/agent-orchestration";
import { ecoSubagentKeyForRole } from "../src/subagent-availability";

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

async function* emptySdkQuery(): AsyncIterable<unknown> {}

function universalToolPolicy(allowed: string[], disallowed: string[] = []): EcoToolPolicy {
  return { allowed, disallowed };
}

const universalAgentRegistry: EcoAgentRuntimeConfig = {
  templates: [
    {
      id: "user.researcher",
      name: "Researcher",
      description: "Finds credible external evidence.",
      domain: "research",
      prompt: "CHILD SECRET PROMPT: find source-backed evidence.",
      whenToUse: "Use for market or factual research.",
      outputContract: "Return findings, sources, and confidence.",
      defaultTools: universalToolPolicy(["WebSearch", "WebFetch"], ["Write"]),
      mcpServers: ["sources"],
      skills: ["citation"],
      allowDelegation: false,
      builtIn: false,
      source: "user",
      version: 1,
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
  ],
  profile: {
    id: "profile.research",
    name: "Research Desk",
    preset: "research",
    mainAgent: {
      agentKey: "main",
      name: "Research Coordinator",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate a research answer without assuming a coding task.",
      modelRef: { providerId: "anthropic", modelId: "research-main-model" },
      tools: {
        ...universalToolPolicy(["Agent", "Read", "WebSearch"], ["Write"]),
        mcp: { allowedServers: ["browser"], allowedTools: ["mcp__sources__quote"] },
      },
      skills: [],
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: "user.researcher",
        displayName: "Evidence Researcher",
        modelRef: { providerId: "anthropic", modelId: "research-agent-model" },
        tools: universalToolPolicy(["WebSearch", "WebFetch"], ["Bash"]),
        mcpServers: ["browser"],
        skills: ["pdf"],
        enabled: true,
      },
    ],
    strategy: { kind: "autonomous", guidancePrompt: "Delegate when evidence quality improves." },
    version: 1,
    updatedAt: "2026-06-07T00:00:00.000Z",
    source: "user",
  },
};

const fixedWorkflowAgentRegistry: EcoAgentRuntimeConfig = {
  templates: [
    ...universalAgentRegistry.templates,
    {
      id: "user.synthesizer",
      name: "Synthesizer",
      description: "Turns evidence into a concise answer.",
      domain: "research",
      prompt: "Synthesize evidence into a clear final answer.",
      whenToUse: "Use after source discovery.",
      outputContract: "Return final synthesis.",
      defaultTools: universalToolPolicy(["Read"], ["Bash"]),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: false,
      source: "user",
      version: 1,
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
  ],
  profile: {
    ...universalAgentRegistry.profile,
    id: "profile.fixed_research",
    name: "Fixed Research Desk",
    agents: [
      ...universalAgentRegistry.profile.agents,
      {
        agentKey: "synthesizer",
        templateId: "user.synthesizer",
        displayName: "Research Synthesizer",
        modelRef: { providerId: "anthropic", modelId: "synthesis-agent-model" },
        tools: universalToolPolicy(["Read"], ["Bash"]),
        mcpServers: [],
        skills: [],
        enabled: true,
      },
    ],
    strategy: {
      kind: "fixed",
      steps: [
        {
          id: "research",
          agentKey: "researcher",
          promptTemplate: "Research {{userPrompt}}.",
          dependsOn: [],
          runMode: "sequential",
          required: true,
          outputKey: "research_notes",
          failurePolicy: "stop",
        },
        {
          id: "synthesis",
          agentKey: "synthesizer",
          promptTemplate: "Synthesize from {{step.research}}.",
          dependsOn: ["research"],
          runMode: "sequential",
          required: true,
          outputKey: "final_answer",
          failurePolicy: "stop",
        },
      ],
    },
  },
};

test("deleteClaudeAgentSdkSession delegates to SDK deleteSession", async () => {
  const sessionStore = {
    append: async () => undefined,
    load: async () => null,
    delete: async () => undefined,
  };
  const calls: Array<{ sessionId: string; options: unknown }> = [];

  await deleteClaudeAgentSdkSession({
    sessionId: " session_123 ",
    dir: " /tmp/project ",
    sessionStore,
    loadSdk: async () => ({
      query: () => emptySdkQuery(),
      deleteSession: async (sessionId, options) => {
        calls.push({ sessionId, options });
      },
    }),
  });

  expect(calls).toEqual([
    {
      sessionId: "session_123",
      options: { dir: "/tmp/project", sessionStore },
    },
  ]);
});

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
    expect(env.CLAUDE_CODE_DISABLE_WORKFLOWS).toBe("1");
  } finally {
    if (previous.ANTHROPIC_API_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous.ANTHROPIC_API_KEY;
    if (previous.ANTHROPIC_BASE_URL === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previous.ANTHROPIC_BASE_URL;
    if (previous.ANTHROPIC_AUTH_TOKEN === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
    else process.env.ANTHROPIC_AUTH_TOKEN = previous.ANTHROPIC_AUTH_TOKEN;
  }
});

test("applyEcoSdkSettings disables workflows and denies SDK built-in subagents", () => {
  const options: Record<string, unknown> = {};
  applyEcoSdkSettings(options, "router-key", "http://127.0.0.1:36037/");
  expect(options.settings).toMatchObject({
    disableWorkflows: true,
    permissions: {
      deny: expect.arrayContaining([
        "Agent(general-purpose)",
        "Agent(Explore)",
        "Agent(Plan)",
        "Agent(Bash)",
        "Agent(statusline-setup)",
      ]),
    },
    env: {
      ANTHROPIC_API_KEY: "router-key",
      ANTHROPIC_BASE_URL: "http://127.0.0.1:36037",
    },
  });
});

test("createAutonomousAgentDefinitions registers all subagent roles", () => {
  const definitions = createAutonomousAgentDefinitions(routes);
  expect(Object.keys(definitions).sort()).toEqual([
    ecoSubagentKeyForRole("architect"),
    ecoSubagentKeyForRole("coder"),
    ecoSubagentKeyForRole("explore"),
    ecoSubagentKeyForRole("reviewer"),
    ecoSubagentKeyForRole("tester"),
  ]);
  const reviewer = definitions[ecoSubagentKeyForRole("reviewer")] as { description: string };
  expect(reviewer.description).toContain("High-risk");
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

test("includes network tools in default allowed tools", () => {
  const allowedTools = getDefaultAllowedTools();
  expect(allowedTools).toContain("Agent");
  expect(allowedTools).toContain("WebSearch");
  expect(allowedTools).toContain("WebFetch");
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
  expect(definitions).toHaveProperty(ecoSubagentKeyForRole("coder"));
  expect(definitions[ecoSubagentKeyForRole("coder")]).toMatchObject({
    description: expect.stringContaining("focused coding"),
    skills: ["docx"],
    model: "qwen-coder-anthropic",
  });
  expect(definitions[ecoSubagentKeyForRole("architect")]).toMatchObject({ skills: ["pdf"] });
  expect(definitions[ecoSubagentKeyForRole("reviewer")]).not.toHaveProperty("skills");
  expect(resolveAgentSkills("tester", agentSkills)).toEqual([]);
  expect(resolveAgentSkills("researcher", { eco_researcher: ["workspace-research"] })).toEqual([
    "workspace-research",
  ]);
  expect(resolveAgentSkills("eco_researcher", { researcher: ["raw-research"] })).toEqual([
    "raw-research",
  ]);
});

test("execution architect prompt requires Coder Tasks section", () => {
  const definitions = createExecutionAgentDefinitions(routes);
  expect(definitions[ecoSubagentKeyForRole("architect")]).toMatchObject({
    prompt: expect.stringContaining("## Coder Tasks"),
  });
  expect(definitions[ecoSubagentKeyForRole("coder")]).toMatchObject({
    prompt: expect.stringMatching(/runnable, verified code/),
  });
  expect(definitions[ecoSubagentKeyForRole("tester")]).toMatchObject({
    prompt: expect.stringContaining("## Test Verdict"),
  });
});

test("reviewer prompt limits scope to current session workspace diff", () => {
  const definitions = createExecutionAgentDefinitions(routes);
  expect(definitions[ecoSubagentKeyForRole("reviewer")]).toMatchObject({
    description: expect.stringContaining("High-risk"),
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

  expect(buildPlanningPhasePrompt(userPrompt)).toContain("explore before finalize");
  expect(buildPlanningPhasePrompt(userPrompt)).toContain("AskUserQuestion");
  expect(buildPlanningPhasePrompt(userPrompt)).toContain("mcp__eco_plan__finalize_plan");
  expect(planningPhaseSystemAppend).toContain("explore first, ask second");
  expect(planningPhaseSystemAppend).toContain("Finalization rule");
  expect(planningPhaseSystemAppend).toContain("Eco Plan Mode pipeline");
  expect(buildPlanningPhasePrompt(userPrompt)).not.toContain("Do NOT call `mcp__eco_plan__finalize_plan`");
  expect(executePhaseSystemAppend).toContain("TaskCreate");
  expect(executePhaseSystemAppend).toContain("TaskUpdate");
  expect(executePhaseSystemAppend).toContain("Exactly ONE step must be in_progress");
  expect(executePhaseSystemAppend).toContain("Do not restate the full approved plan");
  expect(executePhaseSystemAppend).toContain("Architect (conditional)");
  expect(executePhaseSystemAppend).toContain("Coders (parallel)");
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan)).toContain(plan);
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan)).toContain("system-reminder");
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan)).toContain("Pipeline —");
  expect(buildExecutePhasePrompt(userPrompt, analysis, plan, { planUserEdited: true })).toContain(
    "edited this plan in Eco",
  );
});

test("planning agents include network tools on read-only subagents", () => {
  const definitions = createPlanningAgentDefinitions(routes);
  expect(definitions[ecoSubagentKeyForRole("explore")]).toMatchObject({
    description: expect.stringContaining("Read-only"),
    prompt: expect.stringContaining("read-only"),
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
    model: "claude-haiku-explore",
  });
  expect(definitions).not.toHaveProperty("Explore");
  expect(definitions).not.toHaveProperty("explore");
  expect(definitions[ecoSubagentKeyForRole("architect")]).toMatchObject({
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  });
});

test("question explore subagent includes network tools", () => {
  const definitions = createQuestionAgentDefinitions(routes);
  expect(definitions[ecoSubagentKeyForRole("explore")]).toMatchObject({
    model: "claude-haiku-explore",
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  });
  expect(definitions).not.toHaveProperty("Explore");
  expect(definitions).not.toHaveProperty("explore");
});

test("execution subagents include network tools except coder", () => {
  const definitions = createExecutionAgentDefinitions(routes);
  expect(definitions[ecoSubagentKeyForRole("architect")]).toMatchObject({
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  });
  expect(definitions[ecoSubagentKeyForRole("reviewer")]).toMatchObject({
    tools: ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  });
  expect(definitions[ecoSubagentKeyForRole("tester")]).toMatchObject({
    tools: ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  });
  expect(definitions[ecoSubagentKeyForRole("coder")]).toMatchObject({
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  });
  const coderTools = (definitions[ecoSubagentKeyForRole("coder")] as { tools: string[] }).tools;
  expect(coderTools).not.toContain("WebSearch");
  expect(coderTools).not.toContain("WebFetch");
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
  expect(definitions).toHaveProperty(ecoSubagentKeyForRole("coder"));
  expect(definitions).not.toHaveProperty(ecoSubagentKeyForRole("reviewer"));
  expect(definitions).not.toHaveProperty(ecoSubagentKeyForRole("tester"));
});

test("buildExecutePhaseSystemAppend skips reviewer and tester when disabled", () => {
  const append = buildExecutePhaseSystemAppend({
    explore: true,
    architect: true,
    coder: true,
    reviewer: false,
    tester: false,
  });
  expect(append).not.toContain(`Agent(${ecoSubagentKeyForRole("reviewer")})`);
  expect(append).not.toContain(`Agent(${ecoSubagentKeyForRole("tester")})`);
  expect(append).toContain("Reviewer subagent is disabled");
  expect(append).toContain("Tester subagent is disabled");
  expect(append).toContain("Coders (parallel)");
});

test("inferActivityRole maps Agent(Explore) to explore", () => {
  expect(
    inferActivityRole({
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Agent",
        input: { subagent_type: "Explore", prompt: "Find auth middleware" },
      },
    }),
  ).toBe("explore");
});

test("builds read-only question answering prompts", () => {
  expect(questionAnswerSystemAppend).toContain("ANSWER");
  expect(questionAnswerSystemAppend).toContain("read-only");
  expect(questionAnswerSystemAppend).toContain(`Agent(${ecoSubagentKeyForRole("explore")})`);
  expect(questionAnswerSystemAppend).toContain("Do not create an implementation plan");
  expect(buildQuestionAnswerPrompt("How does routing work?")).toContain("User question:");
  expect(buildQuestionAnswerPrompt("How does routing work?")).toContain(
    `Agent(${ecoSubagentKeyForRole("explore")})`,
  );
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
  transcript = appendToPhaseTranscript(transcript, {
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
  });
  transcript = appendToPhaseTranscript(transcript, {
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
  });
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

  expect(
    formatSdkPayloadMessage({
      type: "eco_stream",
      blockKind: "text",
      text: "Final answer from assistant.",
      streamFinalize: true,
    }),
  ).toBe("Final answer from assistant.");

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

  const assistantEvents = mapSdkMessageToEvents(
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
  );
  expect(assistantEvents.length).toBeGreaterThanOrEqual(1);
  expect(
    assistantEvents.some(
      (event) =>
        event.type === "message.delta" &&
        formatAgentEventDisplay(event)?.message === "Already streamed elsewhere.",
    ),
  ).toBe(true);
  expect(assistantEvents.some((event) => event.type === "tool.started")).toBe(true);

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

test("createToolPermissionDeniedEvent formats audit-friendly tool failures", () => {
  const event = createToolPermissionDeniedEvent(
    "thr_1",
    {
      permissionDecision: "deny",
      toolName: "Bash",
      toolUseId: "tool_denied",
      reason: "Bash is disabled for this Eco agent.",
      actor: "eco_researcher",
      sessionId: "session_1",
      agentId: "agent_researcher",
      agentType: "eco_researcher",
      cwd: "/repo",
    },
    () => "uuid_1",
  );

  expect(event).toMatchObject({
    id: "thr_1:tool-permission-denied:tool_denied:uuid_1",
    type: "tool.failed",
    agentId: "agent_researcher",
    payload: {
      type: "tool_permission_denied",
      tool_name: "Bash",
      tool_use_id: "tool_denied",
      message: "Bash is disabled for this Eco agent.",
      actor: "eco_researcher",
    },
  });
  expect(formatAgentEventLine(event)).toBe(
    "Permission denied for Bash: Bash is disabled for this Eco agent.",
  );
  expect(inferActivityRole(event)).toBe("tool");
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
      session_id: "session_1",
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
  expect(withStore.extraArgs).toBeUndefined();

  const withoutStore: Record<string, unknown> = {};
  applySessionStoreToQueryOptions(withoutStore);
  expect(withoutStore.enableFileCheckpointing).toBe(true);
  expect(withoutStore.extraArgs).toEqual({ "replay-user-messages": null });
});

test("readSdkUserMessageCheckpointId reads user message uuid", () => {
  expect(readSdkUserMessageCheckpointId({ type: "assistant" })).toBeUndefined();
  expect(readSdkUserMessageCheckpointId({ type: "user", uuid: "msg-checkpoint-1" })).toBe("msg-checkpoint-1");
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

test("buildExecutionPromptWithFollowUp appends User follow-up on resume", () => {
  const prompt = buildExecutionPromptWithFollowUp(
    { userPrompt: "Add feature X", analysis: "Needs tests", plan: "Do the thing" },
    "also add unit tests",
    { isResume: true },
  );
  expect(prompt).toContain("User follow-up:");
  expect(prompt).toContain("also add unit tests");
  expect(prompt).not.toContain("Do the thing");
  expect(prompt).toContain("approved plan already submitted");
});

test("buildExecutionPromptWithFollowUp omits duplicate follow-up matching original task", () => {
  const prompt = buildExecutionPromptWithFollowUp(
    { userPrompt: "same task", analysis: "a", plan: "p" },
    "same task",
    { isResume: true },
  );
  expect(prompt).not.toContain("User follow-up:");
});

test("buildExecuteResumePrompt references approved plan by default when resuming", () => {
  const prompt = buildExecuteResumePrompt({
    userPrompt: "Add feature X",
    analysis: "Needs tests",
    plan: "Do the thing",
    approvedPlanFile: ".eco/approved-plans/thr_1.md",
  });
  expect(prompt).toContain("phase 2 execution");
  expect(prompt).toContain("approved plan already submitted");
  expect(prompt).not.toContain("Do the thing");
  expect(prompt).not.toContain("Add feature X");
  expect(prompt).toContain(".eco/approved-plans/thr_1.md");
  expect(prompt).not.toContain("from our conversation above");
});

test("buildExecuteResumePrompt can inline edited approved plan once", () => {
  const prompt = buildExecuteResumePrompt(
    {
      userPrompt: "Add feature X",
      analysis: "Needs tests",
      plan: "Edited plan",
      approvedPlanFile: ".eco/approved-plans/thr_1.md",
      planUserEdited: true,
    },
    { includePlanText: true },
  );
  expect(prompt).toContain("Edited plan");
  expect(prompt).toContain("Add feature X");
  expect(prompt).toContain("user edited this plan");
  expect(
    buildExecuteResumePrompt({
      userPrompt: "x",
      analysis: "y",
      plan: "Edited",
      planUserEdited: true,
    }),
  ).toContain("approved/on-disk plan");
});

test("ClaudeAgentSdkDriver forwards eco agent definitions with configured route models", async () => {
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
              session_id: "sess-agents",
              uuid: "init-agents",
            };
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-agents",
              uuid: "result-agents",
            };
          },
          close: () => {},
        };
      },
    }),
  });
  const runInput = {
    threadId: "thr_agents",
    prompt: "Inspect and implement",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
  };

  for await (const _event of driver.run({
    ...runInput,
    signal: new AbortController().signal,
  })) {
    // drain
  }
  for await (const _event of driver.runQuestion({
    ...runInput,
    signal: new AbortController().signal,
  })) {
    // drain
  }
  for await (const _event of driver.runExecution(
    {
      ...runInput,
      signal: new AbortController().signal,
    },
    {
      userPrompt: "Inspect and implement",
      analysis: "Needs execution",
      plan: "Run coders and review",
    },
  )) {
    // drain
  }

  const planningAgents = capturedOptions[0]?.agents as Record<string, { model?: string }> | undefined;
  expect(Object.keys(planningAgents ?? {}).sort()).toEqual([
    ecoSubagentKeyForRole("architect"),
    ecoSubagentKeyForRole("explore"),
  ]);
  expect(planningAgents?.[ecoSubagentKeyForRole("explore")]?.model).toBe("claude-haiku-explore");
  expect(planningAgents?.[ecoSubagentKeyForRole("architect")]?.model).toBe("claude-sonnet-architect");

  const questionAgents = capturedOptions[1]?.agents as Record<string, { model?: string }> | undefined;
  expect(Object.keys(questionAgents ?? {})).toEqual([ecoSubagentKeyForRole("explore")]);
  expect(questionAgents?.[ecoSubagentKeyForRole("explore")]?.model).toBe("claude-haiku-explore");

  const executionAgents = capturedOptions[2]?.agents as Record<string, { model?: string }> | undefined;
  expect(Object.keys(executionAgents ?? {}).sort()).toEqual([
    ecoSubagentKeyForRole("architect"),
    ecoSubagentKeyForRole("coder"),
    ecoSubagentKeyForRole("explore"),
    ecoSubagentKeyForRole("reviewer"),
    ecoSubagentKeyForRole("tester"),
  ]);
  expect(executionAgents?.[ecoSubagentKeyForRole("coder")]?.model).toBe("qwen-coder-anthropic");
  expect(executionAgents?.[ecoSubagentKeyForRole("reviewer")]?.model).toBe("claude-sonnet-reviewer");
  expect(executionAgents).not.toHaveProperty("Explore");
  expect(executionAgents).not.toHaveProperty("coder");
});

test("ClaudeAgentSdkDriver forwards universal agent registry without coding prompt wrappers", async () => {
  const capturedQueries: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    loadSdk: async () => ({
      query: ({ prompt, options }) => {
        capturedQueries.push({ prompt, options });
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "system",
              subtype: "init",
              session_id: "sess-universal",
              uuid: "init-universal",
            };
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-universal",
              uuid: "result-universal",
            };
          },
          close: () => {},
        };
      },
    }),
  });

  for await (const _event of driver.runQuestion({
    threadId: "thr_universal",
    prompt: "Summarize the 2026 market landscape.",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
    signal: new AbortController().signal,
    sdkSession: {
      mcpAllowedTools: ["mcp__browser__open"],
      agentSkills: { researcher: ["workspace-research"] },
    },
    agentRegistry: universalAgentRegistry,
  })) {
    // drain
  }

  const query = capturedQueries[0];
  expect(query?.prompt).toContain("Summarize the 2026 market landscape.");
  expect(query?.prompt).not.toContain("For a known file or symbol");
  expect(query?.prompt).not.toContain("Do not create an implementation plan");

  const options = query?.options ?? {};
  expect(options.model).toBe("research-main-model");
  expect(options.allowedTools).toEqual([
    "Agent",
    "Read",
    "WebSearch",
    "mcp__sources__quote",
    "mcp__browser__*",
    "mcp__browser__open",
  ]);

  const agents = options.agents as Record<string, Record<string, unknown>>;
  expect(Object.keys(agents)).toEqual(["eco_researcher"]);
  expect(agents.eco_researcher).toMatchObject({
    model: "research-agent-model",
    tools: ["WebSearch", "WebFetch", "mcp__sources__*", "mcp__browser__*"],
    disallowedTools: ["Bash"],
    prompt: "CHILD SECRET PROMPT: find source-backed evidence.",
    mcpServers: ["sources", "browser"],
    skills: ["citation", "pdf", "workspace-research"],
  });

  const systemPrompt = options.systemPrompt as string;
  expect(systemPrompt).toContain("Coordinate a research answer without assuming a coding task.");
  expect(systemPrompt).toContain("Eco universal orchestration.");
  expect(systemPrompt).toContain("Agent(eco_researcher)");
  expect(systemPrompt).not.toContain("CHILD SECRET PROMPT");
  expect(systemPrompt).not.toContain("File edits apply directly");
});

test("ClaudeAgentSdkDriver emits tool failed audit events for denied dynamic permissions", async () => {
  const capturedQueries: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    loadSdk: async () => ({
      query: ({ prompt, options }) => {
        capturedQueries.push({ prompt, options });
        return {
          async *[Symbol.asyncIterator]() {
            const hooks = options.hooks as
              | Record<
                  string,
                  Array<{ hooks: Array<(input: unknown, toolUseId?: string, ctx?: unknown) => unknown> }>
                >
              | undefined;
            for (const matcher of hooks?.PreToolUse ?? []) {
              for (const hook of matcher.hooks) {
                await hook(
                  {
                    hook_event_name: "PreToolUse",
                    tool_name: "Bash",
                    tool_input: { command: "rm -rf src" },
                    tool_use_id: "tool_denied",
                    session_id: "sess-denied",
                    cwd: "/tmp/workspace",
                    agent_id: "agent_researcher",
                    agent_type: "eco_researcher",
                  },
                  "tool_denied",
                  { signal: new AbortController().signal },
                );
              }
            }
            yield {
              type: "system",
              subtype: "init",
              session_id: "sess-denied",
              uuid: "init-denied",
            };
            yield {
              type: "result",
              subtype: "success",
              session_id: "sess-denied",
              uuid: "result-denied",
            };
          },
          close: () => {},
        };
      },
    }),
  });

  const events = [];
  for await (const event of driver.runQuestion({
    threadId: "thr_denied",
    prompt: "Research with a denied command.",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/workspace",
    routes,
    signal: new AbortController().signal,
    agentRegistry: universalAgentRegistry,
  })) {
    events.push(event);
  }

  expect(capturedQueries[0]?.options.hooks).toBeDefined();
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "tool.failed",
      agentId: "agent_researcher",
      payload: expect.objectContaining({
        type: "tool_permission_denied",
        tool_name: "Bash",
        tool_use_id: "tool_denied",
        actor: "eco_researcher",
      }),
    }),
  );
});

test("ClaudeAgentSdkDriver executes fixed universal workflows step by step", async () => {
  const capturedQueries: Array<{ prompt: string; options: Record<string, unknown> }> = [];
  const driver = new ClaudeAgentSdkDriver({
    apiKey: "test-key",
    baseUrl: "http://127.0.0.1:36037",
    loadSdk: async () => ({
      query: ({ prompt, options }) => {
        const callIndex = capturedQueries.length + 1;
        capturedQueries.push({ prompt, options });
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: "system",
              subtype: "init",
              session_id: `sess-fixed-${callIndex}`,
              uuid: `init-fixed-${callIndex}`,
            };
            yield {
              type: "assistant",
              uuid: `assistant-fixed-${callIndex}`,
              session_id: `sess-fixed-${callIndex}`,
              message: {
                content: [{ type: "text", text: `step output ${callIndex}` }],
              },
            };
            yield {
              type: "result",
              subtype: "success",
              session_id: `sess-fixed-${callIndex}`,
              uuid: `result-fixed-${callIndex}`,
            };
          },
          close: () => {},
        };
      },
    }),
  });

  const events: Array<{ type: string; payload: unknown }> = [];
  for await (const event of driver.run({
    threadId: "thr_fixed_universal",
    prompt: "Explain the market landscape.",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
    signal: new AbortController().signal,
    agentRegistry: fixedWorkflowAgentRegistry,
  })) {
    events.push({ type: event.type, payload: event.payload });
  }

  expect(capturedQueries).toHaveLength(2);
  expect(Object.keys((capturedQueries[0]?.options.agents ?? {}) as Record<string, unknown>)).toEqual([
    "eco_researcher",
  ]);
  expect(Object.keys((capturedQueries[1]?.options.agents ?? {}) as Record<string, unknown>)).toEqual([
    "eco_synthesizer",
  ]);
  expect(capturedQueries[0]?.prompt).toContain("Fixed workflow step: research.");
  expect(capturedQueries[1]?.prompt).toContain("Fixed workflow step: synthesis.");
  expect(capturedQueries[1]?.prompt).toContain("step output 1");

  expect(events.some((event) => JSON.stringify(event.payload).includes("固定编排开始"))).toBe(true);
  expect(events.some((event) => JSON.stringify(event.payload).includes('"id":"research"'))).toBe(true);
  expect(events.some((event) => JSON.stringify(event.payload).includes('"status":"completed"'))).toBe(true);
  expect(
    events.some(
      (event) =>
        event.type === "message.delta" &&
        JSON.stringify(event.payload).includes('"ecoWorkflowStepContext"') &&
        JSON.stringify(event.payload).includes('"id":"research"') &&
        JSON.stringify(event.payload).includes('"agentKey":"researcher"') &&
        JSON.stringify(event.payload).includes('"outputKey":"research_notes"'),
    ),
  ).toBe(true);
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

  const events: Array<{ type: string }> = [];
  for await (const event of driver.run({
    threadId: "thr_plan_tool",
    prompt: "Add markdown rendering",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
    signal: new AbortController().signal,
  })) {
    events.push({ type: event.type });
  }
  expect(capturedOptions[0]?.allowedTools).not.toContain("Bash");
  expect(capturedOptions[0]?.allowedTools).not.toContain("Write");
  expect(capturedOptions[0]?.permissionMode).toBe("dontAsk");
  expect(capturedOptions[0]?.allowedTools).toContain("WebSearch");
  expect(capturedOptions[0]?.allowedTools).toContain("WebFetch");
  expect(capturedOptions[0]?.allowedTools).toContain("mcp__eco_plan__finalize_plan");
  expect(capturedOptions[0]?.mcpServers).toBeDefined();
  expect(
    Object.prototype.hasOwnProperty.call(
      (capturedOptions[0]?.mcpServers ?? {}) as Record<string, unknown>,
      "eco_plan",
    ),
  ).toBe(true);
  expect(events.some((event) => event.type === "plan.ready")).toBe(false);
});

test("ClaudeAgentSdkDriver planning completes without FinalizePlan", async () => {
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

  const events: Array<{ type: string }> = [];
  for await (const event of driver.run({
    threadId: "thr_plan_missing",
    prompt: "Plan this feature",
    workspacePath: "/tmp/workspace",
    worktreePath: "/tmp/worktree",
    routes,
    signal: new AbortController().signal,
  })) {
    events.push({ type: event.type });
  }

  expect(events.some((event) => event.type === "plan.ready")).toBe(false);
});
