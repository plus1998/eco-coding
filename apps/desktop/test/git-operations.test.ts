import { expect, test } from "bun:test";
import { collectCommitDiffContext, COMMIT_DIFF_MAX_CHARS } from "../src/main/git-operations";

test("collectCommitDiffContext gathers staged diff via runner", async () => {
  const calls: string[][] = [];
  const run = async (args: string[], _cwd: string) => {
    calls.push(args);
    const key = args.join(" ");
    if (key.includes("diff --cached --name-status")) {
      return { exitCode: 0, stdout: "M\tfile.ts", stderr: "" };
    }
    if (key.includes("diff --cached --stat")) {
      return { exitCode: 0, stdout: " file.ts | 1 +\n", stderr: "" };
    }
    if (key === "git diff --cached") {
      return { exitCode: 0, stdout: "diff content", stderr: "" };
    }
    if (key.includes("log -8")) {
      return { exitCode: 0, stdout: "abc feat: init", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const context = await collectCommitDiffContext("/tmp/repo", false, run);
  expect(context.stagedNameStatus).toContain("file.ts");
  expect(context.recentCommits).toContain("feat: init");
  expect(calls.some((args) => args.includes("--cached"))).toBe(true);
});

test("COMMIT_DIFF_MAX_CHARS is large enough for real diffs", () => {
  expect(COMMIT_DIFF_MAX_CHARS).toBeGreaterThan(10_000);
});
