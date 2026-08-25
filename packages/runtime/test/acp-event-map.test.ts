import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapAcpSessionUpdate, acpSubagentAgentId, isAcpSubagentAgentId } from "../src/acp-event-map.js";

const CTX = {
  threadId: "thr_1",
  agentId: "agent_cursor",
  sessionRunId: "run_1",
};

test("isAcpSubagentAgentId matches minted Cursor ACP nested agent ids", () => {
  expect(isAcpSubagentAgentId(acpSubagentAgentId("call_1"))).toBe(true);
  expect(isAcpSubagentAgentId("acp-sub:call_1")).toBe(true);
  expect(isAcpSubagentAgentId("coder_1")).toBe(false);
  expect(isAcpSubagentAgentId("")).toBe(false);
  expect(isAcpSubagentAgentId(undefined)).toBe(false);
});

/** Shapes locked from Cursor `agent acp` (2026.08.11-e8db854) sessionUpdate emitters. */
const FIXTURE_DIR = join(import.meta.dir, "fixtures");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
}

test("maps agent_message_chunk fixture to message.delta eco_stream", () => {
  const params = loadFixture("acp-session-update-agent-message.json");
  const events = mapAcpSessionUpdate(params, CTX);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("message.delta");
  expect(events[0]?.threadId).toBe(CTX.threadId);
  expect(events[0]?.agentId).toBe(CTX.agentId);
  expect(events[0]?.payload).toMatchObject({
    type: "eco_stream",
    text: "Hello from ACP",
    raw: params,
  });
});

test("maps tool_call pending fixture to Eco tool_use Read", () => {
  const params = loadFixture("acp-session-update-tool-call.json");
  const events = mapAcpSessionUpdate(params, CTX);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("tool.started");
  expect(events[0]?.payload).toMatchObject({
    type: "tool_use",
    tool_name: "Read",
    tool_use_id: "call_abc",
    input: { path: "/tmp/demo.txt" },
    raw: params,
  });
});

test("maps execute tool_call title (shell preview) to Bash, not the command text", () => {
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_sh",
      title: "`ls -la`",
      kind: "execute",
      status: "pending",
      rawInput: { command: "ls -la" },
    },
  };
  const [event] = mapAcpSessionUpdate(params, CTX);
  expect(event?.payload).toMatchObject({
    type: "tool_use",
    tool_name: "Bash",
    tool_use_id: "call_sh",
    input: { command: "ls -la" },
  });
});

test("maps ACP kind other/fetch titles to Eco tool_name (MCP-shaped calls)", () => {
  const other = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_mcp",
        title: "mcp__github__list_issues",
        kind: "other",
        status: "pending",
        rawInput: { owner: "acme" },
      },
    },
    CTX,
  )[0];
  expect(other?.payload).toMatchObject({
    type: "tool_use",
    tool_name: "mcp__github__list_issues",
    input: { owner: "acme" },
  });

  const fetchTool = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_fetch",
        title: "WebFetch",
        kind: "fetch",
        status: "pending",
        rawInput: { url: "https://example.com" },
      },
    },
    CTX,
  )[0];
  expect(fetchTool?.payload).toMatchObject({ type: "tool_use", tool_name: "WebFetch" });
});

test("maps search grep/Find titles to Grep and Glob", () => {
  const grep = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_grep",
        title: "grep",
        kind: "search",
        status: "pending",
        rawInput: {},
      },
    },
    CTX,
  )[0];
  expect(grep?.payload).toMatchObject({ type: "tool_use", tool_name: "Grep" });

  const find = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_find",
        title: "Find",
        kind: "search",
        status: "pending",
        rawInput: {},
      },
    },
    CTX,
  )[0];
  expect(find?.payload).toMatchObject({ type: "tool_use", tool_name: "Glob" });
});

test("maps Read File locations into file_path when rawInput is empty", () => {
  const [event] = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_read",
        title: "Read File",
        kind: "read",
        status: "pending",
        rawInput: {},
        locations: [{ path: "/tmp/demo.txt" }],
      },
    },
    CTX,
  );
  expect(event?.payload).toMatchObject({
    type: "tool_use",
    tool_name: "Read",
    input: { file_path: "/tmp/demo.txt", path: "/tmp/demo.txt" },
  });
});

