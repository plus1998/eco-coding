import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapAcpSessionUpdate } from "../src/acp-event-map.js";

const CTX = {
  threadId: "thr_1",
  agentId: "agent_cursor",
  sessionRunId: "run_1",
};

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

test("maps tool_call pending fixture to tool.started", () => {
  const params = loadFixture("acp-session-update-tool-call.json");
  const events = mapAcpSessionUpdate(params, CTX);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("tool.started");
  expect(events[0]?.payload).toMatchObject({
    toolCallId: "call_abc",
    title: "Read file",
    kind: "read",
    status: "pending",
    raw: params,
  });
});

test("maps tool_call_update completed to tool.completed", () => {
  const params = {
    sessionId: "sess_fixture_1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "call_abc",
      status: "completed",
      rawOutput: { ok: true },
    },
  };
  const events = mapAcpSessionUpdate(params, CTX);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("tool.completed");
  expect(events[0]?.payload).toMatchObject({
    toolCallId: "call_abc",
    status: "completed",
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
  });
});

test("unknown sessionUpdate becomes terminal.output with full raw", () => {
  const params = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: [{ name: "copy-request-id" }],
    },
  };
  const [event] = mapAcpSessionUpdate(params, CTX);
  expect(event?.type).toBe("terminal.output");
  expect(event?.payload).toEqual({ source: "acp", raw: params });
});

test("non-object params become terminal.output with raw", () => {
  const [event] = mapAcpSessionUpdate("not-json-rpc", CTX);
  expect(event?.type).toBe("terminal.output");
  expect(event?.payload).toEqual({ source: "acp", raw: "not-json-rpc" });
});
