import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore } from "../src/main/conversation-store";
import { resolveResumeAgentIdFromRecords } from "../src/main/subagent-session-resolve";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

test("resolveResumeAgentIdFromRecords prefers coder todo match", () => {
  const agentId = resolveResumeAgentIdFromRecords(
    [
      {
        threadId: "thr_1",
        role: "coder",
        agentId: "coder-a",
        phase: "execution",
        status: "stopped",
        todoId: "todo-1",
        missionKey: "implement api",
        startedAt: "2026-01-02T00:00:00.000Z",
        lastActiveAt: "2026-01-02T00:00:00.000Z",
        accumulatedMs: 0,
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        threadId: "thr_1",
        role: "coder",
        agentId: "coder-b",
        phase: "execution",
        status: "stopped",
        todoId: "todo-2",
        missionKey: "fix tests",
        startedAt: "2026-01-03T00:00:00.000Z",
        lastActiveAt: "2026-01-03T00:00:00.000Z",
        accumulatedMs: 0,
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ],
    {
      role: "coder",
      phase: "execution",
      prompt: "Implement API endpoints",
      todoIdHint: "todo-1",
      freshRequest: false,
    },
  );
  expect(agentId).toBe("coder-a");
});

test.skipIf(!sqliteAvailable)("conversation store persists and resolves reviewer resume", async () => {
  const dbPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "eco-subagent-")),
    "test.sqlite",
  );
  const store = await createConversationStore(dbPath);
  store.saveThread({
    id: "thr_sub",
    title: "t",
    prompt: "p",
    workspacePath: "/tmp/ws",
    status: "running",
    message: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  store.upsertSubagentSessionActive({
    threadId: "thr_sub",
    role: "reviewer",
    agentId: "rev-uuid",
    phase: "execution",
  });
  store.markSubagentSessionStopped("thr_sub", "rev-uuid");

  expect(
    store.resolveResumeAgentId({
      threadId: "thr_sub",
      role: "reviewer",
      phase: "execution",
      prompt: "Second review pass",
    }),
  ).toBe("rev-uuid");

  store.clearSubagentSessions("thr_sub");
  expect(store.listSubagentSessions("thr_sub")).toHaveLength(0);
});

test.skipIf(!sqliteAvailable)("persists subagent session timing on stop and resume", async () => {
  const dbPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "eco-subagent-timing-")),
    "test.sqlite",
  );
  const store = await createConversationStore(dbPath);
  store.saveThread({
    id: "thr_timing",
    title: "t",
    prompt: "p",
    workspacePath: "/tmp/ws",
    status: "running",
    message: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  store.upsertSubagentSessionActive({
    threadId: "thr_timing",
    role: "coder",
    agentId: "coder-timing",
    phase: "execution",
  });

  let row = store.listSubagentSessions("thr_timing")[0];
  expect(row?.status).toBe("active");
  expect(row?.startedAt).toBeTruthy();
  expect(row?.lastActiveAt).toBeTruthy();
  expect(row?.accumulatedMs).toBe(0);

  await Bun.sleep(40);
  store.markSubagentSessionStopped("thr_timing", "coder-timing");

  row = store.listSubagentSessions("thr_timing")[0];
  expect(row?.status).toBe("stopped");
  expect(row?.endedAt).toBeTruthy();
  expect(row?.accumulatedMs).toBeGreaterThanOrEqual(30);

  const accumulatedAfterStop = row?.accumulatedMs ?? 0;
  const startedAt = row?.startedAt;

  store.upsertSubagentSessionActive({
    threadId: "thr_timing",
    role: "coder",
    agentId: "coder-timing",
    phase: "execution",
  });

  row = store.listSubagentSessions("thr_timing")[0];
  expect(row?.status).toBe("active");
  expect(row?.endedAt).toBeUndefined();
  expect(row?.accumulatedMs).toBe(accumulatedAfterStop);
  expect(row?.startedAt).toBe(startedAt);
});
