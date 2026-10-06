import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
  classifyHistoryCommandRecovery,
  type HistoryCommandRecoveryDecision,
  recoverNonRewindRetryToPrepared,
} from "../src/main/conversation-command-recovery";
import {
  failUndispatchedConversationCommand,
  prepareConversationCommandDispatch,
  waitForConversationCommandDispatch,
} from "../src/main/conversation-command-dispatch";
import { type ConversationCommandJob, ConversationV2Store } from "../src/main/conversation-v2-store";
import type { RunAttemptRecord } from "../src/main/usage-ledger";

function job(
  status: ConversationCommandJob["status"],
  checkpoints: ConversationCommandJob["checkpoints"],
): ConversationCommandJob {
  return {
    protocolVersion: 2,
    principalId: "principal_1",
    conversationId: "thread_1",
    clientCommandId: "command_1",
    commandType: "history.retry",
    requestHash: "hash_1",
    request: { activityLineId: "sdk:user-1" },
    expectedHistoryRevision: 0,
    status,
    acceptedSeq: 1,
    acceptedAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    checkpoints,
  };
}

function checkpoint(
  ordinal: number,
  name: ConversationCommandJob["checkpoints"][number]["name"],
  payload: Record<string, unknown> = {},
) {
  return {
    ordinal,
    name,
    payload,
    recordedAt: `2026-09-17T00:00:0${ordinal}.000Z`,
  };
}

const base = [
  checkpoint(1, "execution.claimed"),
  checkpoint(2, "history.sdk_fork_skipped"),
  checkpoint(3, "history.local_rewrite_committed", { historyRevision: 1 }),
];

function decision(
  command: ConversationCommandJob,
  attempts: readonly RunAttemptRecord[] = [],
): HistoryCommandRecoveryDecision {
  return classifyHistoryCommandRecovery({ job: command, attempts });
}

test("classifies accepted and pre-dispatch history commands", () => {
  expect(decision(job("accepted", []))).toMatchObject({ kind: "claim" });
  expect(decision(job("running", base))).toMatchObject({
    kind: "prepare_runtime_dispatch",
  });
  expect(
    decision(
      job("running", [
        ...base,
        checkpoint(4, "history.runtime_dispatch_prepared", {
          dispatchId: "dispatch_1",
          plannedAttemptId: "attempt_1",
        }),
      ]),
    ),
  ).toMatchObject({
    kind: "redispatch_prepared",
    plannedAttemptId: "attempt_1",
    commandDispatch: {
      principalId: "principal_1",
      clientCommandId: "command_1",
      dispatchId: "dispatch_1",
    },
  });
});

test("prepares a claimed non-rewind retry without inventing history side effects", () => {
  const command = {
    ...job("running", [checkpoint(1, "execution.claimed")]),
    request: { rewind: false, prompt: "retry", attachments: [] },
  };

  expect(classifyHistoryCommandRecovery({ job: command, attempts: [] })).toEqual({
    kind: "prepare_runtime_dispatch",
    job: command,
  });
});

test("never redispatches when a prepared attempt already exists", () => {
  const prepared = job("running", [
    ...base,
    checkpoint(4, "history.runtime_dispatch_prepared", {
      dispatchId: "dispatch_1",
      plannedAttemptId: "attempt_1",
    }),
  ]);
  expect(
    decision(prepared, [
      {
        threadId: "thread_1",
        attemptId: "attempt_1",
        phase: "continuation",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-09-17T00:00:04.000Z",
      },
    ]),
  ).toMatchObject({ kind: "integrity_failure" });
});

