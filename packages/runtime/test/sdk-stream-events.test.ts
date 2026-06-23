import { expect, test } from "bun:test";
import { mapSdkMessageToEvents } from "../src/claude-agent-sdk";
import { createSdkStreamContext, mapStreamEventToEvents } from "../src/sdk-stream-events";
import { ecoSubagentKeyForRole } from "../src/subagent-availability";

test("maps tool_use content_block_start to tool.started", () => {
  const ctx = createSdkStreamContext();
  const events = mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u1",
      session_id: "sess",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", id: "toolu_abc" },
      },
    },
    "thr_1",
    ctx,
  );
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("tool.started");
  const payload = events[0]?.payload as Record<string, unknown>;
  expect(payload.tool_name).toBe("Read");
  expect(payload.tool_use_id).toBe("toolu_abc");
  expect(payload.streaming).toBe(true);
  expect(payload.input_complete).toBeUndefined();
});

test("marks tool_use content_block_stop input as complete", () => {
  const ctx = createSdkStreamContext();
  mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u1",
      session_id: "sess",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", id: "toolu_abc" },
      },
    },
    "thr_1",
    ctx,
  );
  mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u2",
      session_id: "sess",
      event: {
        type: "content_block_delta",
        delta: { type: "input_json_delta", partial_json: '{"file_path":"/a.ts"}' },
      },
    },
    "thr_1",
    ctx,
  );
  const events = mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u3",
      session_id: "sess",
      event: { type: "content_block_stop" },
    },
    "thr_1",
    ctx,
  );
  expect(events).toHaveLength(1);
  const payload = events[0]?.payload as Record<string, unknown>;
  expect(payload.tool_name).toBe("Read");
  expect(payload.input_complete).toBe(true);
  expect(payload.input).toEqual({ file_path: "/a.ts" });
});

test("maps eco subagent stream metadata to the role", () => {
  const ctx = createSdkStreamContext();
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_eco",
      session_id: "sess",
      subagent_type: ecoSubagentKeyForRole("coder"),
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", id: "toolu_eco" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u_eco",
    ctx,
  );
  expect(events[0]?.role).toBe("coder");
});

test("maps dynamic eco subagent stream metadata to the role", () => {
  const ctx = createSdkStreamContext();
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_dynamic",
      session_id: "sess",
      subagent_type: "eco_researcher",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "WebSearch", id: "toolu_research" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u_dynamic",
    ctx,
  );
  expect(events[0]?.role).toBe("researcher");
});

test("maps general-purpose stream metadata to the role", () => {
  const ctx = createSdkStreamContext();
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_general",
      session_id: "sess",
      subagent_type: "general-purpose",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", id: "toolu_general" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u_general",
    ctx,
  );
  expect(events[0]?.role).toBe("general-purpose");
});

test("maps Plan stream metadata to the role", () => {
  const ctx = createSdkStreamContext();
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_plan",
      session_id: "sess",
      subagent_type: "Plan",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", id: "toolu_plan" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u_plan",
    ctx,
  );
  expect(events[0]?.role).toBe("Plan");
});

test("attributes dynamic subagent stream usage through resolver", () => {
  const calls: Array<{ role: string; parentToolUseId?: string; sessionId: string }> = [];
  const ctx = createSdkStreamContext({
    resolveSubagentAgentId(input) {
      calls.push(input);
      return "agent_researcher";
    },
  });
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_usage",
      session_id: "sess",
      subagent_type: "eco_researcher",
      parent_tool_use_id: "toolu_parent",
      event: {
        type: "message_delta",
        usage: { input_tokens: 100, output_tokens: 20 },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u_usage",
    ctx,
  );

  expect(calls).toEqual([{ role: "researcher", parentToolUseId: "toolu_parent", sessionId: "sess" }]);
  expect(events[0]?.agentId).toBe("agent_researcher");
  expect(events[0]?.role).toBe("researcher");
});

