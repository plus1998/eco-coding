import { expect, test } from "bun:test";
import {
  createPiEventAdapterState,
  mapPiSessionEventToAgentEvents,
  type PiEventAdapterContext,
} from "../src/pi-event-adapter";
import { parsePiUsage } from "../src/pi-usage";
import { buildEcoPiModel } from "../src/pi-model-bridge";
import { PiCodingAgentDriver, PiSessionRegistry, type PiSessionHandle, decidePiPromptRunTerminal } from "../src/pi-coding-agent-driver";
import type { SdkToolPermissionHandler } from "../src/ask-user-question";
import { type AgentEvent } from "../../shared/src";

function makeCtx(): PiEventAdapterContext {
  let seq = 0;
  return {
    threadId: "thr_pi",
    sessionId: "sess_1",
    state: createPiEventAdapterState(),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
  };
}

function streamKey(event: AgentEvent | undefined): string | undefined {
  const payload = event?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const key = (payload as { stream_block_key?: unknown }).stream_block_key;
  return typeof key === "string" ? key : undefined;
}

function isFinalize(event: AgentEvent | undefined): boolean {
  const payload = event?.payload;
  return Boolean(
    payload && typeof payload === "object" && !Array.isArray(payload) && (payload as { streamFinalize?: unknown }).streamFinalize === true,
  );
}

test("parsePiUsage maps pi-ai usage fields", () => {
  const usage = parsePiUsage(
    {
      input: 100,
      output: 20,
      cacheRead: 50,
      cacheWrite: 10,
      cost: { total: 0.01 },
    },
    "model-x",
  );
  expect(usage).toEqual({
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 50,
    cacheCreationTokens: 10,
    totalCostUsd: 0.01,
    modelId: "model-x",
  });
});

test("parsePiUsage returns null when empty", () => {
  expect(parsePiUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
});

test("mapPiSessionEvent maps text deltas and tools", () => {
  const ctx = makeCtx();
  mapPiSessionEventToAgentEvents({ type: "message_start", message: { role: "assistant", content: [] } }, ctx);
  const deltas = mapPiSessionEventToAgentEvents(
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello", contentIndex: 0 },
    },
    ctx,
  );
  expect(deltas).toHaveLength(1);
  expect(deltas[0]?.type).toBe("message.delta");
  expect((deltas[0]?.payload as { text?: string }).text).toBe("Hello");
  expect(streamKey(deltas[0])).toContain("pi-text:sess_1:m1");
  expect(deltas[0]?.agentId).toBe("sess_1");

  const thinking = mapPiSessionEventToAgentEvents(
    {
      type: "message_update",
      assistantMessageEvent: { type: "thinking_delta", delta: "Plan: check files", contentIndex: 0 },
    },
    makeCtx(),
  );
  expect(thinking[0]?.type).toBe("message.delta");
  expect((thinking[0]?.payload as { blockKind?: string; reasoningDisplay?: string }).blockKind).toBe(
    "thinking",
  );
  expect(
    (thinking[0]?.payload as { reasoningDisplay?: string }).reasoningDisplay,
  ).toBe("summary");

  const start = mapPiSessionEventToAgentEvents(
    {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls" },
    },
    ctx,
  );
  // open text finalizes before tool.started
  expect(start.some((e) => e.type === "tool.started")).toBe(true);
  expect(start.some((e) => isFinalize(e) && streamKey(e)?.includes("pi-text"))).toBe(true);

  const end = mapPiSessionEventToAgentEvents(
    {
      type: "tool_execution_end",
      toolCallId: "tc1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
    },
    ctx,
  );
  expect(end[0]?.type).toBe("tool.completed");
});

test("mapPiSessionEvent emits usage.recorded from message_end", () => {
  const events = mapPiSessionEventToAgentEvents(
    {
      type: "message_end",
      message: {
        role: "assistant",
        model: "eco-alias",
        content: [{ type: "text", text: "done" }],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.002 } },
      },
    },
    makeCtx(),
  );
  expect(events.some((e) => e.type === "message.delta")).toBe(true);
  const usage = events.find((e) => e.type === "usage.recorded");
  expect(usage).toBeTruthy();
  expect((usage?.payload as { source?: string }).source).toBe("pi");
});