test("classifies dispatched attempts without repeating external execution", () => {
  const dispatched = job("running", [
    ...base,
    checkpoint(4, "history.runtime_dispatch_prepared", {
      dispatchId: "dispatch_1",
      plannedAttemptId: "attempt_1",
    }),
    checkpoint(5, "history.runtime_dispatched", {
      dispatchId: "dispatch_1",
      runAttemptId: "attempt_1",
    }),
  ]);
  const commandDispatch = {
    principalId: "principal_1",
    clientCommandId: "command_1",
    dispatchId: "dispatch_1",
  };
  expect(decision(dispatched)).toMatchObject({ kind: "integrity_failure" });
  expect(
    decision(dispatched, [
      {
        threadId: "thread_1",
        attemptId: "attempt_1",
        phase: "continuation",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-09-17T00:00:04.000Z",
        metadata: { commandDispatch },
      },
    ]),
  ).toMatchObject({ kind: "settle_orphaned_attempt" });
  expect(
    decision(dispatched, [
      {
        threadId: "thread_1",
        attemptId: "attempt_1",
        phase: "continuation",
        retryIndex: 0,
        status: "completed",
        startedAt: "2026-09-17T00:00:04.000Z",
        endedAt: "2026-09-17T00:00:05.000Z",
        metadata: { commandDispatch },
      },
    ]),
  ).toMatchObject({ kind: "settle_from_terminal_attempt" });
});

test("rejects incomplete or mismatched durable dispatch identity", () => {
  expect(
    decision(
      job("running", [
        ...base,
        checkpoint(4, "history.runtime_dispatch_prepared", {
          dispatchId: "dispatch_1",
        }),
      ]),
    ),
  ).toMatchObject({ kind: "integrity_failure" });

  const dispatched = job("running", [
    ...base,
    checkpoint(4, "history.runtime_dispatch_prepared", {
      dispatchId: "dispatch_1",
      plannedAttemptId: "attempt_1",
    }),
    checkpoint(5, "history.runtime_dispatched", {
      dispatchId: "dispatch_1",
      runAttemptId: "attempt_1",
    }),
  ]);
  expect(
    decision(dispatched, [
      {
        threadId: "thread_1",
        attemptId: "attempt_1",
        phase: "continuation",
        retryIndex: 0,
        status: "failed",
        startedAt: "2026-09-17T00:00:04.000Z",
        endedAt: "2026-09-17T00:00:05.000Z",
        metadata: {
          commandDispatch: {
            principalId: "principal_1",
            clientCommandId: "command_1",
            dispatchId: "different_dispatch",
          },
        },
      },
    ]),
  ).toMatchObject({ kind: "integrity_failure" });
});

test("recovers accepted and claimed non-rewind retries to one prepared dispatch", () => {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_recovery");
  const accepted = v2.acceptCommand({
    principalId: "principal_recovery",
    conversationId: "thread_recovery",
    clientCommandId: "accepted_retry",
    commandType: "history.retry",
    request: { rewind: false, prompt: "retry", attachments: [] },
    expectedHistoryRevision: 0,
  });
  const recoveredAccepted = recoverNonRewindRetryToPrepared({
    decision: { kind: "claim", job: accepted },
    v2,
    coreKind: "codex",
  });
  expect(recoveredAccepted).toMatchObject({ kind: "redispatch_prepared" });
  expect(
    v2.getCommandJob(accepted.principalId, accepted.conversationId, accepted.clientCommandId),
  ).toMatchObject({
    status: "running",
    checkpoints: [{ name: "execution.claimed" }, { name: "history.runtime_dispatch_prepared" }],
  });

  const claimed = v2.acceptCommand({
    principalId: "principal_recovery",
    conversationId: "thread_recovery",
    clientCommandId: "claimed_retry",
    commandType: "history.retry",
    request: { rewind: false, prompt: "retry", attachments: [] },
    expectedHistoryRevision: 0,
  });
  const claim = v2.beginCommandExecution(
    claimed.principalId,
    claimed.conversationId,
    claimed.clientCommandId,
  );
  const recoveredClaimed = recoverNonRewindRetryToPrepared({
    decision: { kind: "prepare_runtime_dispatch", job: claim.job },
    v2,
    coreKind: "acp",
  });
  expect(recoveredClaimed).toMatchObject({ kind: "redispatch_prepared" });
  expect(
    classifyHistoryCommandRecovery({
      job: recoveredClaimed?.job as ConversationCommandJob,
      attempts: [],
    }),
  ).toMatchObject({ kind: "redispatch_prepared" });
  db.close();
});