test("skips in_progress tool_call_update; completed uses cached Eco tool_name", () => {
  const tools = new Map<string, { tool_name: string; input: Record<string, unknown> }>();
  const ctx = { ...CTX, tools };
  mapAcpSessionUpdate(
    {
      sessionId: "sess_fixture_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_abc",
        title: "Read File",
        kind: "read",
        status: "pending",
        rawInput: { path: "/tmp/demo.txt" },
      },
    },
    ctx,
  );
  expect(
    mapAcpSessionUpdate(
      {
        sessionId: "sess_fixture_1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call_abc",
          status: "in_progress",
        },
      },
      ctx,
    ),
  ).toEqual([]);

  const params = {
    sessionId: "sess_fixture_1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_abc",
      status: "completed",
      rawOutput: { ok: true },
    },
  };
  const events = mapAcpSessionUpdate(params, ctx);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("tool.completed");
  expect(events[0]?.payload).toMatchObject({
    type: "tool_result",
    tool_name: "Read",
    tool_use_id: "call_abc",
    input: { path: "/tmp/demo.txt" },
    content: { ok: true },
    raw: params,
  });
});

test("maps agent_thought_chunk to message.delta thinking", () => {
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "reasoning…" },
    },
  };
  const [event] = mapAcpSessionUpdate(params, CTX);
  expect(event?.type).toBe("message.delta");
  expect(event?.payload).toMatchObject({
    type: "eco_stream",
    blockKind: "thinking",
    text: "reasoning…",
    raw: params,
  });
  expect(event?.payload).not.toHaveProperty("messageId");
});

test("forwards ACP messageId on thought and message chunks", () => {
  const thought = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        messageId: "msg_thought_1",
        content: { type: "text", text: "Thinking " },
      },
    },
    CTX,
  );
  expect(thought[0]?.payload).toMatchObject({
    type: "eco_stream",
    blockKind: "thinking",
    text: "Thinking ",
    messageId: "msg_thought_1",
  });

  const message = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId: "msg_agent_1",
        content: { type: "text", text: "Answer" },
      },
    },
    CTX,
  );
  expect(message[0]?.payload).toMatchObject({
    type: "eco_stream",
    text: "Answer",
    messageId: "msg_agent_1",
  });
});

test("maps prompt stopReason to run.terminal (Cursor emits on session/prompt result, not session/update)", () => {
  expect(mapAcpSessionUpdate({ stopReason: "end_turn" }, CTX)[0]?.payload).toEqual({
    status: "completed",
  });
  expect(mapAcpSessionUpdate({ stopReason: "cancelled" }, CTX)[0]?.type).toBe("run.terminal");
  expect(mapAcpSessionUpdate({ stopReason: "cancelled" }, CTX)[0]?.payload).toEqual({
    status: "cancelled",
    reason: "cancelled",
  });
  expect(mapAcpSessionUpdate({ stopReason: "refusal", error: "nope" }, CTX)[0]?.payload).toEqual({
    status: "failed",
    error: "nope",
    unstarted: true,
  });
});

test("end_turn with only RetriableError agent text becomes run.terminal failed", () => {
  const ctx = {
    ...CTX,
    agentMessageText: { value: "" },
    turnProgress: { tools: false, thoughts: false },
  };
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Error: RetriableError: [resource_exhausted] Error" },
      },
    },
    ctx,
  );
  const terminal = mapAcpSessionUpdate({ stopReason: "end_turn" }, ctx)[0];
  expect(terminal?.type).toBe("run.terminal");
  expect(terminal?.payload).toEqual({
    status: "failed",
    error: "Error: RetriableError: [resource_exhausted] Error",
    unstarted: true,
  });
  expect(ctx.agentMessageText.value).toBe("");
});

test("end_turn trailing exhaustion after real body is a started failure", () => {
  const ctx = {
    ...CTX,
    agentMessageText: { value: "" },
    turnProgress: { tools: false, thoughts: false },
  };
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "I'll inspect the login page.\n\n" },
      },
    },
    ctx,
  );
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Error: T: [resource_exhausted] Error" },
      },
    },
    ctx,
  );
  expect(mapAcpSessionUpdate({ stopReason: "end_turn" }, ctx)[0]?.payload).toEqual({
    status: "failed",
    error: "Error: T: [resource_exhausted] Error",
  });
});