test("PI feed isolates thinking/text across messages and finalizes streams", () => {
  const ctx = makeCtx();
  const types: string[] = [];
  const keys: string[] = [];

  const feed = (event: Parameters<typeof mapPiSessionEventToAgentEvents>[0]) => {
    for (const out of mapPiSessionEventToAgentEvents(event, ctx)) {
      types.push(out.type);
      const key = streamKey(out);
      if (key) keys.push(`${isFinalize(out) ? "F" : "D"}:${key}`);
    }
  };

  // message 1: thinking then text
  feed({ type: "message_start", message: { role: "assistant", content: [] } });
  feed({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "reason-1", contentIndex: 0 },
  });
  feed({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end", content: "reason-1", contentIndex: 0 },
  });
  feed({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "answer-1", contentIndex: 1 },
  });
  feed({
    type: "message_update",
    assistantMessageEvent: { type: "text_end", content: "answer-1", contentIndex: 1 },
  });
  feed({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reason-1" },
        { type: "text", text: "answer-1" },
      ],
    },
  });

  // tool barrier
  feed({
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "bash",
    args: { command: "ls" },
  });
  feed({
    type: "tool_execution_end",
    toolCallId: "t1",
    toolName: "bash",
    result: "ok",
    isError: false,
  });

  // message 2: new thinking must NOT reuse message-1 stream keys
  feed({ type: "message_start", message: { role: "assistant", content: [] } });
  feed({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "reason-2", contentIndex: 0 },
  });
  feed({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "answer-2", contentIndex: 1 },
  });
  feed({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reason-2" },
        { type: "text", text: "answer-2" },
      ],
    },
  });

  expect(keys.some((k) => k.includes(":m1:"))).toBe(true);
  expect(keys.some((k) => k.includes(":m2:"))).toBe(true);
  // thinking keys for m1 and m2 must differ
  const thinkingKeys = keys.filter((k) => k.includes("pi-thinking"));
  expect(thinkingKeys.some((k) => k.includes(":m1:"))).toBe(true);
  expect(thinkingKeys.some((k) => k.includes(":m2:"))).toBe(true);
  // message_end after stream should not re-dump full answer body as a third text block with body
  const reEmittedBodies = keys.filter((k) => k.startsWith("D:pi-text") && k.includes(":m1:"));
  // only the original text_delta should be non-finalize for m1 text
  expect(reEmittedBodies.length).toBeLessThanOrEqual(1);
  // post tool message-2 open streams finalize on message_end
  expect(keys.some((k) => k.startsWith("F:pi-thinking") && k.includes(":m2:"))).toBe(true);
  expect(keys.some((k) => k.startsWith("F:pi-text") && k.includes(":m2:"))).toBe(true);
  expect(types.includes("tool.started")).toBe(true);
});

test("message_end after streamed text does not re-emit full body", () => {
  const ctx = makeCtx();
  mapPiSessionEventToAgentEvents({ type: "message_start", message: { role: "assistant", content: [] } }, ctx);
  mapPiSessionEventToAgentEvents(
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello ", contentIndex: 0 },
    },
    ctx,
  );
  mapPiSessionEventToAgentEvents(
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world", contentIndex: 0 },
    },
    ctx,
  );
  const end = mapPiSessionEventToAgentEvents(
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    },
    ctx,
  );
  const withBody = end.filter(
    (e) =>
      e.type === "message.delta" &&
      isRecord(e.payload) &&
      e.payload.blockKind === "text" &&
      typeof e.payload.text === "string" &&
      e.payload.text.length > 0,
  );
  expect(withBody).toHaveLength(0);
  expect(end.some((e) => isFinalize(e))).toBe(true);
});

