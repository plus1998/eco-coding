import { expect, test } from "bun:test";
import {
  listSdkSessionActivityLines,
  listSdkSessionCompactionActivityLines,
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

test("listSdkSessionCompactionActivityLines fails explicitly when session metadata is missing", async () => {
  await expect(
    listSdkSessionCompactionActivityLines("thr_missing", {
      getSdkSession: () => undefined,
    }),
  ).rejects.toThrow("SDK session metadata is unavailable for compaction");

  await expect(
    listSdkSessionCompactionActivityLines("thr_missing_cwd", {
      getSdkSession: () => ({ sessionId: "session_1", cwd: "" }),
    }),
  ).rejects.toThrow("SDK session cwd is unavailable for compaction");
});

test("listSdkSessionCompactionActivityLines includes truncated tool calls and results", async () => {
  const lines = await listSdkSessionCompactionActivityLines("thr_1", {
    getSdkSession: () => ({ sessionId: "session_1", cwd: "/workspace" }),
    loadSdk: async () => ({
      getSessionMessages: async () => [
        {
          type: "assistant",
          uuid: "assistant_tool",
          message: {
            content: [
              { type: "text", text: "Reading" },
              { type: "tool_use", name: "Read", input: { file: "apps/a.ts" } },
            ],
          },
        },
        {
          type: "user",
          uuid: "tool_result",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "call_1",
                content: `result ${"x".repeat(5_000)}`,
              },
            ],
          },
        },
      ],
    }),
  });

  expect(lines[0]?.message).toContain('Reading\n[工具调用 Read] {"file":"apps/a.ts"}');
  expect(lines[1]?.message).toStartWith("[工具结果 call_1] result ");
  expect(lines[1]?.message.length).toBeLessThan(4_050);
});

test("listSdkSessionCompactionActivityLines fails explicitly when SDK transcript access is unavailable", async () => {
  await expect(
    listSdkSessionCompactionActivityLines("thr_1", {
      getSdkSession: () => ({ sessionId: "session_1", cwd: "/workspace" }),
      loadSdk: async () => ({}),
    }),
  ).rejects.toThrow("SDK getSessionMessages is unavailable");
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
