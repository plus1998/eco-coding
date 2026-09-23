import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConversationStore } from "../src/main/conversation-store";
import type { AgentInstanceRecord } from "../src/main/usage-ledger";

test("agent lifecycle, ownership and recovery survive reopen/rebuild without V1", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eco-v2-agent-"));
  const filename = join(dir, "store.sqlite");
  let db = new DatabaseSync(filename);
  try {
    let store = new ConversationStore(db);
    store.initialize();
    store.conversationV2().append({
      conversationId: "thread",
      eventId: "seed",
      type: "noop",
      occurredAt: "2026-09-17T00:00:00Z",
    });
    db.exec("DROP TABLE thread_agent_instances");
    const record: AgentInstanceRecord = {
      threadId: "thread",
      agentId: "agent",
      role: "explore",
      kind: "subagent",
      status: "active",
      runAttemptId: "run",
      parentAgentId: "parent",
      parentToolUseId: "parent-tool",
      missionKey: "",
      todoId: "todo",
      startedAt: "2026-09-17T00:00:00Z",
      updatedAt: "2026-09-17T00:00:01Z",
      metadata: { taskName: "inspect", delegationPrompt: "delegation", custom: { zero: 0 } },
    };
    store.upsertAgentInstance(record);
    expect(store.listAgentInstances("thread")).toEqual([record]);
    const head = store.conversationV2().head("thread").lastSeq;
    store.upsertAgentInstance(record);
    expect(store.conversationV2().head("thread").lastSeq).toBe(head);
    db.close();
    db = new DatabaseSync(filename);
    store = new ConversationStore(db);
    store.conversationV2().rebuildReadModels("thread");
    expect(store.listAgentInstances("thread")).toEqual([record]);
    const stopped = {
      ...record,
      status: "stopped" as const,
      endedAt: "2026-09-17T00:01:00Z",
      updatedAt: "2026-09-17T00:01:00Z",
    };
    store.upsertAgentInstance(stopped);
    store.conversationV2().rebuildReadModels("thread");
    expect(store.listAgentInstances("thread")).toEqual([stopped]);
    expect(store.conversationV2().agentsOf("thread")[0]).toMatchObject({
      status: "stopped",
      mission: "",
      todoId: "todo",
      parentAgentInstanceId: "parent",
      parentToolCallId: "parent-tool",
      delegationPrompt: "delegation",
    });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("delegation text never becomes a mission key during lifecycle updates", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    store.conversationV2().append({
      conversationId: "thread",
      eventId: "seed",
      type: "noop",
      occurredAt: "2026-09-17T00:00:00Z",
    });
    const record: AgentInstanceRecord = {
      threadId: "thread",
      agentId: "agent",
      role: "explore",
      kind: "subagent",
      status: "active",
      startedAt: "2026-09-17T00:00:00Z",
      updatedAt: "2026-09-17T00:00:00Z",
      metadata: { delegationPrompt: "This is content, not a mission identifier" },
    };
    store.upsertAgentInstance(record);
    store.upsertAgentInstance({ ...record, updatedAt: "2026-09-17T00:00:01Z" });
    expect(store.listAgentInstances("thread")[0]?.missionKey).toBeUndefined();
  } finally {
    db.close();
  }
});
