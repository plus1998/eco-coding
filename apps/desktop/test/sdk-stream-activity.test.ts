import { expect, test } from "bun:test";
import { SdkStreamActivityBridge } from "../src/main/sdk-stream-activity";

test("emits every SDK text update locally while throttling the remote stream", async () => {
  const bridge = new SdkStreamActivityBridge();
  const remote: string[] = [];
  const local: string[] = [];
  const emit = (_threadId: string, _type: string, message: string, _role: string, stream: boolean) => {
    if (stream && message) {
      remote.push(message);
    }
  };

  bridge.handleEvent(
    "thr_continuous_stream",
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
    undefined,
    {
      onLocalStreamUpdate(update) {
        if (update.stream && update.message) {
          local.push(update.message);
        }
      },
    },
  );

  for (const text of ["逐", "字", "输", "出", "正", "常"]) {
    bridge.handleEvent(
      "thr_continuous_stream",
      {
        type: "message.delta",
        role: "planner",
        payload: {
          type: "eco_stream",
          blockKind: "text",
          text,
          streaming: true,
          stream_block_key: "text:0",
        },
      },
      emit,
      undefined,
      {
        onLocalStreamUpdate(update) {
          if (update.stream && update.message) {
            local.push(update.message);
          }
        },
      },
    );
  }

  expect(local).toEqual(["逐", "逐字", "逐字输", "逐字输出", "逐字输出正", "逐字输出正常"]);
  expect(remote).toEqual([]);

  await Bun.sleep(60);
  expect(remote).toEqual(["逐字输出正常"]);
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

test("preserves useful TaskCreate and TaskUpdate input in tool metadata", () => {
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
  ) => emitted.push({ message, ...(extras?.tool && { tool: extras.tool }) });

  bridge.handleEvent(
    "thr_tasks",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "TaskCreate",
        tool_use_id: "task_create",
        input_complete: true,
        input: { subject: "补充流事件测试" },
      },
    },
    emit,
  );
  bridge.handleEvent(
    "thr_tasks",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "TaskUpdate",
        tool_use_id: "task_update",
        input_complete: true,
        input: { taskId: "3", status: "in_progress" },
      },
    },
    emit,
  );

  expect(emitted).toEqual([
    {
      message: "Tool: TaskCreate · 补充流事件测试",
      tool: { name: "TaskCreate", detail: "补充流事件测试", toolUseId: "task_create" },
    },
    {
      message: "Tool: TaskUpdate · #3 · 进行中",
      tool: { name: "TaskUpdate", detail: "#3 · 进行中", toolUseId: "task_update" },
    },
  ]);
});