test("does not attribute main-session stream usage to a stale subagent context", () => {
  const calls: Array<{ role: string; parentToolUseId?: string; sessionId: string }> = [];
  const ctx = createSdkStreamContext({
    resolveSubagentAgentId(input) {
      calls.push(input);
      return "agent_explore";
    },
  });
  mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_sub",
      session_id: "sess",
      subagent_type: "eco_explore",
      parent_tool_use_id: "toolu_parent",
      event: { type: "message_delta", usage: { input_tokens: 50, output_tokens: 5 } },
    },
    "thr_1",
    "sess",
    "planner",
    "u_sub",
    ctx,
  );
  calls.length = 0;

  const mainEvents = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_main",
      session_id: "sess",
      event: { type: "message_delta", usage: { input_tokens: 200, output_tokens: 10 } },
    },
    "thr_1",
    "sess",
    "planner",
    "u_main",
    ctx,
  );

  expect(calls).toHaveLength(0);
  expect(mainEvents[0]?.agentId).toBe("sess");
  expect(mainEvents[0]?.role).toBe("planner");
  expect((mainEvents[0]?.payload as Record<string, unknown>).parent_tool_use_id).toBeUndefined();
});

test("keeps parent_tool_use_id on usage payload when runtime resolution fails", () => {
  const ctx = createSdkStreamContext({
    resolveSubagentAgentId() {
      return undefined;
    },
  });
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_unresolved",
      session_id: "sess",
      subagent_type: "eco_explore",
      parent_tool_use_id: "toolu_parallel",
      event: { type: "message_delta", usage: { input_tokens: 80, output_tokens: 8 } },
    },
    "thr_1",
    "sess",
    "planner",
    "u_unresolved",
    ctx,
  );

  expect(events[0]?.agentId).toBe("sess");
  expect((events[0]?.payload as Record<string, unknown>).parent_tool_use_id).toBe("toolu_parallel");
});

test("keeps per-subagent roles when parallel streams interleave", () => {
  const ctx = createSdkStreamContext();
  mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_a1",
      session_id: "sess",
      subagent_type: "eco_explore",
      parent_tool_use_id: "toolu_a",
      event: { type: "content_block_start", content_block: { type: "text" } },
    },
    "thr_1",
    "sess",
    "planner",
    "u_a1",
    ctx,
  );
  mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_b1",
      session_id: "sess",
      subagent_type: ecoSubagentKeyForRole("coder"),
      parent_tool_use_id: "toolu_b",
      event: { type: "content_block_start", content_block: { type: "text" } },
    },
    "thr_1",
    "sess",
    "planner",
    "u_b1",
    ctx,
  );

  // Later chunk from subagent A carries only the parent id, not the subagent type.
  const events = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u_a2",
      session_id: "sess",
      parent_tool_use_id: "toolu_a",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
    },
    "thr_1",
    "sess",
    "planner",
    "u_a2",
    ctx,
  );
  expect(events[0]?.role).toBe("explore");
});

test("suppresses text_delta while inside tool block", () => {
  const ctx = createSdkStreamContext();
  mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u1",
      session_id: "sess",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Bash", id: "toolu_bash" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u1",
    ctx,
  );
  const textEvents = mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u2",
      session_id: "sess",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "should not show" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u2",
    ctx,
  );
  expect(textEvents).toHaveLength(0);
});

test("emits thinking placeholder and finalize stream events", () => {
  const ctx = createSdkStreamContext();
  const start = mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u1",
      session_id: "sess",
      event: {
        type: "content_block_start",
        content_block: { type: "thinking" },
      },
    },
    "thr_1",
    ctx,
  );
  expect(start[0]?.type).toBe("message.delta");
  const payload = start[0]?.payload as Record<string, unknown>;
  expect(payload.type).toBe("eco_stream");
  expect(payload.streamPlaceholder).toBe(true);

  mapStreamEventToEvents(
    {
      type: "stream_event",
      uuid: "u2",
      session_id: "sess",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "hmm" },
      },
    },
    "thr_1",
    "sess",
    "planner",
    "u2",
    ctx,
  );

  const stop = mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u3",
      session_id: "sess",
      event: { type: "content_block_stop" },
    },
    "thr_1",
    ctx,
  );
  const finalize = stop[0]?.payload as Record<string, unknown>;
  expect(finalize.streamFinalize).toBe(true);
});