test("PI planner agentId is session id; non-assistant message_start does not burn generation", () => {
  const ctx = makeCtx();
  mapPiSessionEventToAgentEvents(
    { type: "message_start", message: { role: "assistant", content: [] } },
    ctx,
  );
  const events = mapPiSessionEventToAgentEvents(
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "hi", contentIndex: 0 },
    },
    ctx,
  );
  expect(events[0]?.agentId).toBe("sess_1");
  // Tool-result-like non-assistant message_start must not burn a generation.
  const before = ctx.state.messageSeq;
  mapPiSessionEventToAgentEvents(
    { type: "message_start", message: { role: "toolResult", content: [] } },
    ctx,
  );
  expect(ctx.state.messageSeq).toBe(before);
});

test("buildEcoPiModel rejects non-HTTP base URLs", () => {
  expect(() =>
    buildEcoPiModel({
      bridgeBaseUrl: "not-a-url",
      bridgeModelId: "eco_planner__p1__m",
    }),
  ).toThrow(/HTTP/);
});

test("buildEcoPiModel contextWindow is min(model, global)", () => {
  expect(
    buildEcoPiModel({
      bridgeBaseUrl: "http://127.0.0.1:18765",
      bridgeModelId: "alias-1m",
      contextWindow: 1_000_000,
      globalContextWindowLimit: 262_144,
    }).contextWindow,
  ).toBe(262_144);
});

test("buildEcoPiModel keeps a model window smaller than the global cap", () => {
  expect(
    buildEcoPiModel({
      bridgeBaseUrl: "http://127.0.0.1:18765",
      bridgeModelId: "alias-128k",
      contextWindow: 128_000,
      globalContextWindowLimit: 262_144,
    }).contextWindow,
  ).toBe(128_000);
});

test("buildEcoPiModel maps apiCompat to Pi api / auth provider", () => {
  const anthropic = buildEcoPiModel({
    bridgeBaseUrl: "http://127.0.0.1:18765",
    bridgeModelId: "alias-a",
    apiCompat: "anthropic",
  });
  expect(anthropic.api).toBe("anthropic-messages");
  expect(anthropic.provider).toBe("anthropic");

  const responses = buildEcoPiModel({
    bridgeBaseUrl: "http://127.0.0.1:18765",
    bridgeModelId: "alias-r",
    apiCompat: "openai_responses",
  });
  expect(responses.api).toBe("openai-responses");
  expect(responses.provider).toBe("openai");

  const chat = buildEcoPiModel({
    bridgeBaseUrl: "http://127.0.0.1:18765",
    bridgeModelId: "alias-c",
    apiCompat: "openai_chat_completions",
  });
  expect(chat.api).toBe("openai-completions");
  expect(chat.provider).toBe("openai");
});

test("agent_end is not run terminal; agent_settled is settle-only", () => {
  const end = mapPiSessionEventToAgentEvents(
    { type: "agent_end", messages: [], willRetry: false },
    makeCtx(),
  );
  expect(end.some((e) => e.type === "agent.loop_ended")).toBe(true);
  expect(end.some((e) => e.type === "agent.completed")).toBe(false);
  expect(end.some((e) => e.type === "run.terminal")).toBe(false);

  const settled = mapPiSessionEventToAgentEvents({ type: "agent_settled" }, makeCtx());
  expect(settled.some((e) => e.type === "agent.settled")).toBe(true);
  expect(settled.some((e) => e.type === "run.terminal")).toBe(false);
});

test("decidePiPromptRunTerminal: only agent_settled may complete", () => {
  expect(
    decidePiPromptRunTerminal({
      sawAgentSettled: true,
      aborted: false,
      promptReturned: true,
    }),
  ).toEqual({ status: "completed" });

  expect(
    decidePiPromptRunTerminal({
      sawAgentSettled: false,
      aborted: false,
      promptReturned: true,
    }),
  ).toEqual({
    status: "incomplete",
    reason: "PI prompt returned without agent_settled.",
  });

  expect(
    decidePiPromptRunTerminal({
      sawAgentSettled: false,
      aborted: false,
      promptReturned: false,
      errorMessage: "boom",
    }),
  ).toEqual({ status: "failed", error: "boom" });

  expect(
    decidePiPromptRunTerminal({
      sawAgentSettled: true,
      aborted: true,
      promptReturned: false,
    }),
  ).toEqual({ status: "cancelled", reason: "cancelled by user" });

  // prompt done must NEVER invent completed without settle
  const fakeSuccess = decidePiPromptRunTerminal({
    sawAgentSettled: false,
    aborted: false,
    promptReturned: true,
  });
  expect(fakeSuccess?.status).not.toBe("completed");
});

