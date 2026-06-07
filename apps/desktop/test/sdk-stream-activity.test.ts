import { expect, test } from "bun:test";
import { SdkStreamActivityBridge } from "../src/main/sdk-stream-activity";

test("suppresses redundant OTel tool line after SDK tool start", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.noteSdkToolActivity("thr_1", {
    type: "tool_use",
    tool_name: "Read",
    streaming: true,
  });
  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Read")).toBe(true);
  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Read · styles.css")).toBe(false);
});

test("suppresses OTel duration summaries after detailed SDK subagent tool start", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "explore",
      agentId: "agent_weather",
      payload: {
        type: "tool_use",
        tool_name: "WebSearch",
        input: { query: "广州天气" },
      },
    },
    () => {},
    undefined,
    { activityAgentId: "agent_weather" },
  );

  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: WebSearch (5.9s)")).toBe(true);
});

test("suppresses OTel tool summaries by structured tool metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "explore",
      agentId: "agent_weather",
      payload: {
        type: "tool_use",
        tool_name: "WebFetch",
        tool_use_id: "toolu_fetch_1",
        input: { url: "https://weather.example/guangzhou" },
      },
    },
    () => {},
    undefined,
    { activityAgentId: "agent_weather" },
  );

  expect(
    bridge.shouldSuppressOtelToolLine("thr_1", {
      message: "Tool: WebFetch · https://weather.example/guangzhou (8.3s)",
      role: "planner",
      toolName: "WebFetch",
      toolDetail: "https://weather.example/guangzhou",
      toolUseId: "toolu_fetch_1",
      durationMs: 8300,
    }),
  ).toBe(true);
});

test("emits structured SDK tool metadata with tool started activity", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    role: string;
    agentId?: string;
    tool?: { name: string; detail?: string; toolUseId?: string };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "explore",
      agentId: "agent_weather",
      payload: {
        type: "tool_use",
        tool_name: "WebFetch",
        tool_use_id: "toolu_fetch_1",
        input: { url: "https://weather.example/guangzhou" },
      },
    },
    (_threadId, type, message, role, _stream, agentId, extras) => {
      emitted.push({
        type,
        message,
        role,
        ...(agentId && { agentId }),
        ...(extras?.tool && { tool: extras.tool }),
      });
    },
    undefined,
    { activityAgentId: "agent_weather" },
  );

  expect(emitted).toEqual([
    {
      type: "tool.started",
      message: "Tool: WebFetch",
      role: "explore",
      agentId: "agent_weather",
      tool: {
        name: "WebFetch",
        detail: "https://weather.example/guangzhou",
        toolUseId: "toolu_fetch_1",
      },
    },
  ]);
});

test("defers streaming tool placeholder until input is complete", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ message: string; tool?: { name: string; detail?: string } }> = [];
  const emit = (
    _threadId: string,
    _type: string,
    message: string,
    _role: string,
    _stream: boolean,
    _agentId?: string,
    extras?: { tool?: { name: string; detail?: string } },
  ) => {
    emitted.push({
      message,
      ...(extras?.tool && { tool: extras.tool }),
    });
  };

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "mcp__eco_plan__finalize_plan",
        tool_use_id: "toolu_plan",
        streaming: true,
      },
    },
    emit,
  );
  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "mcp__eco_plan__finalize_plan",
        tool_use_id: "toolu_plan",
        input: { analysis: "done", plan: "ship it" },
        streaming: true,
        input_complete: true,
      },
    },
    emit,
  );

  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.message).toBe("Tool: mcp__eco_plan__finalize_plan");
  expect(emitted[0]?.tool?.name).toBe("mcp__eco_plan__finalize_plan");
});

test("suppresses MCP OTel wrapper after concrete SDK MCP tool", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "mcp__eco_plan__finalize_plan",
        tool_use_id: "toolu_plan",
        input: { analysis: "done", plan: "ship it" },
      },
    },
    () => {},
  );

  expect(
    bridge.shouldSuppressOtelToolLine("thr_1", {
      message: "Tool: mcp_tool · mcp__eco_plan__finalize_plan (0.0s)",
      role: "planner",
      toolName: "mcp_tool",
      toolDetail: "mcp__eco_plan__finalize_plan",
      toolUseId: "toolu_plan",
      durationMs: 0,
    }),
  ).toBe(true);
});

test("emits structured SDK tool metadata without parsing display text", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    role: string;
    tool?: { name: string; detail?: string };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Skill",
        input: { skill_name: "pdf" },
      },
    },
    (_threadId, type, message, role, _stream, _agentId, extras) => {
      emitted.push({
        type,
        message,
        role,
        ...(extras?.tool && { tool: extras.tool }),
      });
    },
  );

  expect(emitted).toEqual([
    {
      type: "tool.started",
      message: "Tool: Skill · pdf 技能",
      role: "tool",
      tool: {
        name: "Skill",
        detail: "pdf 技能",
      },
    },
  ]);
});

test("emits Skill detail for alternate SDK skill input keys", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    message: string;
    tool?: { name: string; detail?: string };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Skill",
        input: { skill: "frontend-design" },
      },
    },
    (_threadId, _type, message, _role, _stream, _agentId, extras) => {
      emitted.push({
        message,
        ...(extras?.tool && { tool: extras.tool }),
      });
    },
  );

  expect(emitted).toEqual([
    {
      message: "Tool: Skill · frontend-design 技能",
      tool: {
        name: "Skill",
        detail: "frontend-design 技能",
      },
    },
  ]);
});

