import { expect, test } from "bun:test";
import {
  isSdkCompactSummaryMessage,
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

test("isSdkCompactSummaryMessage marks Claude auto-compaction summary turns", () => {
  expect(
    isSdkCompactSummaryMessage({
      type: "user",
      uuid: "summary_1",
      message: {
        content: "This session is being continued from a previous conversation that ran out of context.",
      },
    }),
  ).toBe(true);
  // The CLI writes these flags into the transcript JSONL; read them when present.
  expect(isSdkCompactSummaryMessage({ type: "user", uuid: "summary_1", isCompactSummary: true })).toBe(true);
  expect(isSdkCompactSummaryMessage({ type: "user", uuid: "msg_1", message: { content: "Hello" } })).toBe(
    false,
  );
});

test("sdkSessionMessageToActivityLine drops the compaction summary turn", () => {
  expect(
    sdkSessionMessageToActivityLine({
      type: "user",
      uuid: "summary_1",
      message: {
        content: [{ type: "text", text: "This session is being continued from a previous conversation" }],
      },
    }),
  ).toBeUndefined();
  expect(
    sdkSessionMessageToActivityLine({
      type: "user",
      uuid: "user_1",
      message: { content: "Hello" },
    })?.id,
  ).toBe("sdk:user_1");
});

test("listSdkSessionActivityLines keeps prompt lines in transcript order without the summary", async () => {
  // Reproduces a compacted session: the summary sits at the root of the
  // transcript, where the pre-compaction prompts used to be. Listing it as a
  // user line shifted every prompt↔session pairing by one.
  const lines = await listSdkSessionActivityLines("thr_1", {
    getSdkSession: () => ({ sessionId: "session_1", cwd: "/workspace" }),
    loadSdk: async () => ({
      getSessionMessages: async () => [
        {
          type: "user",
          uuid: "efa57c6c",
          isCompactSummary: true,
          isVisibleInTranscriptOnly: true,
          message: {
            content: "This session is being continued from a previous conversation that ran out of context.",
          },
        },
        { type: "user", uuid: "29ab8f7b", message: { content: "second prompt" } },
        { type: "user", uuid: "b06589fe", message: { content: "?" } },
      ],
    }),
  });

  expect(lines.map((line) => line.id)).toEqual(["sdk:29ab8f7b", "sdk:b06589fe"]);
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
