import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { encodeClaudeProjectDirName, isEcoClaudeProjectDirName } from "../src/main/claude-session-paths";
import { buildStorageUsageSnapshot, measurePathBytes } from "../src/main/storage-inventory";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-storage-inventory-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("measurePathBytes sums files without following symlinks", async () => {
  const root = path.join(tempDir, "root");
  await fs.mkdir(path.join(root, "nested"), { recursive: true });
  await fs.writeFile(path.join(root, "a.txt"), "12345");
  await fs.writeFile(path.join(root, "nested", "b.txt"), "hello");
  const outside = path.join(tempDir, "outside.txt");
  await fs.writeFile(outside, "XXXXXXXX");
  await fs.symlink(outside, path.join(root, "link.txt"));

  const measured = await measurePathBytes(root);
  expect(measured.exists).toBe(true);
  expect(measured.fileCount).toBe(2);
  expect(measured.bytes).toBe(5 + 5);
});

test("encodeClaudeProjectDirName matches Claude projects folder style", () => {
  expect(encodeClaudeProjectDirName("/Users/me/repo")).toBe("-Users-me-repo");
  expect(isEcoClaudeProjectDirName("-Users-me-repo--eco-worktrees-thr-1")).toBe(true);
  expect(isEcoClaudeProjectDirName("-Users-me-other-project")).toBe(false);
});

test("buildStorageUsageSnapshot meters Claude projects + file-history JSONL", async () => {
  const userDataDir = path.join(tempDir, "userData");
  const logsDir = path.join(tempDir, "logs");
  const dbPath = path.join(userDataDir, "eco-coding.sqlite");
  const checkpointsDir = path.join(userDataDir, "codex-file-checkpoints");
  const codexHomeDir = path.join(userDataDir, "codex");
  const claudeProjectsDir = path.join(tempDir, "claude-projects");
  const claudeFileHistoryDir = path.join(tempDir, "claude-file-history");

  await fs.mkdir(path.join(checkpointsDir, "thr_1", "items"), { recursive: true });
  await fs.mkdir(path.join(codexHomeDir, "eco-pending-spawns"), { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(path.join(claudeProjectsDir, "proj-a"), { recursive: true });
  await fs.mkdir(claudeFileHistoryDir, { recursive: true });

  await fs.writeFile(dbPath, "A".repeat(100));
  await fs.writeFile(`${dbPath}-wal`, "B".repeat(20));
  await fs.writeFile(path.join(logsDir, "upstream-2026-01-01.log"), "C".repeat(30));
  await fs.writeFile(path.join(checkpointsDir, "thr_1", "items", "x.bin"), "D".repeat(40));
  await fs.writeFile(path.join(codexHomeDir, "config.toml"), "E".repeat(15));
  await fs.writeFile(path.join(userDataDir, "models-dev-pricing.json"), "F".repeat(25));
  await fs.writeFile(path.join(claudeProjectsDir, "proj-a", "session-1.jsonl"), "J".repeat(50));
  await fs.writeFile(path.join(claudeFileHistoryDir, "snap1"), "H".repeat(12));

  const piAgentDir = path.join(userDataDir, "pi-agent");
  await fs.mkdir(path.join(piAgentDir, "thr_pi", "sessions"), { recursive: true });
  await fs.writeFile(path.join(piAgentDir, "thr_pi", "sessions", "s.jsonl"), "P".repeat(18));

  const snapshot = await buildStorageUsageSnapshot({
    paths: {
      userDataDir,
      databasePath: dbPath,
      codexCheckpointsDir: checkpointsDir,
      logsDir,
      codexHomeDir,
      claudeProjectsDir,
      claudeFileHistoryDir,
      piAgentDir,
    },
    threadCount: 3,
  });

  expect(snapshot.unmetered).toEqual([]);
  expect(snapshot.categories).toHaveLength(7);

  const byId = Object.fromEntries(snapshot.categories.map((category) => [category.id, category]));
  expect(byId.database?.bytes).toBe(120);
  expect(byId.logs?.bytes).toBe(30);
  expect(byId.claudeSessions?.bytes).toBe(50 + 12);
  expect(byId.claudeSessions?.path).toBe(claudeProjectsDir);
  expect(byId.codexCheckpoints?.bytes).toBe(40);
  expect(byId.codexHome?.bytes).toBe(15);
  expect(byId.piAgent?.bytes).toBe(18);
  expect(byId.piAgent?.path).toBe(piAgentDir);
  expect(byId.otherUserData?.bytes).toBe(25);
  expect(snapshot.totalBytes).toBe(120 + 30 + 62 + 40 + 15 + 18 + 25);
});