test("durably fails stale or unsupported non-rewind retry recovery", () => {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_recovery_failure");
  const stale = v2.acceptCommand({
    principalId: "principal_recovery",
    conversationId: "thread_recovery_failure",
    clientCommandId: "stale_retry",
    commandType: "history.retry",
    request: { rewind: false, prompt: "retry", attachments: [] },
    expectedHistoryRevision: 0,
  });
  v2.append({
    conversationId: stale.conversationId,
    eventId: "history_changed",
    type: "history.edited",
    occurredAt: "2026-09-17T00:00:01.000Z",
    payload: { affectedMessageIds: [] },
  });
  expect(
    recoverNonRewindRetryToPrepared({
      decision: { kind: "claim", job: stale },
      v2,
      coreKind: "codex",
    }),
  ).toBeUndefined();
  expect(v2.getCommandJob(stale.principalId, stale.conversationId, stale.clientCommandId)).toMatchObject({
    status: "failed",
    error: { code: "cursor_stale" },
  });

  const unsupported = v2.acceptCommand({
    principalId: "principal_recovery",
    conversationId: "thread_recovery_failure",
    clientCommandId: "unsupported_retry",
    commandType: "history.retry",
    request: { rewind: false, prompt: "retry", attachments: [] },
    expectedHistoryRevision: 1,
  });
  expect(
    recoverNonRewindRetryToPrepared({
      decision: { kind: "claim", job: unsupported },
      v2,
      coreKind: "claude",
    }),
  ).toBeUndefined();
  expect(
    v2.getCommandJob(unsupported.principalId, unsupported.conversationId, unsupported.clientCommandId),
  ).toMatchObject({ status: "failed", error: { code: "integrity_failure" } });
  db.close();
});

function prepareNonRewindRetryDispatch() {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_dispatch_wait");
  const accepted = v2.acceptCommand({
    principalId: "principal_dispatch_wait",
    conversationId: "thread_dispatch_wait",
    clientCommandId: "command_dispatch_wait",
    commandType: "history.retry",
    request: { rewind: false, prompt: "retry", attachments: [] },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
  );
  const prepared = prepareConversationCommandDispatch({
    v2,
    job: accepted,
    coreKind: "codex",
    actionKind: "resume_sdk",
  });
  return { db, v2, accepted, prepared };
}

test("dispatch waiter resolves after the matching durable dispatch checkpoint", async () => {
  const { db, v2, accepted, prepared } = prepareNonRewindRetryDispatch();
  const waiting = waitForConversationCommandDispatch({
    v2,
    conversationId: accepted.conversationId,
    prepared,
    timeoutMs: 100,
    pollIntervalMs: 1,
  });
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "history.runtime_dispatched",
    {
      dispatchId: prepared.commandDispatch.dispatchId,
      runAttemptId: prepared.plannedAttemptId,
    },
  );
  await expect(waiting).resolves.toBeUndefined();
  db.close();
});

test("dispatch waiter rejects when a prepared command fails before attempt creation", async () => {
  const { db, v2, accepted, prepared } = prepareNonRewindRetryDispatch();
  const waiting = waitForConversationCommandDispatch({
    v2,
    conversationId: accepted.conversationId,
    prepared,
    timeoutMs: 100,
    pollIntervalMs: 1,
  });
  expect(
    failUndispatchedConversationCommand({
      v2,
      conversationId: accepted.conversationId,
      prepared,
      reason: "runtime rejected before attempt creation",
    }),
  ).toBe(true);
  await expect(waiting).rejects.toThrow(
    "Command failed before its durable runtime dispatch was recorded.",
  );
  db.close();
});
