import { expect, test } from "bun:test";
import { CodexForkNotAvailable } from "../src/codex-fork.js";
import {
  findClaudeSessionByRecoveryTitle,
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

test("forkClaudeSessionAt creates a named explicit branch at the kept chain entry", async () => {
  let captured:
    | {
        sessionId: string;
        options?: { dir?: string; upToMessageId?: string; title?: string };
      }
    | undefined;
  const forked = await forkClaudeSessionAt({
    sessionId: "source-session",
    dir: "/workspace",
    upToMessageId: "kept-entry",
    title: "eco-command:command-1",
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
    options: {
      dir: "/workspace",
      upToMessageId: "kept-entry",
      title: "eco-command:command-1",
    },
  });
});

test("findClaudeSessionByRecoveryTitle resolves one durable fork identity", async () => {
  const resolved = await findClaudeSessionByRecoveryTitle({
    dir: "/workspace",
    title: "eco-command:command-1",
    loadSdk: async () => ({
      listSessions: async () => [
        {
          sessionId: "unrelated-session",
          customTitle: "ordinary title",
        },
        {
          sessionId: "forked-session",
          customTitle: "eco-command:command-1",
        },
      ],
    }),
  });
  expect(resolved).toBe("forked-session");

  await expect(
    findClaudeSessionByRecoveryTitle({
      dir: "/workspace",
      title: "eco-command:missing",
      loadSdk: async () => ({ listSessions: async () => [] }),
    }),
  ).resolves.toBeUndefined();
});

test("findClaudeSessionByRecoveryTitle rejects ambiguous fork identity", async () => {
  await expect(
    findClaudeSessionByRecoveryTitle({
      dir: "/workspace",
      title: "eco-command:duplicate",
      loadSdk: async () => ({
        listSessions: async () => [
          { sessionId: "fork-1", customTitle: "eco-command:duplicate" },
          { sessionId: "fork-2", customTitle: "eco-command:duplicate" },
        ],
      }),
    }),
  ).rejects.toThrow(/multiple sessions/);
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
