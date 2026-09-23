import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
  classifyInterruptedPlanCommand,
  executePlanResolutionCommand,
  type RecordPlanCommandCheckpoint,
  recoverInterruptedPlanCommands,
} from "../src/main/conversation-plan-command";
import { ConversationV2Store } from "../src/main/conversation-v2-store";

function createStore() {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_plan");
  return { db, v2 };
}

const snapshotArtifactPayload = {
  snapshotPath: "/repo/.eco/approved-plans/thread_plan.md",
  snapshotRelativePath: ".eco/approved-plans/thread_plan.md",
  contentHash: "a".repeat(64),
  hashAlgorithm: "sha256",
};

test("plan resolution returns its durable receipt after response loss", async () => {
  const { db, v2 } = createStore();
  let executions = 0;
  const input = {
    principalId: "principal_1",
    clientCommandId: "plan_approve_1",
    conversationId: "thread_plan",
    resolution: "approve" as const,
    expectedHistoryRevision: 0,
    request: { executionTarget: { kind: "main" } },
  };
  const deps = {
    v2,
    freezeContext: () => ({ pendingPlan: { plan: "frozen plan" }, coreKind: "codex" }),
    execute: async (context: Record<string, unknown>, checkpoint: RecordPlanCommandCheckpoint) => {
      executions += 1;
      expect(context).toEqual({ pendingPlan: { plan: "frozen plan" }, coreKind: "codex" });
      checkpoint("plan.snapshot_persisted");
      return { thread: { id: "thread_plan", status: "running" } as never };
    },
    errorMessage: (error: unknown) => String(error),
  };

  expect(await executePlanResolutionCommand(input, deps)).toMatchObject({
    alreadyResolved: false,
    thread: { id: "thread_plan", status: "running" },
  });
  expect(await executePlanResolutionCommand(input, deps)).toMatchObject({
    alreadyResolved: true,
    thread: { id: "thread_plan", status: "running" },
  });
  expect(executions).toBe(1);
  expect(v2.getCommandJob("principal_1", "thread_plan", "plan_approve_1")).toMatchObject({
    request: {
      resolution: "approve",
      input: { executionTarget: { kind: "main" } },
      context: { pendingPlan: { plan: "frozen plan" }, coreKind: "codex" },
    },
    checkpoints: [
      { name: "execution.claimed" },
      { name: "plan.context_frozen" },
      { name: "plan.snapshot_persisted" },
    ],
  });
  db.close();
});

test("plan resolution rejects a changed payload under the same command id", async () => {
  const { db, v2 } = createStore();
  const input = {
    principalId: "principal_1",
    clientCommandId: "plan_approve_conflict",
    conversationId: "thread_plan",
    resolution: "approve" as const,
    expectedHistoryRevision: 0,
    request: { executionTarget: { kind: "main" } },
  };
  const deps = {
    v2,
    freezeContext: () => ({ pendingPlan: { plan: "frozen plan" } }),
    execute: async () => ({}),
    errorMessage: (error: unknown) => String(error),
  };
  await executePlanResolutionCommand(input, deps);
  await expect(
    executePlanResolutionCommand(
      { ...input, request: { executionTarget: { kind: "subagent", agentKey: "coder" } } },
      deps,
    ),
  ).rejects.toThrow();
  db.close();
});

test("startup preserves accepted commands and fails claimed commands that never delivered approval", () => {
  const { db, v2 } = createStore();
  v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "accepted_plan",
    commandType: "plan.resolve",
    request: { resolution: "dismiss", input: {}, context: { pendingPlan: null } },
    expectedHistoryRevision: 0,
  });
  const running = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "running_plan",
    commandType: "plan.resolve",
    request: { resolution: "approve", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(running.principalId, running.conversationId, running.clientCommandId);

  expect(recoverInterruptedPlanCommands(v2, () => undefined)).toEqual({ completed: 0, failed: 1 });
  expect(v2.getCommandJob("principal_1", "thread_plan", "accepted_plan")).toMatchObject({
    status: "accepted",
  });
  expect(v2.getCommandJob("principal_1", "thread_plan", "running_plan")).toMatchObject({
    status: "failed",
    error: { code: "plan_resolution_not_started" },
  });
  db.close();
});

test("startup reports a prepared plan dispatch as durably not started", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "prepared_plan",
    commandType: "plan.resolve",
    request: { resolution: "approve", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.snapshot_persisted",
    snapshotArtifactPayload,
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatch_prepared",
    { dispatchId: "dispatch_1", plannedAttemptId: "attempt_1" },
  );

  expect(recoverInterruptedPlanCommands(v2, () => undefined)).toEqual({ completed: 0, failed: 1 });
  expect(v2.getCommandJob("principal_1", "thread_plan", "prepared_plan")).toMatchObject({
    status: "failed",
    error: { code: "runtime_dispatch_not_started" },
  });
  db.close();
});

