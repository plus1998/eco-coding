import { expect, test } from "bun:test";
import { collectCommitDiffContext, COMMIT_DIFF_MAX_CHARS, createGitBranch, listGitCommits } from "../src/main/git-operations";

test("createGitBranch runs git checkout -b", async () => {
  const calls: string[][] = [];
  const run = async (args: string[], _cwd: string) => {
    calls.push(args);
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await createGitBranch("/tmp/repo", "feature/new", run);
  expect(calls).toEqual([["git", "checkout", "-b", "feature/new"]]);
});

test("createGitBranch rejects empty branch name", async () => {
  const run = async (_args: string[], _cwd: string) => ({ exitCode: 0, stdout: "", stderr: "" });
  await expect(createGitBranch("/tmp/repo", "   ", run)).rejects.toThrow("分支名不能为空");
});

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

test("listGitCommits paginates git log output", async () => {
  const run = async (args: string[], _cwd: string) => {
    const key = args.join(" ");
    if (key.includes("rev-parse --show-toplevel")) {
      return { exitCode: 0, stdout: "/tmp/repo", stderr: "" };
    }
    if (key.includes("rev-parse --verify HEAD")) {
      return { exitCode: 0, stdout: "abc123", stderr: "" };
    }
    if (key.includes("log --skip=0") && key.includes("-n 6")) {
      return {
        exitCode: 0,
        stdout: [
          "sha1\x1fsh1\x1ffeat: one\x1fAlice\x1f2 hours ago\x1f (HEAD -> main)",
          "sha2\x1fsh2\x1ffix: two\x1fBob\x1f3 hours ago\x1f",
          "sha3\x1fsh3\x1fchore: three\x1fCara\x1f4 hours ago\x1f",
          "sha4\x1fsh4\x1frefactor: four\x1fDan\x1f5 hours ago\x1f",
          "sha5\x1fsh5\x1fdocs: five\x1fEve\x1f6 hours ago\x1f",
          "sha6\x1fsh6\x1ftest: six\x1fFinn\x1f7 hours ago\x1f",
        ].join("\n"),
        stderr: "",
      };
    }
    if (key.includes("log --skip=5") && key.includes("-n 6")) {
      return {
        exitCode: 0,
        stdout: "sha6\x1fsh6\x1ftest: six\x1fFinn\x1f7 hours ago\x1f",
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const firstPage = await listGitCommits("/tmp/repo", { skip: 0, limit: 5 }, run);
  expect(firstPage.commits).toHaveLength(5);
  expect(firstPage.commits[0]?.subject).toBe("feat: one");
  expect(firstPage.commits[0]?.decorations).toEqual(["main"]);
  expect(firstPage.hasMore).toBe(true);

  const secondPage = await listGitCommits("/tmp/repo", { skip: 5, limit: 5 }, run);
  expect(secondPage.commits).toHaveLength(1);
  expect(secondPage.hasMore).toBe(false);
});
