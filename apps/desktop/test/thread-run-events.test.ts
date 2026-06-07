import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore } from "../src/main/conversation-store";
import type { ThreadRunEventInput, ThreadSummary } from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

function makeThread(): ThreadSummary {
  return {
    id: "thr_run_events",
    title: "Run events",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeEvent(input: Partial<ThreadRunEventInput> = {}): ThreadRunEventInput {
  return {
    id: "tre_evt_1",
    threadId: "thr_run_events",
    eventType: "message.delta",
    scope: "agent",
    role: "coder",
    agentId: "agent_coder_a",
    runAttemptId: "attempt_1",
    requestId: "req_1",
    streamKey: "thr_run_events:agent_coder_a:coder",
    streamState: "streaming",
    message: "Reading package.json",
    metadata: { source: "sdk" },
    observedAt: "2026-01-01T00:00:01.000Z",
    ...input,
  };
}

test.skipIf(!sqliteAvailable)("conversation store persists thread run events in sequence order", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-thread-run-events-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  store.saveThread(makeThread());

  const first = store.appendThreadRunEvent(makeEvent());
  const second = store.appendThreadRunEvent(
    makeEvent({
      id: "tre_evt_2",
      eventType: "request.first_token",
      scope: "agent",
      streamState: "none",
      message: "first token",
      observedAt: "2026-01-01T00:00:02.000Z",
    }),
  );
  const duplicate = store.appendThreadRunEvent(
    makeEvent({ id: "tre_evt_1", message: "should not overwrite" }),
  );

  expect(first.sequence).toBe(1);
  expect(second.sequence).toBe(2);
  expect(duplicate.message).toBe("Reading package.json");

  const events = store.listThreadRunEvents("thr_run_events");
  expect(events.map((event) => event.id)).toEqual(["tre_evt_1", "tre_evt_2"]);
  expect(events[0]?.agentId).toBe("agent_coder_a");
  expect(events[0]?.metadata?.source).toBe("sdk");
});

test.skipIf(!sqliteAvailable)("conversation store upgrades duplicate tool events with richer metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-thread-run-events-upgrade-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  store.saveThread(makeThread());

  const generic = store.appendThreadRunEvent(
    makeEvent({
      id: "tre_tool_1",
      eventType: "tool.started",
      scope: "main",
      streamState: "streaming",
      message: "Tool: Skill",
      metadata: { tool: { name: "Skill", toolUseId: "toolu_skill" } },
    }),
  );
  const detailed = store.appendThreadRunEvent(
    makeEvent({
      id: "tre_tool_1",
      eventType: "tool.started",
      scope: "main",
      streamState: "streaming",
      message: "Tool: Skill · frontend-design 技能",
      metadata: {
        tool: {
          name: "Skill",
          detail: "frontend-design 技能",
          toolUseId: "toolu_skill",
        },
      },
    }),
  );

  expect(detailed.sequence).toBe(generic.sequence);
  expect(detailed.message).toBe("Tool: Skill · frontend-design 技能");

  const events = store.listThreadRunEvents("thr_run_events");
  expect(events).toHaveLength(1);
  expect(events[0]?.message).toBe("Tool: Skill · frontend-design 技能");
  expect((events[0]?.metadata?.tool as { detail?: string } | undefined)?.detail).toBe(
    "frontend-design 技能",
  );
});

test.skipIf(!sqliteAvailable)("conversation store tolerates malformed thread run event metadata", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-thread-run-events-bad-json-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  store.saveThread(makeThread());
  store.appendThreadRunEvent(makeEvent());

  const db = (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void } } }).db;
  db.prepare(`UPDATE thread_run_events SET metadata_json = ? WHERE id = ?`).run("{bad json", "tre_evt_1");

  const events = store.listThreadRunEvents("thr_run_events");
  expect(events).toHaveLength(1);
  expect(events[0]?.metadata).toBeUndefined();
});

test.skipIf(!sqliteAvailable)("conversation store clears thread run events by thread", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-thread-run-events-clear-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  store.saveThread(makeThread());
  store.appendThreadRunEvent(makeEvent());

  store.clearThreadRunEvents("thr_run_events");
  expect(store.listThreadRunEvents("thr_run_events")).toEqual([]);
  expect(store.appendThreadRunEvent(makeEvent({ id: "tre_evt_after_clear" })).sequence).toBe(1);
});
