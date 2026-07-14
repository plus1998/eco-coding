import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  codexSpawnPayloadPath,
  codexSpawnRoleQueuePath,
  dequeueCodexSpawnPayloadMatchingSync,
  purgeExpiredCodexSpawnPayloadsSync,
  writeCodexSpawnPayloadSync,
} from "../src/codex-spawn-role-queue";

test("spawn payload consumption is isolated by official tool_use_id", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-queue-"));
  writeCodexSpawnPayloadSync(codexHomeDir, {
    agentRole: "explore",
    message: "inspect the same module",
    toolUseId: "call_explore",
  });
  writeCodexSpawnPayloadSync(codexHomeDir, {
    agentRole: "coder",
    message: "inspect the same module",
    toolUseId: "call_coder",
  });

  expect(dequeueCodexSpawnPayloadMatchingSync(codexHomeDir, { toolUseId: "call_coder" })).toEqual({
    agentRole: "coder",
    message: "inspect the same module",
    toolUseId: "call_coder",
  });
  expect(
    await fs
      .stat(codexSpawnPayloadPath(codexHomeDir, "call_coder"))
      .then(() => true)
      .catch(() => false),
  ).toBe(false);
  expect(await fs.readFile(codexSpawnPayloadPath(codexHomeDir, "call_explore"), "utf8")).toContain(
    "call_explore",
  );
});

test("spawn payload matching refuses text-only attribution and preserves every call file", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-queue-exact-"));
  writeCodexSpawnPayloadSync(codexHomeDir, {
    agentRole: "explore",
    taskName: "same_task",
    toolUseId: "call_a",
  });
  writeCodexSpawnPayloadSync(codexHomeDir, {
    agentRole: "coder",
    taskName: "same_task",
    toolUseId: "call_b",
  });

  expect(dequeueCodexSpawnPayloadMatchingSync(codexHomeDir, {})).toBeUndefined();
  expect((await fs.readdir(codexSpawnRoleQueuePath(codexHomeDir))).sort()).toHaveLength(2);
});

test("spawn payload queue purges failed-call leftovers after the TTL", async () => {
  const codexHomeDir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-spawn-queue-stale-"));
  writeCodexSpawnPayloadSync(codexHomeDir, { agentRole: "explore", toolUseId: "call_stale" }, 1_000);
  writeCodexSpawnPayloadSync(codexHomeDir, { agentRole: "coder", toolUseId: "call_fresh" }, 3_601_001);

  expect(purgeExpiredCodexSpawnPayloadsSync(codexHomeDir, 3_601_001)).toBe(1);
  expect(await fs.readdir(codexSpawnRoleQueuePath(codexHomeDir))).toHaveLength(1);
});
