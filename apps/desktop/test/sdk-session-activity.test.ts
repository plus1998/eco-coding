import { expect, test } from "bun:test";
import {
  listSdkSessionActivityLines,
  listSdkSubagentActivityLines,
  sdkActivityLineId,
  sdkMessageUuidFromActivityLineId,
  sdkSessionMessageToActivityLine,
} from "../src/main/sdk-session-activity";

test("sdk activity ids are stable and reversible", () => {
  expect(sdkActivityLineId("msg_1")).toBe("sdk:msg_1");
  expect(sdkMessageUuidFromActivityLineId("sdk:msg_1")).toBe("msg_1");
  expect(sdkMessageUuidFromActivityLineId("legacy_1")).toBeUndefined();
});

test("sdkSessionMessageToActivityLine maps user and assistant text", () => {
  expect(
    sdkSessionMessageToActivityLine({
      type: "user",
      uuid: "user_1",
      message: { content: [{ type: "text", text: "Hello" }] },
    }),
  ).toEqual({
    id: "sdk:user_1",
    role: "user",
    message: "Hello",
    rewindTarget: {
      activityLineId: "sdk:user_1",
      userMessageId: "user_1",
    },
  });

  expect(
    sdkSessionMessageToActivityLine({
      type: "assistant",
      uuid: "assistant_1",
      message: { content: [{ type: "text", text: "Hi" }] },
    }),
  ).toEqual({
    id: "sdk:assistant_1",
    role: "assistant",
    message: "Hi",
  });
});

test("sdkSessionMessageToActivityLine filters system and tool-only messages", () => {
  expect(
    sdkSessionMessageToActivityLine({
      type: "system",
      uuid: "system_1",
      message: { content: [{ type: "text", text: "hidden" }] },
    }),
  ).toBeUndefined();
  expect(
    sdkSessionMessageToActivityLine({
      type: "assistant",
      uuid: "assistant_1",
      message: { content: [{ type: "tool_use", name: "Read" }] },
    }),
  ).toBeUndefined();
});

test("listSdkSessionActivityLines reads SDK session messages", async () => {
  const lines = await listSdkSessionActivityLines("thr_1", {
    getSdkSession: () => ({ sessionId: "session_1", cwd: "/workspace" }),
    loadSdk: async () => ({
      getSessionMessages: async (sessionId, options) => {
        expect(sessionId).toBe("session_1");
        expect(options).toMatchObject({ dir: "/workspace", includeSystemMessages: false });
        return [
          { type: "user", uuid: "user_1", message: { content: "Question" } },
          { type: "assistant", uuid: "assistant_1", message: { content: "Answer" } },
        ];
      },
    }),
  });

  expect(lines.map((line) => line.id)).toEqual(["sdk:user_1", "sdk:assistant_1"]);
});

test("listSdkSessionActivityLines returns empty when session or JSONL is unavailable", async () => {
  expect(
    await listSdkSessionActivityLines("thr_1", {
      getSdkSession: () => undefined,
    }),
  ).toEqual([]);

  expect(
    await listSdkSessionActivityLines("thr_1", {
      getSdkSession: () => ({ sessionId: "session_1", cwd: "/workspace" }),
      loadSdk: async () => ({
        getSessionMessages: async () => {
          throw new Error("not found");
        },
      }),
    }),
  ).toEqual([]);
});

test("listSdkSubagentActivityLines reads SDK subagent messages and stamps agent id", async () => {
  const lines = await listSdkSubagentActivityLines("thr_1", "agent_1", {
    getSdkSession: () => ({ sessionId: "session_1", cwd: "/workspace" }),
    loadSdk: async () => ({
      getSubagentMessages: async (sessionId, agentId, options) => {
        expect(sessionId).toBe("session_1");
        expect(agentId).toBe("agent_1");
        expect(options).toMatchObject({ dir: "/workspace" });
        return [{ type: "assistant", uuid: "assistant_1", message: { content: "Finding" } }];
      },
    }),
  });

  expect(lines).toEqual([
    {
      id: "sdk:assistant_1",
      role: "assistant",
      message: "Finding",
      agentId: "agent_1",
    },
  ]);
});
