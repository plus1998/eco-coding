import { expect, test } from "bun:test";
import { handleGitCommit, handleGitGenerateCommitMessage } from "../src/main/git-service";

const unusedDeps = {} as never;

test("commit message generation rejects a missing Git commit model before touching Git", async () => {
  await expect(
    handleGitGenerateCommitMessage(
      {
        workspacePath: "/workspace",
        includeUnstaged: true,
      },
      unusedDeps,
    ),
  ).rejects.toThrow(/Git 提交模型/);
});

test("commit without a message rejects a missing Git commit model before touching Git", async () => {
  await expect(
    handleGitCommit(
      {
        workspacePath: "/workspace",
        mainAgentConfigId: "main",
        includeUnstaged: true,
      },
      unusedDeps,
    ),
  ).rejects.toThrow(/Git 提交模型/);
});