test("perserves SendMessage resume payload in structured tool metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    tool?: {
      name: string;
      detail?: string;
      outputPreview?: string;
      sendMessage?: {
        recipient?: string;
        summary?: string;
        message?: string;
        success?: boolean;
        resultMessage?: string;
        resumedAgentId?: string;
      };
    };
  }> = [];
  const emit = (
    _threadId: string,
    type: string,
    message: string,
    _role: string,
    _stream: boolean,
    _agentId?: string,
    extras?: { tool?: NonNullable<(typeof emitted)[number]["tool"]> & { name: string } },
  ) => emitted.push({ type, message, ...(extras?.tool && { tool: extras.tool }) });

  bridge.handleEvent(
    "thr_send_message",
    {
      type: "tool.started",
      role: "planner",
      payload: {
        type: "tool_use",
        tool_name: "SendMessage",
        tool_use_id: "call_j2MzFPzR3u69seK4QBDbAOaS",
        input: {
          to: "a897f866adcc1af29",
          summary: "继续实现 App 权限与测试",
          message: "请继续完成剩余实现，不要等待确认。",
        },
      },
    },
    emit,
  );
  bridge.handleEvent(
    "thr_send_message",
    {
      type: "tool.completed",
      role: "planner",
      payload: {
        type: "tool_result",
        tool_name: "SendMessage",
        tool_use_id: "call_j2MzFPzR3u69seK4QBDbAOaS",
        input: {
          to: "a897f866adcc1af29",
          summary: "继续实现 App 权限与测试",
          message: "请继续完成剩余实现，不要等待确认。",
        },
        output: JSON.stringify({
          success: true,
          message:
            'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background with your message.',
          resumedAgentId: "a897f866adcc1af29",
        }),
      },
    },
    emit,
  );

  expect(emitted).toEqual([
    {
      type: "tool.started",
      message: "Tool: SendMessage · → a897f866… · 继续实现 App 权限与测试",
      tool: {
        name: "SendMessage",
        detail: "→ a897f866… · 继续实现 App 权限与测试",
        toolUseId: "call_j2MzFPzR3u69seK4QBDbAOaS",
        sendMessage: {
          recipient: "a897f866adcc1af29",
          summary: "继续实现 App 权限与测试",
          message: "请继续完成剩余实现，不要等待确认。",
        },
      },
    },
    {
      type: "tool.completed",
      message: "Tool: SendMessage · → a897f866… · 继续实现 App 权限与测试",
      tool: {
        name: "SendMessage",
        detail:
          'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background with your message.',
        outputPreview:
          'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background with your message.',
        toolUseId: "call_j2MzFPzR3u69seK4QBDbAOaS",
        sendMessage: {
          recipient: "a897f866adcc1af29",
          summary: "继续实现 App 权限与测试",
          message: "请继续完成剩余实现，不要等待确认。",
          success: true,
          resultMessage:
            'Agent "a897f866adcc1af29" had no active task; resumed from transcript in the background with your message.',
          resumedAgentId: "a897f866adcc1af29",
        },
        status: "completed",
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

test("emits cancelled tool_result_error as system cancel metadata, not a user denial", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{
    type: string;
    message: string;
    tool?: {
      name: string;
      detail?: string;
      nonExecutionKind?: string;
      status?: string;
    };
  }> = [];

  bridge.handleEvent(
    "thr_1",
    {
      type: "tool.failed",
      role: "explore",
      payload: {
        type: "tool_result_error",
        tool_name: "Read",
        tool_use_id: "tool_cancelled",
        non_execution_kind: "cancelled",
        message: "The user doesn't want to take this action right now. STOP...",
      },
    },
    (_threadId, type, message, _role, _stream, _agentId, extras) => {
      emitted.push({
        type,
        message,
        ...(extras?.tool && { tool: extras.tool }),
      });
    },
  );

  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.type).toBe("tool.failed");
  expect(emitted[0]?.message).toContain("Tool cancelled");
  expect(emitted[0]?.tool).toMatchObject({
    name: "Read",
    nonExecutionKind: "cancelled",
    status: "failed",
  });
  expect(emitted[0]?.tool?.detail).toContain("not a user denial");
});

test("emits completed Read results without file contents", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; tool?: Record<string, unknown> }> = [];

  bridge.handleEvent(
    "thr_read",
    {
      type: "tool.completed",
      role: "planner",
      payload: {
        type: "tool_result",
        tool_name: "Read",
        tool_use_id: "call_read",
        input: { file_path: "/repo/panel.ts", offset: 10, limit: 20 },
        output: "10\tconst value = true;",
      },
    },
    (_threadId, type, message, _role, _stream, _agentId, extras) => {
      emitted.push({ type, message, ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toMatchObject({
    type: "tool.completed",
    message: "Tool: Read · panel.ts:L10-29",
    tool: {
      name: "Read",
      detail: "panel.ts:L10-29",
      toolUseId: "call_read",
      status: "completed",
      readTarget: { filePath: "/repo/panel.ts", offset: 10, limit: 20 },
    },
  });
});

test("emits completed Bash results as a bounded display preview", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; tool?: Record<string, unknown> }> = [];

  bridge.handleEvent(
    "thr_bash",
    {
      type: "tool.completed",
      role: "planner",
      payload: {
        type: "tool_result",
        tool_name: "Bash",
        tool_use_id: "call_bash",
        input: { command: "bun test" },
        output: `head\n${"x".repeat(20_000)}\ntail`,
      },
    },
    (_threadId, type, _message, _role, _stream, _agentId, extras) => {
      emitted.push({ type, ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  const tool = emitted[0]?.tool;
  expect(tool?.outputPreviewTruncated).toBe(true);
  expect(String(tool?.outputPreview)).toStartWith("head\n");
  expect(String(tool?.outputPreview)).toEndWith("\ntail");
  expect(String(tool?.outputPreview).length).toBeLessThanOrEqual(8_000);
  expect(tool).not.toHaveProperty("output");
});

test("emits failed Bash results as a bounded display preview", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; tool?: Record<string, unknown> }> = [];

  bridge.handleEvent(
    "thr_bash_failed",
    {
      type: "tool.failed",
      role: "planner",
      payload: {
        type: "tool_result_error",
        tool_name: "Bash",
        tool_use_id: "call_bash_failed",
        message: `failure head\n${"x".repeat(20_000)}\nfailure tail`,
      },
    },
    (_threadId, type, message, _role, _stream, _agentId, extras) => {
      emitted.push({ type, message, ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted).toHaveLength(1);
  const tool = emitted[0]?.tool;
  expect(tool?.outputPreviewTruncated).toBe(true);
  expect(String(tool?.outputPreview)).toStartWith("failure head\n");
  expect(String(tool?.outputPreview)).toEndWith("\nfailure tail");
  expect(String(tool?.outputPreview).length).toBeLessThanOrEqual(8_000);
  expect(tool).not.toHaveProperty("output");
});

test("treats PI tool_result is_error payloads as failed tool metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; tool?: Record<string, unknown> }> = [];

  bridge.handleEvent(
    "thr_pi_edit",
    {
      type: "tool.failed",
      role: "planner",
      payload: {
        type: "tool_result",
        tool_name: "edit",
        tool_use_id: "tc_edit",
        content: "Found 2 occurrences of the text",
        is_error: true,
      },
    },
    (_threadId, type, message, _role, _stream, _agentId, extras) => {
      emitted.push({ type, message, ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toMatchObject({
    type: "tool.failed",
    message: "Tool failed: edit: Found 2 occurrences of the text",
    tool: {
      name: "edit",
      toolUseId: "tc_edit",
      status: "failed",
    },
  });
});

test("emits failed Edit results with the original file change metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; tool?: Record<string, unknown> }> = [];

  bridge.handleEvent(
    "thr_edit",
    {
      type: "tool.failed",
      role: "planner",
      payload: {
        type: "tool_result_error",
        tool_name: "Edit",
        tool_use_id: "call_edit",
        input: {
          file_path: "panel.ts",
          old_string: "\tline",
          new_string: "  line",
        },
        message: "String to replace not found in file.",
      },
    },
    (_threadId, type, message, _role, _stream, _agentId, extras) => {
      emitted.push({ type, message, ...(extras?.tool && { tool: extras.tool }) });
    },
  );

  expect(emitted).toHaveLength(1);
  expect(emitted[0]).toMatchObject({
    type: "tool.failed",
    message: "Tool failed: Edit: String to replace not found in file.",
    tool: {
      name: "Edit",
      toolUseId: "call_edit",
      status: "failed",
      fileChange: { path: "panel.ts" },
    },
  });
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
  const emitted: Array<{ tool?: { name: string; fileChange?: { path: string; additions: number } } }> = [];

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

test("persists exact SDK message id in activity metadata", () => {
  const bridge = new SdkStreamActivityBridge();
  const metadata: Record<string, unknown>[] = [];

  bridge.handleEvent(
    "thr_message_id",
    {
      type: "message.delta",
      role: "general-purpose",
      agentId: "agent_general_message",
      payload: {
        type: "eco_stream",
        blockKind: "text",
        text: "done",
        streamFinalize: true,
        stream_block_key: "text:0",
        messageId: "msg_feed_exact",
      },
    },
    (_threadId, _type, _message, _role, _stream, _agentId, extras) => {
      metadata.push(extras?.metadata ?? {});
    },
    undefined,
    { activityAgentId: "agent_general_message" },
  );

  expect(metadata).toEqual([
    {
      sdkMessageId: "msg_feed_exact",
      sdkStreamBlockKey: "text:message:msg_feed_exact",
    },
  ]);
});

test("suppresses replayed SDK text blocks by message id when block indexes differ", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ message: string; stream: boolean }> = [];
  const emit = (_threadId: string, _type: string, message: string, _role: string, stream: boolean) =>
    emitted.push({ message, stream });

  for (const payload of [
    {
      type: "eco_stream",
      blockKind: "text",
      streamPlaceholder: true,
      stream_block_key: "text:1",
      messageId: "msg_replayed",
    },
    {
      type: "eco_stream",
      blockKind: "text",
      text: "只显示一次。",
      streamFinalize: true,
      stream_block_key: "text:1",
      messageId: "msg_replayed",
    },
    {
      type: "eco_stream",
      blockKind: "text",
      streamPlaceholder: true,
      stream_block_key: "text:2",
      messageId: "msg_replayed",
    },
    {
      type: "eco_stream",
      blockKind: "text",
      text: "只显示一次。",
      streamFinalize: true,
      stream_block_key: "text:2",
      messageId: "msg_replayed",
    },
  ]) {
    bridge.handleEvent("thr_replayed", { type: "message.delta", role: "planner", payload }, emit);
  }

  expect(emitted).toEqual([
    { message: "", stream: true },
    { message: "只显示一次。", stream: false },
  ]);
});

test("persists task terminal aggregate usage as diagnostics metadata only", () => {
  const bridge = new SdkStreamActivityBridge();
  const metadata: Record<string, unknown>[] = [];

  bridge.handleEvent(
    "thr_task_terminal",
    {
      type: "todo.updated",
      role: "general-purpose",
      agentId: "agent_general_task",
      payload: {
        sdkKind: "task_notification",
        task_id: "task_general",
        tool_use_id: "call_general",
        status: "completed",
        summary: "Done",
        usage: { total_tokens: 900, tool_uses: 5, duration_ms: 7000 },
      },
    },
    (_threadId, _type, _message, _role, _stream, _agentId, extras) => {
      metadata.push(extras?.metadata ?? {});
    },
    undefined,
    { activityAgentId: "agent_general_task", parentToolUseId: "call_general" },
  );

  expect(metadata).toEqual([
    {
      sdkTaskId: "task_general",
      sdkTaskKind: "task_notification",
      sdkTaskToolUseId: "call_general",
      sdkTaskStatus: "completed",
      sdkTaskUsage: { total_tokens: 900, tool_uses: 5, duration_ms: 7000 },
    },
  ]);
});

test("flushPendingAndReset finalizes open narrative text instead of dropping it", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ type: string; message: string; stream: boolean }> = [];
  const emit = (
    _threadId: string,
    type: string,
    message: string,
    _role: string,
    stream: boolean,
  ) => {
    emitted.push({ type, message, stream });
  };

  bridge.handleEvent(
    "thr_flush",
    {
      type: "message.delta",
      role: "planner",
      payload: {
        type: "eco_stream",
        blockKind: "text",
        text: "keep me",
        stream_block_key: "pi-text:s1:m1:c0",
      },
    },
    emit,
  );

  // Throttled remote emit has not fired yet — reset must not drop the open line.
  emitted.length = 0;
  bridge.flushPendingAndReset("thr_flush", emit);

  expect(emitted.some((item) => item.message === "keep me" && item.stream === false)).toBe(true);
});