test("PiSessionRegistry isolates sessions and PiCodingAgentDriver streams events", async () => {
  const registry = new PiSessionRegistry();
  const eventsA: AgentEvent[] = [];
  const eventsB: AgentEvent[] = [];
  let createCount = 0;

  const makeHandle = (
    id: string,
    cwd: string,
    routeFingerprint: string,
    mcpFingerprint = "",
    sessionFile?: string,
  ): PiSessionHandle => ({
    sessionId: id,
    ...(sessionFile ? { sessionFile } : {}),
    cwd,
    routeFingerprint,
    bindingId: `bind_${id}`,
    skillsFingerprint: "",
    mcpFingerprint,
    abort: async () => {},
    dispose: () => {},
    rebind: async (input) => {
      // keep shape for driver rebind path
      void input;
    },
    updateSkillPaths: async () => {},
    async *prompt(text: string): AsyncIterable<AgentEvent> {
      yield {
        id: `${id}:msg`,
        threadId: "unused",
        agentId: id,
        role: "planner",
        type: "message.delta",
        payload: { type: "eco_stream", blockKind: "text", text: `echo:${text}` },
        createdAt: new Date().toISOString(),
      } as AgentEvent;
    },
  });

  const createInputs: Array<{
    sessionFile?: string;
    replacePersistedSessions?: boolean;
  }> = [];

  const driver = new PiCodingAgentDriver(
    {
      createSession: async (input) => {
        createCount += 1;
        createInputs.push({
          ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
          ...(input.replacePersistedSessions
            ? { replacePersistedSessions: true }
            : {}),
        });
        const { fingerprintPiMcpServers } = await import("../src/pi-mcp");
        return makeHandle(
          `sess_${input.threadId}_${createCount}`,
          input.cwd,
          input.routeFingerprint,
          fingerprintPiMcpServers(input.mcpServers),
          input.sessionFile ?? `/tmp/${input.threadId}_${createCount}.jsonl`,
        );
      },
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: "http://127.0.0.1:18765",
        bridgeModelId: "alias",
        apiKey: "k",
        agentDir: "/tmp/pi",
        apiCompat: "anthropic",
        bindingId: "cbb_test",
        providerId: "p",
      }),
    },
    registry,
  );

  const routes = [
    {
      role: "planner" as const,
      providerId: "p",
      modelId: "m",
      primary: { modelId: "m", contextWindow: 100_000 },
    },
  ];

  for await (const event of driver.run({
    threadId: "t1",
    prompt: "a",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: { mcpServers: { github: { command: "uvx" } } },
  })) {
    eventsA.push(event);
  }
  for await (const event of driver.run({
    threadId: "t2",
    prompt: "b",
    workspacePath: "/w2",
    worktreePath: "/w2",
    routes,
    signal: new AbortController().signal,
    piSession: { mcpServers: { slack: { command: "npx" } } },
  })) {
    eventsB.push(event);
  }

  expect(registry.get("t1")?.sessionId).toBe("sess_t1_1");
  expect(registry.get("t2")?.sessionId).toBe("sess_t2_2");
  expect(registry.get("t1")?.mcpFingerprint).not.toBe(registry.get("t2")?.mcpFingerprint);
  expect(eventsA.some((e) => e.type === "session.captured")).toBe(true);
  expect(eventsB.some((e) => e.type === "session.captured")).toBe(true);

  // Same MCP set reuses session; changed MCP recreates.
  const beforeReuse = createCount;
  for await (const _ of driver.run({
    threadId: "t1",
    prompt: "a2",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: { mcpServers: { github: { command: "uvx" } } },
  })) {
    // drain
  }
  expect(createCount).toBe(beforeReuse);
  expect(registry.get("t1")?.sessionId).toBe("sess_t1_1");

  for await (const _ of driver.run({
    threadId: "t1",
    prompt: "a3",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: { mcpServers: { github: { command: "uvx" }, extra: { command: "true" } } },
  })) {
    // drain
  }
  expect(createCount).toBe(beforeReuse + 1);
  expect(registry.get("t1")?.sessionId).toBe("sess_t1_3");
  expect(createInputs[createInputs.length - 1]?.replacePersistedSessions).toBe(true);
  expect(createInputs[createInputs.length - 1]?.sessionFile).toBeUndefined();

  registry.delete("t1");
  expect(registry.get("t1")).toBeUndefined();

  // Cold start with matching fingerprints opens sessionFile.
  const { computePiSessionIdentityFingerprint } = await import("../src/pi-coding-agent-driver");
  const { fingerprintPiMcpServers } = await import("../src/pi-mcp");
  const identity = computePiSessionIdentityFingerprint({
    cwd: "/w1",
    providerId: "p",
    modelId: "alias",
    apiCompat: "anthropic",
    baseUrl: "http://127.0.0.1:18765",
    routes,
  });
  const mcpFp = fingerprintPiMcpServers({ github: { command: "uvx" } });
  const resumePath = "/tmp/pi-resume-t1.jsonl";
  for await (const _ of driver.run({
    threadId: "t1",
    prompt: "resume",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: {
      mcpServers: { github: { command: "uvx" } },
      sessionFile: resumePath,
      resumeIdentityFingerprint: identity,
      resumeMcpFingerprint: mcpFp,
    },
  })) {
    // drain
  }
  expect(createInputs[createInputs.length - 1]?.sessionFile).toBe(resumePath);
  expect(createInputs[createInputs.length - 1]?.replacePersistedSessions).toBeUndefined();
  registry.delete("t1");

  // Cold start with mismatched MCP fingerprint starts fresh and clears old jsonl.
  for await (const _ of driver.run({
    threadId: "t1",
    prompt: "fresh",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: {
      mcpServers: { github: { command: "uvx" }, extra: { command: "true" } },
      sessionFile: resumePath,
      resumeIdentityFingerprint: identity,
      resumeMcpFingerprint: mcpFp,
    },
  })) {
    // drain
  }
  expect(createInputs[createInputs.length - 1]?.sessionFile).toBeUndefined();
  expect(createInputs[createInputs.length - 1]?.replacePersistedSessions).toBe(true);
});

