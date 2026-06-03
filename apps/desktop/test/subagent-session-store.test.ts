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
