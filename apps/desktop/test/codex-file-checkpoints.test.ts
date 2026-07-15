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
  await execFileAsync("git", ["add", "tracked.txt"], { cwd: workspace });

  const store = new CodexFileCheckpointStore(path.join(root, "checkpoints"));
  await store.capturePending("thread-1", workspace);
  await store.bindPending("thread-1", "item-1");

  await fs.writeFile(path.join(workspace, "tracked.txt"), "after\n");
  await fs.rm(path.join(workspace, "untracked.txt"));
  await fs.writeFile(path.join(workspace, "new.txt"), "new\n");
  await store.restore("thread-1", "item-1", workspace);

  expect(await fs.readFile(path.join(workspace, "tracked.txt"), "utf8")).toBe("before\n");
  expect(await fs.readFile(path.join(workspace, "untracked.txt"), "utf8")).toBe("local\n");
  await expect(fs.access(path.join(workspace, "new.txt"))).rejects.toThrow();
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
