import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { CodexFileCheckpointStore } from "../src/main/codex-file-checkpoints";

const execFileAsync = promisify(execFile);

test("Codex file checkpoints restore tracked and untracked worktree state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-checkpoint-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  await execFileAsync("git", ["init", "-q"], { cwd: workspace });
  await fs.writeFile(path.join(workspace, "tracked.txt"), "before\n");
  await fs.writeFile(path.join(workspace, "untracked.txt"), "local\n");
  await fs.writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n");
  await fs.writeFile(path.join(workspace, "ignored.txt"), "ignored-before\n");
  await execFileAsync("git", ["add", "tracked.txt", ".gitignore"], { cwd: workspace });

  const store = new CodexFileCheckpointStore(path.join(root, "checkpoints"));
  await store.capturePending("thread-1", workspace);
  expect(await store.hasPending("thread-1")).toBe(true);
  await store.bindPending("thread-1", "item-1");
  expect(await store.hasPending("thread-1")).toBe(false);

  await fs.writeFile(path.join(workspace, "tracked.txt"), "after\n");
  await fs.rm(path.join(workspace, "untracked.txt"));
  await fs.writeFile(path.join(workspace, "new.txt"), "new\n");
  await fs.writeFile(path.join(workspace, "ignored.txt"), "ignored-after\n");
  await store.restore("thread-1", "item-1", workspace);

  expect(await fs.readFile(path.join(workspace, "tracked.txt"), "utf8")).toBe("before\n");
  expect(await fs.readFile(path.join(workspace, "untracked.txt"), "utf8")).toBe("local\n");
  expect(await fs.readFile(path.join(workspace, "ignored.txt"), "utf8")).toBe("ignored-after\n");
  await expect(fs.access(path.join(workspace, "new.txt"))).rejects.toThrow();
});

test("Codex recovery snapshots restore the pre-fork workspace and are removable", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-recovery-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  await execFileAsync("git", ["init", "-q"], { cwd: workspace });
  await fs.writeFile(path.join(workspace, "state.txt"), "before\n");
  await execFileAsync("git", ["add", "state.txt"], { cwd: workspace });

  const store = new CodexFileCheckpointStore(path.join(root, "checkpoints"));
  await store.captureRecovery("thread-recovery", workspace, "recovery-1");
  await fs.writeFile(path.join(workspace, "state.txt"), "forked\n");
  await store.restoreRecovery("thread-recovery", workspace, "recovery-1");

  expect(await fs.readFile(path.join(workspace, "state.txt"), "utf8")).toBe("before\n");
  await expect(
    fs.access(path.join(root, "checkpoints", "thread-recovery", "recovery", "recovery-1")),
  ).resolves.toBeNull();
  await store.deleteRecovery("thread-recovery", "recovery-1");
  await expect(
    fs.access(path.join(root, "checkpoints", "thread-recovery", "recovery", "recovery-1")),
  ).rejects.toThrow();
});

test("Codex file checkpoints restore non-Git workspaces", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eco-codex-checkpoint-plain-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(path.join(workspace, "nested"), { recursive: true });
  await fs.writeFile(path.join(workspace, "nested", "before.txt"), "before");
  const store = new CodexFileCheckpointStore(path.join(root, "checkpoints"));
  await store.capturePending("thread-plain", workspace);
  await store.bindPending("thread-plain", "item-plain");
  await fs.writeFile(path.join(workspace, "nested", "before.txt"), "after");
  await fs.writeFile(path.join(workspace, "new.txt"), "new");
  await store.restore("thread-plain", "item-plain", workspace);
  expect(await fs.readFile(path.join(workspace, "nested", "before.txt"), "utf8")).toBe("before");
  await expect(fs.access(path.join(workspace, "new.txt"))).rejects.toThrow();
});
