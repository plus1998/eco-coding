import { afterEach, beforeEach, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  clearPiSessionFiles,
  ensurePiSessionsDir,
  findPiSessionFile,
  isUsablePiSessionFile,
  removePiAgentThreadDir,
  resolvePiAgentDir,
  resolvePiAgentRoot,
  resolvePiSessionsDir,
} from "../src/pi-session-paths";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-pi-session-paths-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("resolvePiAgentDir nests under ecoDataDir/pi-agent/<threadId>", () => {
  const agentDir = resolvePiAgentDir(tempDir, "thr_abc");
  expect(agentDir).toBe(path.join(tempDir, "pi-agent", "thr_abc"));
  expect(resolvePiSessionsDir(agentDir)).toBe(
    path.join(tempDir, "pi-agent", "thr_abc", "sessions"),
  );
  expect(resolvePiAgentRoot(tempDir)).toBe(path.join(tempDir, "pi-agent"));
});

test("resolvePiAgentDir rejects path traversal thread ids", () => {
  expect(() => resolvePiAgentDir(tempDir, "../escape")).toThrow(/Invalid PI threadId/);
  expect(() => resolvePiAgentDir(tempDir, "a/b")).toThrow(/Invalid PI threadId/);
});

test("ensurePiSessionsDir + clearPiSessionFiles + findPiSessionFile", async () => {
  const agentDir = resolvePiAgentDir(tempDir, "thr_1");
  const sessionsDir = await ensurePiSessionsDir(agentDir);
  const older = path.join(sessionsDir, "2020-01-01T00-00-00-000Z_sess_old.jsonl");
  const newer = path.join(sessionsDir, "2026-01-01T00-00-00-000Z_sess_new.jsonl");
  await fs.writeFile(older, '{"type":"session"}\n');
  await fs.writeFile(newer, '{"type":"session"}\n');
  await fs.writeFile(path.join(sessionsDir, "notes.txt"), "keep");

  expect(await findPiSessionFile(sessionsDir, "sess_new")).toBe(newer);
  expect(await isUsablePiSessionFile(newer, sessionsDir)).toBe(true);
  expect(await isUsablePiSessionFile(path.join(tempDir, "outside.jsonl"), sessionsDir)).toBe(
    false,
  );

  expect(await clearPiSessionFiles(agentDir)).toBe(2);
  expect(await fs.readdir(sessionsDir)).toEqual(["notes.txt"]);
});

test("removePiAgentThreadDir deletes the whole thread tree", async () => {
  const agentDir = resolvePiAgentDir(tempDir, "thr_rm");
  await ensurePiSessionsDir(agentDir);
  await fs.writeFile(path.join(agentDir, "auth.json"), "{}");
  expect(await removePiAgentThreadDir(tempDir, "thr_rm")).toBe(true);
  await expect(fs.lstat(agentDir)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await removePiAgentThreadDir(tempDir, "thr_rm")).toBe(false);
});
