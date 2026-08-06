import { expect, test } from "bun:test";
import { CodexForkNotAvailable } from "../src/codex-fork.js";
import { resolveResumeSessionAtBeforeUserMessage } from "../src/runtime-session-compat.js";

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