test("token-only MCP env change reuses registry session", async () => {
  const registry = new PiSessionRegistry();
  let createCount = 0;
  const createInputs: Array<{
    sessionFile?: string;
    replacePersistedSessions?: boolean;
  }> = [];

  const makeHandle = (
    id: string,
    cwd: string,
    routeFingerprint: string,
    mcpFingerprint = "",
    sessionFile?: string,
  ): PiSessionHandle => ({
    sessionId: id,
    ...(sessionFile ? { sessionFile } : {}),
    cwd,
    routeFingerprint,
    bindingId: `bind_${id}`,
    skillsFingerprint: "",
    mcpFingerprint,
    abort: async () => {},
    dispose: () => {},
    rebind: async (input) => {
      void input;
    },
    updateSkillPaths: async () => {},
    async *prompt(text: string): AsyncIterable<AgentEvent> {
      yield {
        id: `${id}:msg`,
        threadId: "unused",
        agentId: id,
        role: "planner",
        type: "message.delta",
        payload: { type: "eco_stream", blockKind: "text", text: `echo:${text}` },
        createdAt: new Date().toISOString(),
      } as AgentEvent;
    },
  });

  const driver = new PiCodingAgentDriver(
    {
      createSession: async (input) => {
        createCount += 1;
        createInputs.push({
          ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
          ...(input.replacePersistedSessions
            ? { replacePersistedSessions: true }
            : {}),
        });
        const { fingerprintPiMcpServers } = await import("../src/pi-mcp");
        return makeHandle(
          `sess_${input.threadId}_${createCount}`,
          input.cwd,
          input.routeFingerprint,
          fingerprintPiMcpServers(input.mcpServers),
          input.sessionFile ?? `/tmp/${input.threadId}_${createCount}.jsonl`,
        );
      },
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: "http://127.0.0.1:18765",
        bridgeModelId: "alias",
        apiKey: "k",
        agentDir: "/tmp/pi",
        apiCompat: "anthropic",
        bindingId: "cbb_test",
        providerId: "p",
      }),
    },
    registry,
  );

  const routes = [
    {
      role: "planner" as const,
      providerId: "p",
      modelId: "m",
      primary: { modelId: "m", contextWindow: 100_000 },
    },
  ];

  const serversA = {
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: { ECO_BROWSER_AUTH_TOKEN: "a", ELECTRON_RUN_AS_NODE: "1" },
    },
  };
  const serversB = {
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: { ECO_BROWSER_AUTH_TOKEN: "b", ELECTRON_RUN_AS_NODE: "1" },
    },
  };

  for await (const _ of driver.run({
    threadId: "t_token",
    prompt: "1",
    workspacePath: "/w",
    worktreePath: "/w",
    routes,
    signal: new AbortController().signal,
    piSession: { mcpServers: serversA },
  })) {
    // drain
  }
  const before = createCount;
  const sid = registry.get("t_token")?.sessionId;

  for await (const _ of driver.run({
    threadId: "t_token",
    prompt: "2",
    workspacePath: "/w",
    worktreePath: "/w",
    routes,
    signal: new AbortController().signal,
    piSession: { mcpServers: serversB },
  })) {
    // drain
  }

  expect(createCount).toBe(before);
  expect(registry.get("t_token")?.sessionId).toBe(sid);
  expect(createInputs[createInputs.length - 1]?.replacePersistedSessions).toBeUndefined();
});