test("end_turn RetriableError after thinking is a started failure", () => {
  const ctx = {
    ...CTX,
    agentMessageText: { value: "" },
    turnProgress: { tools: false, thoughts: false },
  };
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Need to read the file first." },
      },
    },
    ctx,
  );
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Error: RetriableError: [resource_exhausted] Error" },
      },
    },
    ctx,
  );
  expect(mapAcpSessionUpdate({ stopReason: "end_turn" }, ctx)[0]?.payload).toEqual({
    status: "failed",
    error: "Error: RetriableError: [resource_exhausted] Error",
  });
});

test("end_turn RetriableError after a tool call is a started failure", () => {
  const ctx = {
    ...CTX,
    tools: new Map(),
    agentMessageText: { value: "" },
    turnProgress: { tools: false, thoughts: false },
  };
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Read src/a.ts",
      },
    },
    ctx,
  );
  mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Error: RetriableError: [resource_exhausted] Error" },
      },
    },
    ctx,
  );
  expect(mapAcpSessionUpdate({ stopReason: "end_turn" }, ctx)[0]?.payload).toEqual({
    status: "failed",
    error: "Error: RetriableError: [resource_exhausted] Error",
  });
});

test("user_message_chunk is ignored because Eco already recorded the user prompt", () => {
  const events = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "What's the capital of France?" },
      },
    },
    CTX,
  );
  expect(events).toEqual([]);
});

test("available_commands_update is ignored so it does not pollute the feed", () => {
  expect(
    mapAcpSessionUpdate(
      {
        sessionId: "sess_1",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "copy-request-id" }],
        },
      },
      CTX,
    ),
  ).toEqual([]);
});

test("maps session_info_update title to session.title", () => {
  const [event] = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "session_info_update",
        title: "  Investigate order export  ",
      },
    },
    CTX,
  );
  expect(event?.type).toBe("session.title");
  expect(event?.payload).toEqual({ title: "Investigate order export" });
});

test("session_info_update without a title is ignored", () => {
  expect(
    mapAcpSessionUpdate(
      {
        sessionId: "sess_1",
        update: { sessionUpdate: "session_info_update", title: null },
      },
      CTX,
    ),
  ).toEqual([]);
});

test("maps current_mode_update to structured terminal.output", () => {
  const [event] = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
    },
    CTX,
  );
  expect(event?.type).toBe("terminal.output");
  expect(event?.payload).toMatchObject({
    source: "acp",
    liveType: "acp.current_mode_update",
    currentModeId: "plan",
  });
});

test("maps plan sessionUpdate to todo.updated", () => {
  const [event] = mapAcpSessionUpdate(
    {
      sessionId: "sess_1",
      update: {
        sessionUpdate: "plan",
        entries: [{ content: "Ship it", priority: "high", status: "pending" }],
      },
    },
    CTX,
  );
  expect(event?.type).toBe("todo.updated");
  expect(event?.payload).toMatchObject({
    source: "acp",
    liveType: "acp.plan",
    entries: [{ content: "Ship it", priority: "high", status: "pending" }],
  });
});

test("unknown sessionUpdate becomes terminal.output tagged with the kind name", () => {
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "config_option_update",
      configOptions: [],
    },
  };
  const [event] = mapAcpSessionUpdate(params, CTX);
  expect(event?.type).toBe("terminal.output");
  expect(event?.payload).toEqual({
    source: "acp",
    liveType: "acp.unhandled_session_update.config_option_update",
    raw: params,
  });
});

test("non-object params become terminal.output with raw", () => {
  const [event] = mapAcpSessionUpdate("not-json-rpc", CTX);
  expect(event?.type).toBe("terminal.output");
  expect(event?.payload).toEqual({ source: "acp", raw: "not-json-rpc" });
});

