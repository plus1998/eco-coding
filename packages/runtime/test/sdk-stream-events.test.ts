import { expect, test } from "bun:test";
import {
  createSdkStreamContext,
  mapStreamEventToEvents,
} from "../src/sdk-stream-events";
import { mapSdkMessageToEvents } from "../src/claude-agent-sdk";
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
        delta: { type: "input_json_delta", partial_json: "{\"file_path\":\"/a.ts\"}" },
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

  expect(calls).toEqual([
    { role: "researcher", parentToolUseId: "toolu_parent", sessionId: "sess" },
  ]);
  expect(events[0]?.agentId).toBe("agent_researcher");
  expect(events[0]?.role).toBe("researcher");
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