test("startup completes a dispatched plan receipt and clears a main-target pending plan", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "dispatched_plan",
    commandType: "plan.resolve",
    request: {
      resolution: "approve",
      input: { executionTarget: { kind: "main" } },
      context: { pendingPlan: { plan: "frozen" } },
    },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.snapshot_persisted",
    snapshotArtifactPayload,
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatch_prepared",
    { dispatchId: "dispatch_1", plannedAttemptId: "attempt_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatched",
    { dispatchId: "dispatch_1", runAttemptId: "attempt_1" },
  );
  let clears = 0;

  expect(
    recoverInterruptedPlanCommands(v2, () => ({ id: "thread_plan", status: "running" }) as never, {
      listRunAttempts: () => [
        {
          threadId: "thread_plan",
          attemptId: "attempt_1",
          phase: "execution",
          retryIndex: 0,
          status: "running",
          startedAt: "2026-09-17T00:00:01.000Z",
          metadata: {
            commandDispatch: {
              principalId: "principal_1",
              clientCommandId: "dispatched_plan",
              dispatchId: "dispatch_1",
            },
          },
        },
      ],
      verifySnapshotArtifact: (_job, artifact) => {
        expect(artifact).toEqual({
          absolutePath: snapshotArtifactPayload.snapshotPath,
          relativePath: snapshotArtifactPayload.snapshotRelativePath,
          contentHash: snapshotArtifactPayload.contentHash,
        });
        return { ok: true };
      },
      clearPendingPlanForCommand: (_threadId, command) => {
        clears += 1;
        v2.recordCommandCheckpoint(
          command.principalId,
          "thread_plan",
          command.clientCommandId,
          "plan.pending_cleared",
          {},
        );
      },
    }),
  ).toEqual({ completed: 1, failed: 0 });
  expect(clears).toBe(1);
  expect(v2.getCommandJob("principal_1", "thread_plan", "dispatched_plan")).toMatchObject({
    status: "completed",
    result: { ok: true, resolution: "approve" },
  });
  db.close();
});

test("startup refuses to complete approval when the snapshot artifact cannot be verified", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "tampered_snapshot_plan",
    commandType: "plan.resolve",
    request: { resolution: "approve", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.snapshot_persisted",
    snapshotArtifactPayload,
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.pending_cleared",
    {},
  );

  expect(
    recoverInterruptedPlanCommands(v2, () => undefined, {
      verifySnapshotArtifact: () => ({ ok: false, reason: "snapshot hash mismatch" }),
    }),
  ).toEqual({ completed: 0, failed: 1 });
  expect(v2.getCommandJob("principal_1", "thread_plan", "tampered_snapshot_plan")).toMatchObject({
    status: "failed",
    error: { code: "integrity_failure", message: "snapshot hash mismatch" },
  });
  db.close();
});

test("startup rejects a dispatched plan checkpoint without its matching attempt", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "dispatched_without_attempt",
    commandType: "plan.resolve",
    request: { resolution: "approve", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.snapshot_persisted",
    snapshotArtifactPayload,
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatch_prepared",
    { dispatchId: "dispatch_1", plannedAttemptId: "attempt_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatched",
    { dispatchId: "dispatch_1", runAttemptId: "attempt_1" },
  );

  expect(recoverInterruptedPlanCommands(v2, () => undefined)).toEqual({ completed: 0, failed: 1 });
  expect(v2.getCommandJob("principal_1", "thread_plan", "dispatched_without_attempt")).toMatchObject({
    status: "failed",
    error: { code: "integrity_failure" },
  });
  db.close();
});

test("startup keeps the pending plan for a dispatched forced-subagent execution", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "forced_dispatched_plan",
    commandType: "plan.resolve",
    request: {
      resolution: "approve",
      input: { executionTarget: { kind: "subagent", agentKey: "coder" } },
      context: { pendingPlan: { plan: "frozen" } },
    },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatch_prepared",
    { dispatchId: "dispatch_forced", plannedAttemptId: "attempt_forced" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.runtime_dispatched",
    { dispatchId: "dispatch_forced", runAttemptId: "attempt_forced" },
  );
  const job = v2.getCommandJob("principal_1", "thread_plan", "forced_dispatched_plan");
  expect(
    classifyInterruptedPlanCommand(job!, [
      {
        threadId: "thread_plan",
        attemptId: "attempt_forced",
        phase: "execution",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-09-17T00:00:01.000Z",
        metadata: {
          commandDispatch: {
            principalId: "principal_1",
            clientCommandId: "forced_dispatched_plan",
            dispatchId: "dispatch_forced",
          },
        },
      },
    ]),
  ).toMatchObject({ kind: "complete_runtime_dispatch", clearPendingPlan: false });
  db.close();
});

