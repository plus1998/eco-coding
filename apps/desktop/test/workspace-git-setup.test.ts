import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_ECO_GITIGNORE_LINES,
  ensureEcoGitignore,
  type GitCommandRunner,
  prepareWorkspaceGit,
} from "../src/main/workspace-git-setup";
import { inspectWorkspace, resolveGitExecutable } from "../src/main/workspace-inspect";

function createRunner(): GitCommandRunner {
  return async (command, cwd) => {
    const executable = command[0] === "git" ? resolveGitExecutable() : command[0]!;
    try {
      const stdout = execFileSync(executable, command.slice(1), { cwd, encoding: "utf8" });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (error) {
      const failed = error as NodeJS.ErrnoException & {
        status?: number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
      return {
        exitCode: typeof failed.status === "number" ? failed.status : 1,
        stdout: String(failed.stdout ?? ""),
        stderr: String(failed.stderr ?? failed.message ?? ""),
      };
    }
  };
}

test("ensureEcoGitignore creates default ignore file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-gitignore-"));
  const created = await ensureEcoGitignore(root);
  expect(created).toBe(true);
  const contents = await fs.readFile(path.join(root, ".gitignore"), "utf8");
  for (const line of DEFAULT_ECO_GITIGNORE_LINES) {
    expect(contents).toContain(line);
  }
});

test("prepareWorkspaceGit initializes empty folder with initial commit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-prepare-empty-"));
  const run = createRunner();

  const info = await prepareWorkspaceGit(root, run);
  expect(info.isGitRepository).toBe(true);
  expect(info.hasGitCommits).toBe(true);
  expect(info.branch).toBe("main");

  const reinspect = await inspectWorkspace(root);
  expect(reinspect.hasGitCommits).toBe(true);
});

test("prepareWorkspaceGit creates allow-empty commit for git init only repo", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-prepare-unborn-"));
  execFileSync(resolveGitExecutable(), ["init", "-b", "main"], { cwd: root });
  const run = createRunner();

  const info = await prepareWorkspaceGit(root, run);
  expect(info.hasGitCommits).toBe(true);
});

test("prepareWorkspaceGit is idempotent when repo already has commits", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-prepare-ready-"));
  const run = createRunner();
  execFileSync(resolveGitExecutable(), ["init", "-b", "main"], { cwd: root });
  await fs.writeFile(path.join(root, "README.md"), "# ok\n");
  execFileSync(resolveGitExecutable(), ["add", "README.md"], { cwd: root });
  execFileSync(resolveGitExecutable(), ["commit", "-m", "seed"], { cwd: root });

  const info = await prepareWorkspaceGit(root, run);
  expect(info.hasGitCommits).toBe(true);
  expect(info.branch).toBe("main");
});
