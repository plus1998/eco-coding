import { expect, test } from "bun:test";
import {
  type CommandRunner,
  createWorktreePlan,
  evaluateCommand,
  evaluateFileWrite,
  evaluateShellCommandText,
  GitWorktreeService,
  isInsidePath,
} from "../src";

test("requires approval for dangerous commands", () => {
  expect(
    evaluateCommand({
      command: ["rm", "-rf", "src"],
      cwd: "/repo",
      workspacePath: "/repo",
    }).action,
  ).toBe("ask");

  expect(
    evaluateCommand({
      command: ["git", "reset", "--hard"],
      cwd: "/repo",
      workspacePath: "/repo",
    }).riskLevel,
  ).toBe("critical");

  expect(
    evaluateCommand({
      command: ["pnpm", "add", "react"],
      cwd: "/repo",
      workspacePath: "/repo",
    }).action,
  ).toBe("ask");
});

test("denies commands and writes outside the workspace", () => {
  expect(
    evaluateCommand({
      command: ["ls"],
      cwd: "/tmp",
      workspacePath: "/repo",
    }).action,
  ).toBe("deny");

  expect(
    evaluateFileWrite({
      filePath: "/repo/src/index.ts",
      workspacePath: "/repo",
    }).action,
  ).toBe("allow");

  expect(
    evaluateFileWrite({
      filePath: "/etc/passwd",
      workspacePath: "/repo",
    }).action,
  ).toBe("deny");
});

test("evaluates compound shell commands conservatively", () => {
  expect(
    evaluateShellCommandText({
      command: "echo ok && rm -rf src",
      cwd: "/repo",
      workspacePath: "/repo",
    }).action,
  ).toBe("ask");

  expect(
    evaluateShellCommandText({
      command: "NODE_ENV=test bun test | tee out.log",
      cwd: "/repo",
      workspacePath: "/repo",
    }).action,
  ).toBe("allow");
});

test("builds stable worktree plans", () => {
  const plan = createWorktreePlan("/repo", "thread:123");
  expect(plan.worktreePath).toBe("/repo/.eco/worktrees/thread-123");
  expect(plan.branchName).toBe("eco/thread-123");
});

test("checks path containment safely", () => {
  expect(isInsidePath("/repo/src/file.ts", "/repo")).toBe(true);
  expect(isInsidePath("/repo-other/file.ts", "/repo")).toBe(false);
});

test("creates a git worktree through an injectable runner", async () => {
  const calls: string[][] = [];
  const runner: CommandRunner = {
    async run(command) {
      calls.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };

  const service = new GitWorktreeService(runner);
  await service.createWorktree(createWorktreePlan("/repo", "thr_1"));

  expect(calls).toEqual([
    ["git", "rev-parse", "--show-toplevel"],
    ["git", "worktree", "add", "-B", "eco/thr_1", "/repo/.eco/worktrees/thr_1", "HEAD"],
  ]);
});

test("applies approved worktree diffs back to the target workspace", async () => {
  const calls: Array<{ command: string[]; cwd: string; stdin?: string }> = [];
  const runner: CommandRunner = {
    async run(command, cwd, options) {
      calls.push({ command, cwd, stdin: options?.stdin });
      if (command[1] === "diff" && command.includes("--binary")) {
        return { exitCode: 0, stdout: "diff --git a/a.ts b/a.ts\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };

  const service = new GitWorktreeService(runner);
  await service.applyApprovedDiff(createWorktreePlan("/repo", "thr_1"));

  expect(calls).toEqual([
    {
      command: ["git", "diff", "--binary", "HEAD"],
      cwd: "/repo/.eco/worktrees/thr_1",
      stdin: undefined,
    },
    {
      command: ["git", "apply", "--whitespace=nowarn", "-"],
      cwd: "/repo",
      stdin: "diff --git a/a.ts b/a.ts\n",
    },
  ]);
});