test("maps Agent tool_call to tool.started + agent.started for Cards", () => {
  const tools = new Map<string, { tool_name: string; input: Record<string, unknown> }>();
  const ctx: Parameters<typeof mapAcpSessionUpdate>[1] = { ...CTX, tools };
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "call_agent_1",
      title: "Agent",
      kind: "other",
      status: "pending",
      rawInput: { prompt: "Investigate the login bug" },
    },
  };
  const events = mapAcpSessionUpdate(params, ctx);
  expect(events.map((e) => e.type)).toEqual(["tool.started", "agent.started"]);
  expect(events[0]?.payload).toMatchObject({
    type: "tool_use",
    tool_name: "Agent",
    tool_use_id: "call_agent_1",
    subagent_type: "Agent",
    prompt: "Investigate the login bug",
  });
  expect(events[1]).toMatchObject({
    type: "agent.started",
    agentId: "acp-sub:call_agent_1",
    role: "general-purpose",
    payload: {
      source: "acp",
      parentToolUseId: "call_agent_1",
      subagent_type: "Agent",
      prompt: "Investigate the login bug",
    },
  });
  expect(ctx.openSubagents?.get("call_agent_1")).toMatchObject({
    toolCallId: "call_agent_1",
    agentId: "acp-sub:call_agent_1",
  });
});

test("streams subagent in-progress output on the synthetic subagent agentId", () => {
  const tools = new Map<string, { tool_name: string; input: Record<string, unknown> }>();
  const openSubagents = new Map<
    string,
    { toolCallId: string; agentId: string; subagentType: string; task: string }
  >([
    [
      "call_agent_1",
      {
        toolCallId: "call_agent_1",
        agentId: "acp-sub:call_agent_1",
        subagentType: "Agent",
        task: "fix bug",
      },
    ],
  ]);
  const ctx: Parameters<typeof mapAcpSessionUpdate>[1] = { ...CTX, tools, openSubagents };
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_agent_1",
      status: "in_progress",
      content: { type: "text", text: "Reading login.ts…" },
    },
  };
  const [event] = mapAcpSessionUpdate(params, ctx);
  expect(event?.type).toBe("message.delta");
  expect(event?.agentId).toBe("acp-sub:call_agent_1");
  expect(event?.payload).toMatchObject({
    type: "eco_stream",
    blockKind: "subagent_output",
    text: "Reading login.ts…",
    liveType: "acp.subagent_output",
    parent_tool_use_id: "call_agent_1",
  });
});

test("subagent tool.completed closes open subagent and emits agent.completed with output", () => {
  const tools = new Map<string, { tool_name: string; input: Record<string, unknown> }>([
    ["call_agent_1", { tool_name: "Agent", input: { prompt: "fix bug" } }],
  ]);
  const openSubagents = new Map<
    string,
    { toolCallId: string; agentId: string; subagentType: string; task: string }
  >([
    [
      "call_agent_1",
      {
        toolCallId: "call_agent_1",
        agentId: "acp-sub:call_agent_1",
        subagentType: "Agent",
        task: "fix bug",
      },
    ],
  ]);
  const ctx: Parameters<typeof mapAcpSessionUpdate>[1] = { ...CTX, tools, openSubagents };
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_agent_1",
      status: "completed",
      content: { type: "text", text: "Fixed the login bug." },
    },
  };
  const events = mapAcpSessionUpdate(params, ctx);
  expect(events.map((e) => e.type)).toEqual(["tool.completed", "message.delta", "agent.completed"]);
  expect(events[0]?.payload).toMatchObject({
    type: "tool_result",
    tool_name: "Agent",
    tool_use_id: "call_agent_1",
    subagent_output: "Fixed the login bug.",
  });
  expect(events[1]).toMatchObject({
    type: "message.delta",
    agentId: "acp-sub:call_agent_1",
    payload: {
      text: "Fixed the login bug.",
      blockKind: "subagent_output",
      parent_tool_use_id: "call_agent_1",
    },
  });
  expect(events[2]).toMatchObject({
    type: "agent.completed",
    agentId: "acp-sub:call_agent_1",
    payload: { source: "acp", parentToolUseId: "call_agent_1" },
  });
  expect(ctx.openSubagents?.has("call_agent_1")).toBe(false);
});

test("in_progress update on a non-subagent tool is still ignored", () => {
  const tools = new Map<string, { tool_name: string; input: Record<string, unknown> }>([
    ["call_read_1", { tool_name: "Read", input: { path: "/tmp/x.txt" } }],
  ]);
  const ctx: Parameters<typeof mapAcpSessionUpdate>[1] = { ...CTX, tools };
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_read_1",
      status: "in_progress",
      content: { type: "text", text: "partial" },
    },
  };
  expect(mapAcpSessionUpdate(params, ctx)).toEqual([]);
});
