import { expect, test } from "bun:test";
import {
  createWorktreePlan,
  evaluateCommand,
  evaluateFileWrite,
  GitWorktreeService,
  isInsidePath,
  type CommandRunner,
} from "../src";

test("requires approval for dangerous commands", () => {
  expect(evaluateCommand({
    command: ["rm", "-rf", "src"],
    cwd: "/repo",
    workspacePath: "/repo",
  }).action).toBe("ask");

  expect(evaluateCommand({
    command: ["git", "reset", "--hard"],
    cwd: "/repo",
    workspacePath: "/repo",
  }).riskLevel).toBe("critical");

  expect(evaluateCommand({
    command: ["pnpm", "add", "react"],
    cwd: "/repo",
    workspacePath: "/repo",
  }).action).toBe("ask");
});

test("denies commands and writes outside the workspace", () => {
  expect(evaluateCommand({
    command: ["ls"],
    cwd: "/tmp",
    workspacePath: "/repo",
  }).action).toBe("deny");

  expect(evaluateFileWrite({
    filePath: "/repo/src/index.ts",
    workspacePath: "/repo",
  }).action).toBe("allow");

  expect(evaluateFileWrite({
    filePath: "/etc/passwd",
    workspacePath: "/repo",
  }).action).toBe("deny");
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