test("startup does not treat a bridge delivery as a fully recovered plan resolution", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "bridge_delivered_plan",
    commandType: "plan.resolve",
    request: { resolution: "approve", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.bridge_resolved",
    { toolUseId: "tool_1", decision: "approved" },
  );

  expect(recoverInterruptedPlanCommands(v2, () => undefined)).toEqual({ completed: 0, failed: 1 });
  expect(v2.getCommandJob("principal_1", "thread_plan", "bridge_delivered_plan")).toMatchObject({
    status: "failed",
    error: { code: "plan_resolution_outcome_unknown" },
  });
  db.close();
});

test("startup completes a bridge plan after the SDK continuation acknowledgement", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "bridge_resumed_plan",
    commandType: "plan.resolve",
    request: { resolution: "approve", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.snapshot_persisted",
    snapshotArtifactPayload,
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.bridge_resolved",
    { toolUseId: "tool_1", decision: "approved" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.bridge_continuation_resumed",
    { toolUseId: "tool_1", decision: "approved" },
  );
  let clearedWith: string | undefined;

  expect(
    recoverInterruptedPlanCommands(v2, () => undefined, {
      verifySnapshotArtifact: () => ({ ok: true }),
      clearPendingPlanForCommand: (_threadId, _command, checkpointName) => {
        clearedWith = checkpointName;
        v2.recordCommandCheckpoint(
          accepted.principalId,
          accepted.conversationId,
          accepted.clientCommandId,
          checkpointName,
          {},
        );
      },
    }),
  ).toEqual({ completed: 1, failed: 0 });
  expect(clearedWith).toBe("plan.pending_cleared");
  expect(v2.getCommandJob("principal_1", "thread_plan", "bridge_resumed_plan")).toMatchObject({
    status: "completed",
    result: { ok: true, resolution: "approve" },
  });
  db.close();
});

test("startup completes a dismissed bridge plan with its dismissal checkpoint", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "bridge_dismissed_plan",
    commandType: "plan.resolve",
    request: { resolution: "dismiss", input: {}, context: { pendingPlan: { plan: "frozen" } } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.bridge_resolved",
    { toolUseId: "tool_1", decision: "denied" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.bridge_continuation_resumed",
    { toolUseId: "tool_1", decision: "denied" },
  );
  let clearedWith: string | undefined;

  expect(
    recoverInterruptedPlanCommands(v2, () => undefined, {
      clearPendingPlanForCommand: (_threadId, _command, checkpointName) => {
        clearedWith = checkpointName;
        v2.recordCommandCheckpoint(
          accepted.principalId,
          accepted.conversationId,
          accepted.clientCommandId,
          checkpointName,
          {},
        );
      },
    }),
  ).toEqual({ completed: 1, failed: 0 });
  expect(clearedWith).toBe("plan.dismissal_committed");
  expect(v2.getCommandJob("principal_1", "thread_plan", "bridge_dismissed_plan")).toMatchObject({
    status: "completed",
    result: { ok: true, resolution: "dismiss" },
  });
  db.close();
});

test("startup completes a plan receipt after its terminal side-effect checkpoint", () => {
  const { db, v2 } = createStore();
  const accepted = v2.acceptCommand({
    principalId: "principal_1",
    conversationId: "thread_plan",
    clientCommandId: "completed_after_restart",
    commandType: "plan.resolve",
    request: { resolution: "dismiss", input: {}, context: { pendingPlan: null } },
    expectedHistoryRevision: 0,
  });
  v2.beginCommandExecution(accepted.principalId, accepted.conversationId, accepted.clientCommandId);
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.context_frozen",
    { contextHash: "hash_1" },
  );
  v2.recordCommandCheckpoint(
    accepted.principalId,
    accepted.conversationId,
    accepted.clientCommandId,
    "plan.dismissal_committed",
    { route: "stored_pending_plan" },
  );

  expect(recoverInterruptedPlanCommands(v2, () => ({ id: "thread_plan", status: "idle" }) as never)).toEqual({
    completed: 1,
    failed: 0,
  });
  expect(v2.getCommandJob("principal_1", "thread_plan", "completed_after_restart")).toMatchObject({
    status: "completed",
    result: { ok: true, resolution: "dismiss", thread: { id: "thread_plan", status: "idle" } },
  });
  db.close();
});