test("legacy resumeMcpFingerprint with embedded token still disk-resumes", async () => {
  const registry = new PiSessionRegistry();
  let createCount = 0;
  const createInputs: Array<{
    sessionFile?: string;
    replacePersistedSessions?: boolean;
  }> = [];

  const makeHandle = (
    id: string,
    cwd: string,
    routeFingerprint: string,
    mcpFingerprint = "",
    sessionFile?: string,
  ): PiSessionHandle => ({
    sessionId: id,
    ...(sessionFile ? { sessionFile } : {}),
    cwd,
    routeFingerprint,
    bindingId: `bind_${id}`,
    skillsFingerprint: "",
    mcpFingerprint,
    abort: async () => {},
    dispose: () => {},
    rebind: async (input) => {
      void input;
    },
    updateSkillPaths: async () => {},
    async *prompt(text: string): AsyncIterable<AgentEvent> {
      yield {
        id: `${id}:msg`,
        threadId: "unused",
        agentId: id,
        role: "planner",
        type: "message.delta",
        payload: { type: "eco_stream", blockKind: "text", text: `echo:${text}` },
        createdAt: new Date().toISOString(),
      } as AgentEvent;
    },
  });

  const driver = new PiCodingAgentDriver(
    {
      createSession: async (input) => {
        createCount += 1;
        createInputs.push({
          ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
          ...(input.replacePersistedSessions
            ? { replacePersistedSessions: true }
            : {}),
        });
        const { fingerprintPiMcpServers } = await import("../src/pi-mcp");
        return makeHandle(
          `sess_${input.threadId}_${createCount}`,
          input.cwd,
          input.routeFingerprint,
          fingerprintPiMcpServers(input.mcpServers),
          input.sessionFile ?? `/tmp/${input.threadId}_${createCount}.jsonl`,
        );
      },
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: "http://127.0.0.1:18765",
        bridgeModelId: "alias",
        apiKey: "k",
        agentDir: "/tmp/pi",
        apiCompat: "anthropic",
        bindingId: "cbb_test",
        providerId: "p",
      }),
    },
    registry,
  );

  const routes = [
    {
      role: "planner" as const,
      providerId: "p",
      modelId: "m",
      primary: { modelId: "m", contextWindow: 100_000 },
    },
  ];

  const serversA = {
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: { ECO_BROWSER_AUTH_TOKEN: "a", ELECTRON_RUN_AS_NODE: "1" },
    },
  };
  const serversB = {
    eco_agent_browser: {
      command: "node",
      args: ["b.mjs"],
      env: { ECO_BROWSER_AUTH_TOKEN: "b", ELECTRON_RUN_AS_NODE: "1" },
    },
  };

  const { computePiSessionIdentityFingerprint } = await import("../src/pi-coding-agent-driver");
  const identity = computePiSessionIdentityFingerprint({
    cwd: "/w",
    providerId: "p",
    modelId: "alias",
    apiCompat: "anthropic",
    baseUrl: "http://127.0.0.1:18765",
    routes,
  });
  // Legacy fingerprint: raw JSON with embedded auth token (pre-strip era).
  const legacyMcpFp = JSON.stringify([["eco_agent_browser", serversA.eco_agent_browser]]);
  const resumePath = "/tmp/pi-resume-t_token.jsonl";

  for await (const _ of driver.run({
    threadId: "t_token",
    prompt: "resume",
    workspacePath: "/w",
    worktreePath: "/w",
    routes,
    signal: new AbortController().signal,
    piSession: {
      mcpServers: serversB,
      sessionFile: resumePath,
      resumeIdentityFingerprint: identity,
      resumeMcpFingerprint: legacyMcpFp,
    },
  })) {
    // drain
  }

  expect(createInputs.at(-1)?.sessionFile).toBe(resumePath);
  expect(createInputs.at(-1)?.replacePersistedSessions).not.toBe(true);
  expect(createCount).toBe(1);
});

