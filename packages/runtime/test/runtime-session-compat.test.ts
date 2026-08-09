import { expect, test } from "bun:test";
import { CodexForkNotAvailable } from "../src/codex-fork.js";
import {
  forkClaudeSessionAt,
  resolveResumeSessionAtBeforeUserMessage,
} from "../src/runtime-session-compat.js";

test("resolveResumeSessionAtBeforeUserMessage documents thread/fork stub", async () => {
  await expect(
    resolveResumeSessionAtBeforeUserMessage({
      sessionId: "sess_1",
      userMessageId: "msg_1",
      dir: "/workspace",
    }),
  ).rejects.toThrow(CodexForkNotAvailable);
  await expect(
    resolveResumeSessionAtBeforeUserMessage({
      sessionId: "sess_1",
      userMessageId: "msg_1",
      dir: "/workspace",
    }),
  ).rejects.toThrow(/thread\/fork/);
});

test("forkClaudeSessionAt creates an explicit branch at the kept chain entry", async () => {
  let captured: { sessionId: string; options?: { dir?: string; upToMessageId?: string } } | undefined;
  const forked = await forkClaudeSessionAt({
    sessionId: "source-session",
    dir: "/workspace",
    upToMessageId: "kept-entry",
    loadSdk: async () => ({
      forkSession: async (sessionId, options) => {
        captured = { sessionId, options };
        return { sessionId: "forked-session" };
      },
    }),
  });

  expect(forked).toBe("forked-session");
  expect(captured).toEqual({
    sessionId: "source-session",
    options: { dir: "/workspace", upToMessageId: "kept-entry" },
  });
});

test("forkClaudeSessionAt rejects a missing or unchanged fork id", async () => {
  await expect(
    forkClaudeSessionAt({
      sessionId: "source-session",
      dir: "/workspace",
      upToMessageId: "kept-entry",
      loadSdk: async () => ({}),
    }),
  ).rejects.toThrow(/forkSession is unavailable/);
  await expect(
    forkClaudeSessionAt({
      sessionId: "source-session",
      dir: "/workspace",
      upToMessageId: "kept-entry",
      loadSdk: async () => ({
        forkSession: async () => ({ sessionId: "source-session" }),
      }),
    }),
  ).rejects.toThrow(/source session/);
});
