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

test("emits Requesting model status from agent.started events", () => {
  const bridge = new SdkStreamActivityBridge();
  const emitted: Array<{ message: string; role: string }> = [];
  bridge.handleEvent(
    "thr_1",
    {
      type: "agent.started",
      role: "planner",
      payload: { type: "system", subtype: "status", status: "requesting" },
    },
    (_threadId, _type, message, role) => {
      emitted.push({ message, role });
    },
  );
  expect(emitted).toEqual([{ message: "Requesting model…", role: "planner" }]);
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
