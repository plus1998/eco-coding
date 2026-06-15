import { expect, test } from "bun:test";
import {
  buildCommitMessageUserMessage,
  sanitizeCommitMessage,
} from "../src/main/git-commit-message";
import type { CommitDiffContext } from "../src/main/git-operations";

const context: CommitDiffContext = {
  stagedNameStatus: "M\tREADME.md",
  stagedStat: " README.md | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)",
  stagedPatch: "diff --git a/README.md b/README.md",
  stagedPatchTruncated: false,
  recentCommits: "abc1234 feat: seed",
};

test("buildCommitMessageUserMessage includes staged diff sections", () => {
  const message = buildCommitMessageUserMessage(context);
  expect(message).toContain("## Staged files");
  expect(message).toContain("README.md");
  expect(message).toContain("## Recent commits");
});

test("buildCommitMessageUserMessage includes unstaged sections", () => {
  const message = buildCommitMessageUserMessage({
    ...context,
    unstagedNameStatus: "M\tsrc/app.ts",
    unstagedPatch: "diff --git a/src/app.ts",
    unstagedPatchTruncated: true,
  });
  expect(message).toContain("## Unstaged files");
  expect(message).toContain("unstaged patch 已在上方截断");
});

test("sanitizeCommitMessage rejects refusal-like output", () => {
  expect(sanitizeCommitMessage("抱歉，我无法生成提交信息")).toBeUndefined();
});

test("sanitizeCommitMessage keeps valid conventional commit text", () => {
  expect(sanitizeCommitMessage("feat(git): add commit dialog\n\n- stage diff")).toBe(
    "feat(git): add commit dialog\n\n- stage diff",
  );
});