test("PiCodingAgentDriver injects eco-pi-approval and re-arms handler on session reuse", async () => {
  const registry = new PiSessionRegistry();
  const captured: Array<{ names: string[] }> = [];
  let createCount = 0;
  const handlers: Array<SdkToolPermissionHandler | undefined> = [];

  const makeHandle = (
    id: string,
    cwd: string,
    routeFingerprint: string,
    mcpFingerprint = "",
    sessionFile?: string,
  ): PiSessionHandle => ({
    sessionId: id,
    ...(sessionFile ? { sessionFile } : {}),
    cwd,
    routeFingerprint,
    bindingId: `bind_${id}`,
    skillsFingerprint: "",
    mcpFingerprint,
    abort: async () => {},
    dispose: () => {},
    rebind: async (input) => {
      void input;
    },
    updateSkillPaths: async () => {},
    async *prompt(text: string): AsyncIterable<AgentEvent> {
      yield {
        id: `${id}:msg`,
        threadId: "unused",
        agentId: id,
        role: "planner",
        type: "message.delta",
        payload: { type: "eco_stream", blockKind: "text", text: `echo:${text}` },
        createdAt: new Date().toISOString(),
      } as AgentEvent;
    },
  });

  const driver = new PiCodingAgentDriver(
    {
      createSession: async (input) => {
        createCount += 1;
        captured.push({
          names: (input.extensionFactories ?? []).map((e) => e.name),
        });
        const handle = makeHandle(
          `sess_${input.threadId}_${createCount}`,
          input.cwd,
          input.routeFingerprint,
          "",
          input.sessionFile ?? `/tmp/${input.threadId}_${createCount}.jsonl`,
        ) as PiSessionHandle & {
          toolApprovalEnabled?: boolean;
          armToolPermission?: (handler: SdkToolPermissionHandler | undefined) => void;
        };
        handle.toolApprovalEnabled = Boolean(
          (input as { toolPermissionHandler?: unknown }).toolPermissionHandler,
        );
        handle.armToolPermission = (handler) => {
          handlers.push(handler);
        };
        return handle;
      },
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: "http://127.0.0.1:18765",
        bridgeModelId: "alias",
        apiKey: "k",
        agentDir: "/tmp/pi",
        apiCompat: "anthropic",
        bindingId: "cbb_test",
        providerId: "p",
      }),
    },
    registry,
  );

  const routes = [
    {
      role: "planner" as const,
      providerId: "p",
      modelId: "m",
      primary: { modelId: "m", contextWindow: 100_000 },
    },
  ];

  const allow: SdkToolPermissionHandler = async () => ({ behavior: "allow" });
  const deny: SdkToolPermissionHandler = async () => ({
    behavior: "deny",
    message: "no",
  });

  for await (const _ of driver.run({
    threadId: "thr_perm",
    prompt: "hi",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: { toolPermissionHandler: allow },
  } as never)) {
    void _;
  }
  expect(createCount).toBe(1);
  expect(captured[0]?.names).toContain("eco-pi-approval");

  const reused = registry.get("thr_perm") as
    | (PiSessionHandle & {
        armToolPermission?: (handler: SdkToolPermissionHandler | undefined) => void;
      })
    | undefined;
  const previousArm = reused?.armToolPermission;
  if (reused) {
    reused.armToolPermission = (handler) => {
      handlers.push(handler);
      previousArm?.(handler);
    };
  }

  for await (const _ of driver.run({
    threadId: "thr_perm",
    prompt: "hi2",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: { toolPermissionHandler: deny },
  } as never)) {
    void _;
  }
  expect(createCount).toBe(1);
  expect(handlers.length).toBeGreaterThan(0);
  expect(handlers.at(-1)).toBe(deny);
});

