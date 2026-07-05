import { expect, test } from "bun:test";
import { SdkStreamActivityBridge } from "../src/main/sdk-stream-activity";

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
      message: "Tool: WebFetch · https://weather.example/guangzhou",
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

test("preserves Read line range in structured tool metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    tool?: {
      name: string;
      detail?: string;
      readTarget?: { filePath: string; offset?: number; limit?: number };
    };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "coder",
      payload: {
        type: "tool_use",
        tool_name: "Read",
        tool_use_id: "toolu_read_1",
        input: { file_path: "/repo/apps/desktop/src/renderer/ActivityLogView.tsx", offset: 120, limit: 40 },
      },
    },
    (_threadId, _type, _message, _role, _stream, _agentId, extras) => {
      emitted.push({ ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted[0]?.tool).toEqual({
    name: "Read",
    detail: "ActivityLogView.tsx:L120-159",
    toolUseId: "toolu_read_1",
    readTarget: {
      filePath: "/repo/apps/desktop/src/renderer/ActivityLogView.tsx",
      offset: 120,
      limit: 40,
    },
  });
});

test("preserves Bash description in structured tool metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ tool?: { name: string; detail?: string; description?: string } }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "Bash",
        tool_use_id: "toolu_bash_1",
        input: { command: "npm test", description: "Run unit tests" },
      },
    },
    (_threadId, _type, _message, _role, _stream, _agentId, extras) => {
      emitted.push({ ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted[0]?.tool).toEqual({
    name: "Bash",
    detail: "npm test",
    toolUseId: "toolu_bash_1",
    description: "Run unit tests",
  });
});

test("preserves full Bash command detail in structured metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const longCommand =
    "bun test apps/desktop/test/event-center.test.ts apps/desktop/test/event-center-http.test.ts --filter long";
  const emitted: Array<{ tool?: { name: string; detail?: string } }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "coder",
      payload: {
        type: "tool_use",
        tool_name: "Bash",
        tool_use_id: "toolu_bash_long",
        input: { command: longCommand },
      },
    },
    (_threadId, _type, _message, _role, _stream, _agentId, extras) => {
      emitted.push({ ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted[0]?.tool).toEqual({
    name: "Bash",
    detail: longCommand,
    toolUseId: "toolu_bash_long",
  });
});

test("emits permission denied tool failures with structured metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    role: string;
    agentId?: string;
    tool?: { name: string; detail?: string; toolUseId?: string; status?: string };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.failed",
      role: "planner",
      agentId: "agent_researcher",
      payload: {
        type: "tool_permission_denied",
        tool_name: "Bash",
        tool_use_id: "tool_denied",
        message: "Bash is disabled for this Eco agent.",
        actor: "eco_researcher",
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
    { activityAgentId: "agent_researcher" },
  );

  expect(emitted).toEqual([
    {
      type: "tool.failed",
      message: "Permission denied for Bash: Bash is disabled for this Eco agent.",
      role: "tool",
      agentId: "agent_researcher",
      tool: {
        name: "Bash",
        detail: "Bash is disabled for this Eco agent.",
        toolUseId: "tool_denied",
        status: "failed",
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

test("emits structured file change metadata for Edit tool started activity", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ tool?: { name: string; fileChange?: { path: string; additions: number } } }> =
    [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.started",
      role: "coder",
      payload: {
        type: "tool_use",
        tool_name: "Edit",
        tool_use_id: "toolu_edit_1",
        input: {
          file_path: "/repo/lib/widget.dart",
          old_string: "final old = true;",
          new_string: "final updated = false;",
        },
      },
    },
    (_threadId, _type, _message, _role, _stream, _agentId, extras) => {
      emitted.push({ ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted[0]?.tool).toMatchObject({
    name: "Edit",
    fileChange: {
      path: "/repo/lib/widget.dart",
      additions: 1,
      deletions: 1,
    },
  });
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

test("carries SDK stream block key through activity metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    stream: boolean;
    sdkStreamBlockKey?: string;
  }> = [];

  const emit = (
    _threadId: string,
    type: string,
    message: string,
    _role: string,
    stream: boolean,
    _agentId?: string,
    extras?: { metadata?: Record<string, unknown> },
  ) => {
    const sdkStreamBlockKey = extras?.metadata?.sdkStreamBlockKey;
    emitted.push({
      type,
      message,
      stream,
      ...(typeof sdkStreamBlockKey === "string" && { sdkStreamBlockKey }),
    });
  };

  bridge.handleEvent(
    "thr_1",
    {
      type: "message.delta",
      role: "planner",
      payload: {
        type: "eco_stream",
        blockKind: "text",
        streamPlaceholder: true,
        stream_block_key: "text:0",
      },
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
        text: "第一句正文。",
        streamFinalize: true,
        stream_block_key: "text:0",
      },
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
        streamPlaceholder: true,
        stream_block_key: "text:2",
      },
    },
    emit,
  );

  expect(emitted).toEqual([
    { type: "message.delta", message: "", stream: true, sdkStreamBlockKey: "text:0" },
    { type: "message.delta", message: "第一句正文。", stream: false, sdkStreamBlockKey: "text:0" },
    { type: "message.delta", message: "", stream: true, sdkStreamBlockKey: "text:2" },
  ]);
});