test("expands serialized content array delivered as one text_delta", () => {
  const ctx = createSdkStreamContext();
  const payload =
    '[{"type":"text","text":"Inspect admin tabs."},{"type":"tool_use","id":"toolu_x","name":"Read","input":{"file_path":"/tmp/main.tsx"}}]';
  const events = mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u_embed",
      session_id: "sess",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: payload },
      },
    },
    "thr_1",
    ctx,
  );
  expect(events.some((event) => event.type === "message.delta" && event.payload?.type === "eco_stream")).toBe(
    true,
  );
  expect(events.some((event) => event.type === "tool.started")).toBe(true);
  expect(events.some((event) => event.payload?.text === payload)).toBe(false);
});

test("skips duplicate assistant tool_use when stream already emitted", () => {
  const ctx = createSdkStreamContext();
  mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u1",
      session_id: "sess",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "Read", id: "toolu_dup" },
      },
    },
    "thr_1",
    ctx,
  );
  const assistantEvents = mapSdkMessageToEvents(
    {
      type: "assistant",
      uuid: "u2",
      session_id: "sess",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "toolu_dup", input: { file_path: "/a.ts" } }],
      },
    },
    "thr_1",
    ctx,
  );
  expect(assistantEvents).toHaveLength(0);
});

test("maps message_delta usage to usage.recorded", () => {
  const ctx = createSdkStreamContext();
  const events = mapSdkMessageToEvents(
    {
      type: "stream_event",
      uuid: "u1",
      session_id: "sess",
      event: {
        type: "message_delta",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
    "thr_1",
    ctx,
  );
  expect(events.some((event) => event.type === "usage.recorded")).toBe(true);
});

test("assistant tool_use falls back to stream context parent_tool_use_id", () => {
  const ctx = createSdkStreamContext();
  ctx.parentToolUseId = "toolu_delegate";
  ctx.activeSubagentRole = "explore";
  const events = mapSdkMessageToEvents(
    {
      type: "assistant",
      uuid: "u_assistant",
      session_id: "sess",
      message: {
        content: [{ type: "tool_use", name: "Read", id: "toolu_read", input: { file_path: "/a.ts" } }],
      },
    },
    "thr_1",
    ctx,
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "tool.started",
    role: "explore",
  });
  expect(events[0]?.payload).toMatchObject({
    parent_tool_use_id: "toolu_delegate",
    tool_name: "Read",
  });
});

test("task_progress carries stream context parent_tool_use_id", () => {
  const ctx = createSdkStreamContext();
  ctx.parentToolUseId = "toolu_delegate";
  ctx.activeSubagentRole = "explore";
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
    ctx,
  );

  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    type: "todo.updated",
    role: "explore",
  });
  expect(events[0]?.payload).toMatchObject({
    parent_tool_use_id: "toolu_delegate",
    sdkKind: "task_progress",
  });
});

test("tool_progress and tool_use_summary carry parent_tool_use_id from message or context", () => {
  const ctx = createSdkStreamContext();
  ctx.parentToolUseId = "toolu_ctx";
  ctx.activeSubagentRole = "coder";
  const progress = mapSdkMessageToEvents(
    {
      type: "tool_progress",
      uuid: "u_progress",
      session_id: "sess",
      tool_use_id: "toolu_read",
      parent_tool_use_id: "toolu_msg",
    },
    "thr_1",
    ctx,
  );
  expect(progress[0]?.payload).toMatchObject({ parent_tool_use_id: "toolu_msg" });

  const summary = mapSdkMessageToEvents(
    {
      type: "tool_use_summary",
      uuid: "u_summary",
      session_id: "sess",
    },
    "thr_1",
    ctx,
  );
  expect(summary[0]?.payload).toMatchObject({ parent_tool_use_id: "toolu_ctx" });
});