test("PiCodingAgentDriver recreates session when tool approval presence drifts", async () => {
  const registry = new PiSessionRegistry();
  const captured: Array<{ names: string[] }> = [];
  let createCount = 0;

  const makeHandle = (
    id: string,
    cwd: string,
    routeFingerprint: string,
    mcpFingerprint = "",
    sessionFile?: string,
  ): PiSessionHandle => ({
    sessionId: id,
    ...(sessionFile ? { sessionFile } : {}),
    cwd,
    routeFingerprint,
    bindingId: `bind_${id}`,
    skillsFingerprint: "",
    mcpFingerprint,
    abort: async () => {},
    dispose: () => {},
    rebind: async (input) => {
      void input;
    },
    updateSkillPaths: async () => {},
    async *prompt(text: string): AsyncIterable<AgentEvent> {
      yield {
        id: `${id}:msg`,
        threadId: "unused",
        agentId: id,
        role: "planner",
        type: "message.delta",
        payload: { type: "eco_stream", blockKind: "text", text: `echo:${text}` },
        createdAt: new Date().toISOString(),
      } as AgentEvent;
    },
  });

  const driver = new PiCodingAgentDriver(
    {
      createSession: async (input) => {
        createCount += 1;
        captured.push({
          names: (input.extensionFactories ?? []).map((e) => e.name),
        });
        const handle = makeHandle(
          `sess_${input.threadId}_${createCount}`,
          input.cwd,
          input.routeFingerprint,
          "",
          input.sessionFile ?? `/tmp/${input.threadId}_${createCount}.jsonl`,
        ) as PiSessionHandle & { toolApprovalEnabled?: boolean };
        handle.toolApprovalEnabled = Boolean(
          (input as { toolPermissionHandler?: unknown }).toolPermissionHandler,
        );
        return handle;
      },
      resolveBridgeModel: async () => ({
        bridgeBaseUrl: "http://127.0.0.1:18765",
        bridgeModelId: "alias",
        apiKey: "k",
        agentDir: "/tmp/pi",
        apiCompat: "anthropic",
        bindingId: "cbb_test",
        providerId: "p",
      }),
    },
    registry,
  );

  const routes = [
    {
      role: "planner" as const,
      providerId: "p",
      modelId: "m",
      primary: { modelId: "m", contextWindow: 100_000 },
    },
  ];

  const allow: SdkToolPermissionHandler = async () => ({ behavior: "allow" });

  for await (const _ of driver.run({
    threadId: "thr_perm_drift",
    prompt: "hi",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
  })) {
    void _;
  }
  expect(createCount).toBe(1);
  expect(captured[0]?.names).not.toContain("eco-pi-approval");

  for await (const _ of driver.run({
    threadId: "thr_perm_drift",
    prompt: "hi2",
    workspacePath: "/w1",
    worktreePath: "/w1",
    routes,
    signal: new AbortController().signal,
    piSession: { toolPermissionHandler: allow },
  } as never)) {
    void _;
  }
  expect(createCount).toBe(2);
  expect(captured[1]?.names).toContain("eco-pi-approval");
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
