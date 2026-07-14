import { expect, test } from "bun:test";
import { CodexRollbackNotAvailable } from "../src/codex-rollback.js";
import { resolveResumeSessionAtBeforeUserMessage } from "../src/runtime-session-compat.js";

test("resolveResumeSessionAtBeforeUserMessage documents thread/rollback stub", async () => {
  await expect(
    resolveResumeSessionAtBeforeUserMessage({
      sessionId: "sess_1",
      userMessageId: "msg_1",
      dir: "/workspace",
    }),
  ).rejects.toThrow(CodexRollbackNotAvailable);
  await expect(
    resolveResumeSessionAtBeforeUserMessage({
      sessionId: "sess_1",
      userMessageId: "msg_1",
      dir: "/workspace",
    }),
  ).rejects.toThrow(/thread\/rollback/);
});