test("emits structured SDK tool metadata for tool progress activity", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    role: string;
    tool?: { name: string; toolUseId?: string; durationMs?: number };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "explore",
      agentId: "agent_weather",
      payload: {
        type: "tool_progress",
        tool_name: "WebFetch",
        tool_use_id: "toolu_fetch_1",
        elapsed_time_seconds: 8.3,
      },
    },
    (_threadId, type, message, role, _stream, _agentId, extras) => {
      emitted.push({
        type,
        message,
        role,
        ...(extras?.tool && { tool: extras.tool }),
      });
    },
    undefined,
    { activityAgentId: "agent_weather" },
  );

  expect(emitted).toEqual([
    {
      type: "tool.started",
      message: "Tool: WebFetch (8.3s)",
      role: "tool",
      tool: {
        name: "WebFetch",
        toolUseId: "toolu_fetch_1",
        durationMs: 8300,
      },
    },
  ]);
});

test("emits structured SDK tool metadata for task progress activity", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    role: string;
    tool?: { name: string; detail?: string };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "todo.updated",
      role: "explore",
      agentId: "agent_weather",
      payload: {
        sdkKind: "task_progress",
        task_id: "task_weather",
        subagent_type: "eco_explore",
        last_tool_name: "WebFetch",
        description: "https://weather.example/guangzhou",
      },
    },
    (_threadId, type, message, role, _stream, _agentId, extras) => {
      emitted.push({
        type,
        message,
        role,
        ...(extras?.tool && { tool: extras.tool }),
      });
    },
    undefined,
    { activityAgentId: "agent_weather" },
  );

  expect(emitted).toEqual([
    {
      type: "todo.updated",
      message: "Tool: WebFetch · https://weather.example/guangzhou",
      role: "explore",
      tool: {
        name: "WebFetch",
        detail: "https://weather.example/guangzhou",
      },
    },
  ]);
});

test("suppresses OTel Agent elapsed summaries after SDK subagent delegation", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Agent",
        input: {
          subagent_type: "eco_explore",
          description: "查询广州天气",
        },
      },
    },
    () => {},
  );

  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Agent · eco_explore (29.6s)")).toBe(true);
});

test("suppresses OTel Agent elapsed summaries when SDK metadata includes prompt detail", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Agent",
        input: {
          subagent_type: "eco_explore",
          prompt: "查询广州今天的天气并返回来源",
        },
      },
    },
    () => {},
  );

  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Agent · 探索 (29.6s)")).toBe(true);
});

test("keeps parallel subagent narrative streams isolated by agentId", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ message: string; role: string; agentId?: string }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "message.delta",
      role: "coder",
      agentId: "agent_a",
      payload: { type: "eco_stream", blockKind: "text", text: "alpha", streamPlaceholder: true },
    },
    (_threadId, _type, message, role, stream, agentId) => {
      emitted.push({ message, role, ...(agentId && { agentId }) });
      expect(stream).toBe(true);
    },
    undefined,
    { activityAgentId: "agent_a" },
  );

  bridge.handleEvent(
    "thr_1",
    {
      type: "message.delta",
      role: "coder",
      agentId: "agent_b",
      payload: { type: "eco_stream", blockKind: "text", text: "beta", streamPlaceholder: true },
    },
    (_threadId, _type, message, role, stream, agentId) => {
      emitted.push({ message, role, ...(agentId && { agentId }) });
      expect(stream).toBe(true);
    },
    undefined,
    { activityAgentId: "agent_b" },
  );

  expect(emitted).toEqual([
    { message: "", role: "coder", agentId: "agent_a" },
    { message: "", role: "coder", agentId: "agent_b" },
  ]);
});

test("emits Requesting model status as request started activity", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; role: string }> = [];
  bridge.handleEvent(
    "thr_1",
    {
      type: "agent.started",
      role: "planner",
      payload: { type: "system", subtype: "status", status: "requesting" },
    },
    (_threadId, _type, message, role) => {
      emitted.push({ type: _type, message, role });
    },
  );
  expect(emitted).toEqual([{ type: "request.started", message: "Requesting model…", role: "planner" }]);
});

test("emits SDK api retry status as request retry activity", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; role: string }> = [];
  bridge.handleEvent(
    "thr_1",
    {
      type: "agent.started",
      role: "planner",
      payload: { type: "system", subtype: "api_retry", attempt: 2, max_retries: 5 },
    },
    (_threadId, type, message, role) => {
      emitted.push({ type, message, role });
    },
  );
  expect(emitted).toEqual([{ type: "request.retry_scheduled", message: "API retry 2/5…", role: "planner" }]);
});

test("emits finalize text when only an empty placeholder preceded it", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; role: string; stream: boolean }> = [];

  const emit = (_threadId: string, type: string, message: string, role: string, stream: boolean) => {
    emitted.push({ type, message, role, stream });
  };

  bridge.handleEvent(
    "thr_1",
    {
      type: "message.delta",
      role: "planner",
      payload: { type: "eco_stream", blockKind: "text", streamPlaceholder: true },
    },
    emit,
  );
  bridge.handleEvent(
    "thr_1",
    {
      type: "message.delta",
      role: "planner",
      payload: {
        type: "eco_stream",
        blockKind: "text",
        text: "广州今天中雨，25-31C。",
        streamFinalize: true,
      },
    },
    emit,
  );

  expect(emitted).toEqual([
    { type: "message.delta", message: "", role: "planner", stream: true },
    { type: "message.delta", message: "广州今天中雨，25-31C。", role: "planner", stream: false },
  ]);
});

test("allows OTel tool line with detail when SDK only showed name", () => {
  const bridge = new SdkStreamActivityBridge();
  bridge.noteSdkToolActivity("thr_1", {
    type: "tool_use",
    tool_name: "Grep",
    tool_use_id: "toolu_1",
  });
  expect(bridge.shouldSuppressOtelToolLine("thr_1", "Tool: Grep · pattern")).toBe(false);
});
