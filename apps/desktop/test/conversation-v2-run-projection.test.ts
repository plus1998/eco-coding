import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConversationStore, createConversationStore } from "../src/main/conversation-store";
import type { RunAttemptRecord } from "../src/main/usage-ledger";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

async function createTempStore(): Promise<ConversationStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-v2-run-projection-"));
  const store = await createConversationStore(path.join(dir, "eco-coding.sqlite"));
  store.saveThread({
    id: "thr_run_projection",
    title: "Run projection",
    prompt: "run",
    workspacePath: "/tmp/project",
    status: "running",
    message: "running",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  });
  return store;
}

function attempt(overrides: Partial<RunAttemptRecord> & Pick<RunAttemptRecord, "status">): RunAttemptRecord {
  return {
    threadId: "thr_run_projection",
    attemptId: "attempt_execution_0_1750000000000_1",
    phase: "execution",
    retryIndex: 0,
    startedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test.skipIf(!sqliteAvailable)(
  "projects run attempt transitions onto V2 runs so the feed and the run state share one clock",
  async () => {
    const store = await createTempStore();
    const v2 = store.conversationV2();
    const started = attempt({ status: "running" });

    store.upsertRunAttempt(started);
    expect(v2.bootstrap(started.threadId).runs).toMatchObject([
      {
        runId: started.attemptId,
        turnId: started.attemptId,
        status: "running",
        startedAt: started.startedAt,
        timingQuality: "recorded",
      },
    ]);

    // Replaying the same in-flight attempt is idempotent (rehydrate paths).
    const seqAfterStart = v2.head(started.threadId).lastSeq;
    store.upsertRunAttempt(started);
    expect(v2.head(started.threadId).lastSeq).toBe(seqAfterStart);

    store.upsertRunAttempt(
      attempt({
        status: "completed",
        endedAt: "2026-08-01T00:00:12.000Z",
      }),
    );
    const [run] = v2.bootstrap(started.threadId).runs;
    expect(run).toMatchObject({
      runId: started.attemptId,
      status: "completed",
      startedAt: started.startedAt,
      endedAt: "2026-08-01T00:00:12.000Z",
    });
    expect(v2.bootstrap(started.threadId).runs).toHaveLength(1);

    // Replaying the terminal transition must not append a second event.
    const seqAfterCompletion = v2.head(started.threadId).lastSeq;
    store.upsertRunAttempt(
      attempt({
        status: "completed",
        endedAt: "2026-08-01T00:00:12.000Z",
      }),
    );
    expect(v2.head(started.threadId).lastSeq).toBe(seqAfterCompletion);
    expect(v2.validateIntegrity(started.threadId).effectCount).toBe(seqAfterCompletion);
  },
);

test.skipIf(!sqliteAvailable)(
  "reconciles every migrated run from the legacy attempt ledger without creating unmigrated streams",
  () => {
    const db = new DatabaseSync(":memory:");
    try {
      const store = new ConversationStore(db);
      store.initialize();
      store.saveThread({
        id: "thr_reconcile_runs",
        title: "Reconcile",
        prompt: "run",
        workspacePath: "/tmp/project",
        status: "running",
        message: "running",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      store.conversationV2().ensureConversation("thr_reconcile_runs");
      db.prepare(
        `INSERT INTO thread_run_attempts
         (thread_id, attempt_id, phase, retry_index, status, started_at, ended_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "thr_reconcile_runs",
        "attempt_missing",
        "execution",
        0,
        "running",
        "2026-08-01T00:00:01.000Z",
        null,
        JSON.stringify({ source: "legacy" }),
      );
      db.prepare(
        `INSERT INTO thread_run_attempts
         (thread_id, attempt_id, phase, retry_index, status, started_at, ended_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "thr_reconcile_runs",
        "attempt_corrected",
        "execution",
        1,
        "failed",
        "2026-08-01T00:00:02.000Z",
        "2026-08-01T00:00:05.000Z",
        JSON.stringify({ source: "legacy", retry: 1 }),
      );
      store.conversationV2().append({
        conversationId: "thr_reconcile_runs",
        eventId: "wrong_lifecycle",
        sourceEventKey: "legacy:wrong_lifecycle",
        type: "run.completed",
        occurredAt: "2026-08-01T00:00:03.000Z",
        turnId: "attempt_corrected",
        runId: "attempt_corrected",
        payload: {
          authority: "lifecycle",
          phase: "execution",
          retryIndex: 1,
          metadata: { source: "legacy", retry: 1 },
          status: "completed",
          timingQuality: "recorded",
          startedAt: "2026-08-01T00:00:02.000Z",
          endedAt: "2026-08-01T00:00:03.000Z",
        },
      });

      expect(store.reconcileConversationV2Runs("thr_reconcile_runs")).toEqual({
        scanned: 2,
        repaired: 2,
      });
      expect(store.listRunAttempts("thr_reconcile_runs")).toEqual([
        {
          threadId: "thr_reconcile_runs",
          attemptId: "attempt_missing",
          phase: "execution",
          retryIndex: 0,
          status: "running",
          startedAt: "2026-08-01T00:00:01.000Z",
          metadata: { source: "legacy" },
        },
        {
          threadId: "thr_reconcile_runs",
          attemptId: "attempt_corrected",
          phase: "execution",
          retryIndex: 1,
          status: "failed",
          startedAt: "2026-08-01T00:00:02.000Z",
          endedAt: "2026-08-01T00:00:05.000Z",
          metadata: { source: "legacy", retry: 1 },
        },
      ]);
      expect(
        store
          .conversationV2()
          .bootstrap("thr_reconcile_runs")
          .runs.sort((left, right) => left.runId.localeCompare(right.runId)),
      ).toMatchObject([
        { runId: "attempt_corrected", status: "failed", endedAt: "2026-08-01T00:00:05.000Z" },
        { runId: "attempt_missing", status: "running" },
      ]);
      expect(store.reconcileConversationV2Runs("thr_reconcile_runs")).toEqual({
        scanned: 2,
        repaired: 0,
      });
      expect(store.reconcileAllConversationV2Runs()).toEqual({
        conversations: 1,
        scanned: 2,
        repaired: 0,
      });
      const headBeforeInvalidLegacyRow = store.conversationV2().head("thr_reconcile_runs").lastSeq;
      db.prepare(
        `INSERT INTO thread_run_attempts
         (thread_id, attempt_id, phase, retry_index, status, started_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "thr_reconcile_runs",
        "attempt_invalid_metadata",
        "execution",
        0,
        "running",
        "2026-08-01T00:00:07.000Z",
        "not-json",
      );
      expect(() => store.reconcileConversationV2Runs("thr_reconcile_runs")).toThrow(
        /invalid recovery metadata/,
      );
      expect(store.conversationV2().head("thr_reconcile_runs").lastSeq).toBe(headBeforeInvalidLegacyRow);

      db.prepare(
        `INSERT INTO threads
         (id, title, prompt, workspace_path, status, message, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "thr_unmigrated_runs",
        "Unmigrated",
        "run",
        "/tmp/project",
        "running",
        "running",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO thread_run_attempts
         (thread_id, attempt_id, phase, retry_index, status, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "thr_unmigrated_runs",
        "attempt_unmigrated",
        "execution",
        0,
        "running",
        "2026-08-01T00:00:06.000Z",
      );
      expect(store.reconcileConversationV2Runs("thr_unmigrated_runs")).toEqual({
        scanned: 0,
        repaired: 0,
      });
      expect(store.conversationV2().hasConversation("thr_unmigrated_runs")).toBe(false);
    } finally {
      db.close();
    }
  },
);

test.skipIf(!sqliteAvailable)("keeps the legacy run-attempt ledger out of V2-only storage", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-v2-attempt-schema-"));
  const filename = path.join(dir, "store.sqlite");
  try {
    let db = new DatabaseSync(filename);
    let store = new ConversationStore(db);
    store.initialize();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_run_attempts'")
        .get(),
    ).toBeDefined();
    store.switchToV2OnlyStorage();
    expect(store.getConversationStorageMode()).toBe("v2_only");
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_run_attempts'")
        .get(),
    ).toBeUndefined();
    db.close();

    db = new DatabaseSync(filename);
    store = new ConversationStore(db);
    store.initialize();
    expect(store.getConversationStorageMode()).toBe("v2_only");
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'thread_run_attempts'")
        .get(),
    ).toBeUndefined();
    db.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test.skipIf(!sqliteAvailable)(
  "the attempt lifecycle, not the first terminal status, owns a run's outcome",
  async () => {
    const store = await createTempStore();
    const v2 = store.conversationV2();

    store.upsertRunAttempt(attempt({ status: "running" }));
    store.upsertRunAttempt(attempt({ status: "completed", endedAt: "2026-08-01T00:00:12.000Z" }));
    // The interrupted-stream settlement queue can still mark the attempt
    // cancelled afterwards. The attempt table is the authority, so the mirror
    // follows it: keeping the first terminal status here made V2 report a status
    // that no other known record agreed with, and V2-only clients (the mobile
    // Feed) read runs and nothing else.
    store.upsertRunAttempt(attempt({ status: "cancelled", endedAt: "2026-08-01T00:00:13.000Z" }));

    expect(v2.bootstrap("thr_run_projection").runs[0]).toMatchObject({
      status: "cancelled",
      endedAt: "2026-08-01T00:00:13.000Z",
    });
    expect(store.listRunAttempts("thr_run_projection")[0]?.status).toBe("cancelled");
  },
);

test.skipIf(!sqliteAvailable)(
  "corrects the run when the V2 mirror already holds a conflicting terminal status",
  async () => {
    const store = await createTempStore();
    const v2 = store.conversationV2();
    const started = attempt({ status: "running" });
    store.upsertRunAttempt(started);
    // A build that closed a run when one of its tools completed left a bogus
    // terminal run behind while the attempt kept running: 11s instead of the real
    // 15m50s, and `completed` instead of `failed`.
    v2.append({
      conversationId: started.threadId,
      eventId: "bogus_run_completed",
      sourceEventKey: "legacy:thr_run_projection:bogus:run-completed",
      type: "run.completed",
      occurredAt: "2026-08-01T00:00:11.000Z",
      turnId: started.attemptId,
      runId: started.attemptId,
      payload: { status: "completed", timingQuality: "unknown" },
    });

    expect(() =>
      store.upsertRunAttempt(attempt({ status: "failed", endedAt: "2026-08-01T00:15:50.000Z" })),
    ).not.toThrow();
    // The lifecycle settlement corrects the mirror instead of being rejected by
    // it, so both ends now agree on the outcome and its duration.
    expect(v2.bootstrap(started.threadId).runs[0]).toMatchObject({
      status: "failed",
      startedAt: started.startedAt,
      endedAt: "2026-08-01T00:15:50.000Z",
      timingQuality: "recorded",
    });
    expect(store.listRunAttempts(started.threadId)[0]).toMatchObject({
      status: "failed",
      endedAt: "2026-08-01T00:15:50.000Z",
    });
  },
);

test.skipIf(!sqliteAvailable)(
  "rejects a terminal run status written by a source without lifecycle authority",
  async () => {
    const store = await createTempStore();
    const v2 = store.conversationV2();
    const started = attempt({ status: "running" });
    store.upsertRunAttempt(started);
    v2.append({
      conversationId: started.threadId,
      eventId: "legacy_run_failed",
      sourceEventKey: "legacy:thr_run_projection:tool:run-failed",
      type: "run.failed",
      occurredAt: "2026-08-01T00:00:05.000Z",
      turnId: started.attemptId,
      runId: started.attemptId,
      payload: { status: "failed", timingQuality: "unknown" },
    });
    store.upsertRunAttempt(attempt({ status: "completed", endedAt: "2026-08-01T00:00:12.000Z" }));

    // A late duplicate must never rewrite an outcome it did not record.
    expect(() =>
      v2.append({
        conversationId: started.threadId,
        eventId: "legacy_run_cancelled",
        sourceEventKey: "legacy:thr_run_projection:tool:run-cancelled",
        type: "run.cancelled",
        occurredAt: "2026-08-01T00:00:06.000Z",
        turnId: started.attemptId,
        runId: started.attemptId,
        payload: { status: "cancelled", timingQuality: "unknown" },
      }),
    ).toThrow(/conflicting terminal statuses/);
    expect(v2.bootstrap(started.threadId).runs[0]).toMatchObject({
      status: "completed",
      endedAt: "2026-08-01T00:00:12.000Z",
    });
  },
);

test.skipIf(!sqliteAvailable)(
  "lets a lifecycle event reopen a run that the mirror closed early",
  async () => {
    const store = await createTempStore();
    const v2 = store.conversationV2();
    const started = attempt({ status: "running" });
    store.upsertRunAttempt(started);
    v2.append({
      conversationId: started.threadId,
      eventId: "bogus_run_completed_reopen",
      sourceEventKey: "legacy:thr_run_projection:bogus:reopen",
      type: "run.completed",
      occurredAt: "2026-08-01T00:00:11.000Z",
      turnId: started.attemptId,
      runId: started.attemptId,
      payload: { status: "completed", timingQuality: "unknown" },
    });
    v2.append({
      conversationId: started.threadId,
      eventId: "lifecycle_reopen",
      sourceEventKey: "desktop:run-reconciled:reopen",
      type: "run.started",
      occurredAt: started.startedAt,
      turnId: started.attemptId,
      runId: started.attemptId,
      payload: {
        authority: "lifecycle",
        status: "running",
        timingQuality: "recorded",
        startedAt: started.startedAt,
      },
    });

    expect(v2.bootstrap(started.threadId).runs[0]?.status).toBe("running");
    expect(v2.bootstrap(started.threadId).runs[0]?.endedAt).toBeUndefined();
  },
);

test.skipIf(!sqliteAvailable)("records a separate run per retry attempt of the same turn", async () => {
  const store = await createTempStore();
  const v2 = store.conversationV2();

  store.upsertRunAttempt(attempt({ status: "running" }));
  store.upsertRunAttempt(attempt({ status: "failed", endedAt: "2026-08-01T00:00:03.000Z" }));
  store.upsertRunAttempt(
    attempt({
      attemptId: "attempt_execution_0_1750000000000_2",
      retryIndex: 1,
      status: "running",
      startedAt: "2026-08-01T00:00:04.000Z",
    }),
  );

  expect(
    v2
      .bootstrap("thr_run_projection")
      .runs.map((run) => `${run.runId}:${run.status}`)
      .sort(),
  ).toEqual(["attempt_execution_0_1750000000000_1:failed", "attempt_execution_0_1750000000000_2:running"]);
});

test("V2 lifecycle survives disk reopen and rebuild without a legacy attempt table", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-v2-attempt-only-"));
  const filename = path.join(dir, "store.sqlite");
  let db = new DatabaseSync(filename);
  try {
    let store = new ConversationStore(db);
    store.initialize();
    store.conversationV2().append({
      conversationId: "thr_run_projection",
      eventId: "seed",
      type: "noop",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    db.exec("DROP TABLE thread_run_attempts");
    const started = attempt({
      status: "running",
      phase: "continuation",
      retryIndex: 2,
      metadata: { source: "recovery", empty: "", nested: { value: 0 } },
    });
    store.upsertRunAttempt(started);
    expect(store.listRunAttempts(started.threadId)).toEqual([started]);
    db.close();
    db = new DatabaseSync(filename);
    store = new ConversationStore(db);
    store.conversationV2().rebuildReadModels(started.threadId);
    expect(store.listRunAttempts(started.threadId)).toEqual([started]);
    const completed = { ...started, status: "completed" as const, endedAt: "2026-08-01T00:01:00.000Z" };
    store.upsertRunAttempt(completed);
    expect(store.listRunAttempts(started.threadId)).toEqual([completed]);
    const seq = store.conversationV2().head(started.threadId).lastSeq;
    store.upsertRunAttempt(completed);
    expect(store.conversationV2().head(started.threadId).lastSeq).toBe(seq);
    store.conversationV2().rebuildReadModels(started.threadId);
    expect(store.listRunAttempts(started.threadId)).toEqual([completed]);
  } finally {
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("unmigrated attempts fail explicitly without creating a stream or writing V1", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    store.initialize();
    expect(() => store.upsertRunAttempt(attempt({ status: "running" }))).toThrow();
    expect(store.conversationV2().hasConversation("thr_run_projection")).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS n FROM thread_run_attempts").get()).toEqual({ n: 0 });
  } finally {
    db.close();
  }
});

test("compatibility parity reads legacy-only runs and agents without creating a V2 stream", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    store.initialize();
    // Insert the legacy thread directly: saveThread intentionally creates an
    // empty V2 stream, while this fixture models a pre-migration conversation.
    db.prepare(
      `INSERT INTO threads
       (id, title, prompt, workspace_path, status, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "thr_legacy_projection",
      "Legacy projection",
      "parity",
      "/tmp/project",
      "running",
      "running",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO thread_run_attempts
       (thread_id, attempt_id, phase, retry_index, status, started_at, ended_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "thr_legacy_projection",
      "legacy_attempt",
      "question",
      2,
      "canceled",
      "2026-08-01T00:00:01.000Z",
      "2026-08-01T00:00:02.000Z",
      JSON.stringify({ source: "legacy" }),
    );
    db.prepare(
      `INSERT INTO thread_agent_instances
       (thread_id, agent_id, role, kind, status, run_attempt_id, parent_agent_id,
        parent_tool_use_id, mission_key, todo_id, started_at, ended_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "thr_legacy_projection",
      "legacy_agent",
      "explore",
      "subagent",
      "running",
      "legacy_attempt",
      null,
      "tool_legacy",
      "migration",
      "todo_legacy",
      "2026-08-01T00:00:01.000Z",
      null,
      "2026-08-01T00:00:01.000Z",
      JSON.stringify({ taskName: "legacy task" }),
    );

    expect(store.listRunAttempts("thr_legacy_projection")).toEqual([
      {
        threadId: "thr_legacy_projection",
        attemptId: "legacy_attempt",
        phase: "ask",
        retryIndex: 2,
        status: "cancelled",
        startedAt: "2026-08-01T00:00:01.000Z",
        endedAt: "2026-08-01T00:00:02.000Z",
        metadata: { source: "legacy" },
      },
    ]);
    expect(store.listAgentInstances("thr_legacy_projection")).toEqual([
      {
        threadId: "thr_legacy_projection",
        agentId: "legacy_agent",
        role: "explore",
        kind: "subagent",
        status: "active",
        runAttemptId: "legacy_attempt",
        parentToolUseId: "tool_legacy",
        missionKey: "migration",
        todoId: "todo_legacy",
        startedAt: "2026-08-01T00:00:01.000Z",
        updatedAt: "2026-08-01T00:00:01.000Z",
        metadata: { taskName: "legacy task" },
      },
    ]);
    expect(store.conversationV2().hasConversation("thr_legacy_projection")).toBe(false);
  } finally {
    db.close();
  }
});

test("compatibility reconciliation repairs V2 lifecycle rows missing recovery metadata", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    store.initialize();
    const v2 = store.conversationV2();
    db.prepare(
      `INSERT INTO threads
       (id, title, prompt, workspace_path, status, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "thr_malformed_v2_run",
      "Malformed V2 run",
      "repair",
      "/tmp/project",
      "running",
      "running",
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    );
    v2.append({
      conversationId: "thr_malformed_v2_run",
      eventId: "malformed_run",
      runId: "attempt_malformed",
      turnId: "attempt_malformed",
      type: "run.started",
      occurredAt: "2026-08-01T00:00:01.000Z",
      payload: {
        authority: "lifecycle",
        status: "running",
        startedAt: "2026-08-01T00:00:01.000Z",
      },
    });
    db.prepare(
      `INSERT INTO thread_run_attempts
       (thread_id, attempt_id, phase, retry_index, status, started_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "thr_malformed_v2_run",
      "attempt_malformed",
      "execution",
      0,
      "running",
      "2026-08-01T00:00:01.000Z",
      JSON.stringify({ source: "legacy-repair" }),
    );

    expect(() => store.listRunAttempts("thr_malformed_v2_run")).toThrow(/recovery metadata/);
    expect(store.reconcileConversationV2Runs("thr_malformed_v2_run")).toEqual({ scanned: 1, repaired: 1 });
    expect(store.listRunAttempts("thr_malformed_v2_run")).toEqual([
      {
        threadId: "thr_malformed_v2_run",
        attemptId: "attempt_malformed",
        phase: "execution",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-08-01T00:00:01.000Z",
        metadata: { source: "legacy-repair" },
      },
    ]);
    expect(store.reconcileConversationV2Runs("thr_malformed_v2_run")).toEqual({ scanned: 1, repaired: 0 });
  } finally {
    db.close();
  }
});

test("V1 rows cannot replace V2 lifecycle state and incomplete V2 metadata is explicit", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    store.initialize();
    const v2 = store.conversationV2();
    v2.append({
      conversationId: "thr_run_projection",
      eventId: "seed",
      type: "noop",
      occurredAt: "2026-08-01T00:00:00.000Z",
    });
    const record = attempt({ status: "running" });
    store.upsertRunAttempt(record);
    db.exec(
      `CREATE TRIGGER reject_v1_attempt_write BEFORE INSERT ON thread_run_attempts BEGIN SELECT RAISE(ABORT, 'V1 is read-only'); END`,
    );
    store.upsertRunAttempt({ ...record, status: "completed", endedAt: "2026-08-01T00:01:00.000Z" });
    expect(store.listRunAttempts(record.threadId)[0]?.status).toBe("completed");
    v2.append({
      conversationId: record.threadId,
      eventId: "incomplete",
      runId: "old_run",
      turnId: "old_run",
      type: "run.started",
      occurredAt: record.startedAt,
      payload: { authority: "lifecycle", status: "running" },
    });
    expect(() => store.listRunAttempts(record.threadId)).toThrow(/recovery metadata/);
  } finally {
    db.close();
  }
});
