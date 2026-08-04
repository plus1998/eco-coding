import { expect, test } from "bun:test";
import { prepareSdkRunContextAfterCompaction } from "../src/main/sdk-run-context-compaction";

const resume = { resumeSessionId: "session_old", cwd: "/workspace" };

test("keeps the old resume when no compaction occurs", async () => {
  const result = await prepareSdkRunContextAfterCompaction(
    {
      threadId: "thr_1",
      prompt: "continue",
      worktreePath: "/workspace",
      resume,
      signal: new AbortController().signal,
    },
    {
      ensureHeadroom: async () => false,
      getCompactHandoff: () => undefined,
      getThreadPrompt: () => "original task",
    },
  );

  expect(result).toEqual({ prompt: "continue", resume });
});

test("drops the old resume and rebuilds prompt from compact handoff", async () => {
  const result = await prepareSdkRunContextAfterCompaction(
    {
      threadId: "thr_1",
      prompt: "continue",
      worktreePath: "/workspace",
      resume,
      signal: new AbortController().signal,
    },
    {
      ensureHeadroom: async () => true,
      getCompactHandoff: () => ({
        summary: "Completed compaction handoff for the task.",
        recentMessages: [
          { role: "user", message: "latest question" },
          { role: "user", message: "follow-up clarification" },
        ],
      }),
      getThreadPrompt: () => "original task",
    },
  );

  expect(result.resume).toBeUndefined();
  expect(result.prompt).toContain("original task");
  expect(result.prompt).toContain("Another language model started to solve this problem");
  expect(result.prompt).toContain("Completed compaction handoff for the task.");
  expect(result.prompt).toContain("## 近期用户消息（原文保留）");
  expect(result.prompt).toContain("latest question");
  expect(result.prompt).toContain("后续消息：\ncontinue");
});

test("fails explicitly when compaction clears the session without a handoff", async () => {
  await expect(
    prepareSdkRunContextAfterCompaction(
      {
        threadId: "thr_1",
        prompt: "continue",
        worktreePath: "/workspace",
        resume,
        signal: new AbortController().signal,
      },
      {
        ensureHeadroom: async () => true,
        getCompactHandoff: () => undefined,
        getThreadPrompt: () => "original task",
      },
    ),
  ).rejects.toThrow("未生成可恢复的压缩交接内容");
});
