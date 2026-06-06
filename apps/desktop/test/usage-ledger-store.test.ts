import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createConversationStore } from "../src/main/conversation-store";
import { buildUsageLedgerEventKey, type UsageLedgerEvent } from "../src/main/usage-ledger";
import type { ThreadSummary } from "../src/shared/ipc";

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
    id: "thr_usage_ledger_store",
    title: "Ledger",
    prompt: "hello",
    workspacePath: "/tmp/project",
    status: "idle",
    message: "ok",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeEvent(): UsageLedgerEvent {
  return {
    id: "ule_evt_1",
    idempotencyKey: buildUsageLedgerEventKey({
      threadId: "thr_usage_ledger_store",
      source: "sdk",
      sourceEventId: "sdk-result:evt_1",
      usageKind: "request_final",
      modelId: "claude-test",
      agentId: "agent_coder_a",
    }),
    threadId: "thr_usage_ledger_store",
    runAttemptId: "attempt_1",
    agentId: "agent_coder_a",
    parentToolUseId: "toolu_agent_a",
    source: "sdk",
    sourceEventId: "sdk-result:evt_1",
    requestKey: "sdk-result:evt_1",
    sdkMessageId: "msg_1",
    usageKind: "request_final",
    role: "coder",
    modelId: "claude-test",
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 50,
    cacheCreationTokens: 10,
    reportedCostUsd: 0.03,
    attribution: { status: "attributed", agentId: "agent_coder_a" },
    metadata: { path: "sdk.result" },
    observedAt: "2026-01-01T00:00:01.000Z",
  };
}

test.skipIf(!sqliteAvailable)("conversation store persists usage ledger records idempotently", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-usage-ledger-"));
  const store = await createConversationStore(path.join(dir, "eco.sqlite"));
  store.saveThread(makeThread());

  store.upsertRunAttempt({
    threadId: "thr_usage_ledger_store",
    attemptId: "attempt_1",
    phase: "execution",
    retryIndex: 0,
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    metadata: { reason: "test" },
  });
  store.upsertAgentInstance({
    threadId: "thr_usage_ledger_store",
    agentId: "agent_coder_a",
    role: "coder",
    kind: "subagent",
    status: "active",
    runAttemptId: "attempt_1",
    parentAgentId: "planner_session",
    parentToolUseId: "toolu_agent_a",
    todoId: "todo-1",
    startedAt: "2026-01-01T00:00:00.500Z",
    updatedAt: "2026-01-01T00:00:00.500Z",
  });

  const event = makeEvent();
  expect(store.appendUsageLedgerEvent(event)).toBe(true);
  expect(store.appendUsageLedgerEvent({ ...event, id: "ule_evt_duplicate" })).toBe(false);

  const attempts = store.listRunAttempts("thr_usage_ledger_store");
  const agents = store.listAgentInstances("thr_usage_ledger_store");
  const events = store.listUsageLedgerEvents("thr_usage_ledger_store");

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.metadata?.reason).toBe("test");
  expect(agents[0]?.parentToolUseId).toBe("toolu_agent_a");
  expect(agents[0]?.todoId).toBe("todo-1");
  expect(events).toHaveLength(1);
  expect(events[0]?.id).toBe("ule_evt_1");
  expect(events[0]?.attribution).toEqual({ status: "attributed", agentId: "agent_coder_a" });
  expect(events[0]?.metadata?.path).toBe("sdk.result");
});
