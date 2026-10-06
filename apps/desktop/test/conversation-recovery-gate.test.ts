import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { recoverInterruptedPlanCommands } from "../src/main/conversation-plan-command";
import { ConversationRecoveryGate } from "../src/main/conversation-recovery-gate";
import { ConversationStore } from "../src/main/conversation-store";

test("one incomplete lifecycle blocks that conversation and its commands without blocking healthy recovery", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    const v2 = store.conversationV2();
    for (const id of ["old", "healthy"]) v2.ensureConversation(id);
    v2.append({
      conversationId: "old",
      eventId: "old_run",
      runId: "old_run",
      turnId: "old_run",
      type: "run.started",
      occurredAt: "2026-09-17T00:00:00Z",
      payload: { authority: "lifecycle" },
    });
    store.upsertRunAttempt({
      threadId: "healthy",
      attemptId: "new_run",
      phase: "execution",
      retryIndex: 0,
      status: "running",
      startedAt: "2026-09-17T00:00:00Z",
    });
    const gate = new ConversationRecoveryGate();
    expect([
      ...gate
        .inspect(["old", "healthy", "unmigrated"], (id) => {
          store.listRunAttempts(id);
          store.listAgentInstances(id);
        })
        .keys(),
    ]).toEqual(["old", "unmigrated"]);
    expect(() => gate.assertReady("old")).toThrow(/recovery metadata/);
    expect(() => gate.assertReady("healthy")).not.toThrow();
    for (const id of ["old", "healthy"]) {
      v2.acceptCommand({
        principalId: "user",
        conversationId: id,
        clientCommandId: "plan",
        commandType: "plan.resolve",
        request: { resolution: "approve", input: {}, context: {} },
        expectedHistoryRevision: 0,
      });
      v2.beginCommandExecution("user", id, "plan");
    }
    expect(
      recoverInterruptedPlanCommands(v2, () => undefined, {
        isConversationBlocked: (id) => gate.isBlocked(id),
        listRunAttempts: (id) => store.listRunAttempts(id),
      }),
    ).toEqual({ completed: 0, failed: 1 });
    expect(v2.getCommandJob("user", "old", "plan")?.status).toBe("running");
    expect(v2.getCommandJob("user", "healthy", "plan")?.status).toBe("failed");
    // A new preflight after explicit migration can remove the block; merely catching
    // the exception or retrying the command does not do so.
    v2.append({
      conversationId: "old",
      eventId: "migrated_run",
      runId: "old_run",
      turnId: "old_run",
      type: "run.started",
      occurredAt: "2026-09-17T00:00:00Z",
      payload: { authority: "lifecycle", phase: "execution", retryIndex: 0 },
    });
    gate.inspect(["old", "healthy"], (id) => {
      store.listRunAttempts(id);
    });
    expect(() => gate.assertReady("old")).not.toThrow();
  } finally {
    db.close();
  }
});
