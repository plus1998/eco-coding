import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import {
  failUndispatchedConversationCommand,
  observeConversationCommandRuntime,
} from "../src/main/conversation-command-dispatch";
import { executeNonRewindRetryCommand } from "../src/main/conversation-nonrewind-retry-command";
import { ConversationV2Store } from "../src/main/conversation-v2-store";
import type { ThreadSummary } from "../src/shared/ipc";

function harness(coreKind: "codex" | "acp" = "codex") {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db, {
    idFactory: (() => {
      let value = 0;
      return () => `nonrewind_${++value}`;
    })(),
  });
  v2.initialize();
  const thread: ThreadSummary = {
    id: "thread_nonrewind",
    title: "Retry",
    prompt: "task",
    workspacePath: "/tmp/retry",
    status: "failed",
    message: "failed",
    coreKind,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
  v2.ensureConversation(thread.id);
  let starts = 0;
  const input = {
    principalId: "desktop-local",
    clientCommandId: "history_retry_nonrewind_1",
    threadId: thread.id,
    activityLineId: "user:1",
    prompt: "retry me",
    requestedPrompt: "retry me",
    attachments: [],
    hasImages: false,
    expectedHistoryRevision: 0,
  };
  const deps = {
    v2,
    getThread: () => thread,
    ensureThreadRuntimeConfig: (value: ThreadSummary) => value,
    start: async (startInput: Parameters<Parameters<typeof executeNonRewindRetryCommand>[1]["start"]>[0]) => {
      starts += 1;
      expect(startInput.skipRecordUserPrompt).toBe(true);
      expect(startInput.preparedRuntimeDispatch.commandDispatch).toMatchObject({
        principalId: input.principalId,
        clientCommandId: input.clientCommandId,
      });
      return { thread: { ...thread, status: "running" as const } };
    },
    errorMessage: (error: unknown) => String(error),
  };
  return { db, v2, thread, input, deps, starts: () => starts };
}

describe("non-rewind retry command", () => {
  test("prepares one durable dispatch and makes response-loss retry idempotent", async () => {
    const state = harness();
    const first = await executeNonRewindRetryCommand(state.input, state.deps);
    const duplicate = await executeNonRewindRetryCommand(state.input, state.deps);

    expect(first.thread.status).toBe("running");
    expect(duplicate.thread).toEqual(state.thread);
    expect(state.starts()).toBe(1);
    expect(
      state.v2.getCommandJob(state.input.principalId, state.input.threadId, state.input.clientCommandId),
    ).toMatchObject({
      status: "running",
      request: { rewind: false },
      checkpoints: [{ name: "execution.claimed" }, { name: "history.runtime_dispatch_prepared" }],
    });
    state.db.close();
  });

  test("rejects the same command id with changed client input", async () => {
    const state = harness("acp");
    await executeNonRewindRetryCommand(state.input, state.deps);

    await expect(
      executeNonRewindRetryCommand({ ...state.input, requestedPrompt: "changed" }, state.deps),
    ).rejects.toMatchObject({ code: CONVERSATION_V2_ERROR.idempotencyConflict });
    expect(state.starts()).toBe(1);
    state.db.close();
  });

  test("fails only the matching prepared dispatch", async () => {
    const matching = harness();
    await executeNonRewindRetryCommand(matching.input, matching.deps);
    const prepared = matching.v2
      .getCommandJob(matching.input.principalId, matching.input.threadId, matching.input.clientCommandId)
      ?.checkpoints.at(-1)?.payload;
    const identity = {
      plannedAttemptId: String(prepared?.plannedAttemptId),
      commandDispatch: {
        principalId: matching.input.principalId,
        clientCommandId: matching.input.clientCommandId,
        dispatchId: String(prepared?.dispatchId),
      },
    };
    expect(
      failUndispatchedConversationCommand({
        v2: matching.v2,
        conversationId: matching.input.threadId,
        prepared: { ...identity, plannedAttemptId: "different_attempt" },
        reason: "mismatch",
      }),
    ).toBe(false);
    expect(
      failUndispatchedConversationCommand({
        v2: matching.v2,
        conversationId: matching.input.threadId,
        prepared: identity,
        reason: "runtime ended",
      }),
    ).toBe(true);
    expect(
      matching.v2.getCommandJob(
        matching.input.principalId,
        matching.input.threadId,
        matching.input.clientCommandId,
      ),
    ).toMatchObject({
      status: "failed",
      error: { code: "runtime_dispatch_not_started", reason: "runtime ended" },
    });
    expect(
      failUndispatchedConversationCommand({
        v2: matching.v2,
        conversationId: matching.input.threadId,
        prepared: identity,
        reason: "terminal no-op",
      }),
    ).toBe(false);
    matching.db.close();

    const dispatched = harness("acp");
    await executeNonRewindRetryCommand(dispatched.input, dispatched.deps);
    const checkpoint = dispatched.v2
      .getCommandJob(
        dispatched.input.principalId,
        dispatched.input.threadId,
        dispatched.input.clientCommandId,
      )
      ?.checkpoints.at(-1)?.payload;
    const dispatchedIdentity = {
      plannedAttemptId: String(checkpoint?.plannedAttemptId),
      commandDispatch: {
        principalId: dispatched.input.principalId,
        clientCommandId: dispatched.input.clientCommandId,
        dispatchId: String(checkpoint?.dispatchId),
      },
    };
    dispatched.v2.recordCommandCheckpoint(
      dispatched.input.principalId,
      dispatched.input.threadId,
      dispatched.input.clientCommandId,
      "history.runtime_dispatched",
      {
        dispatchId: dispatchedIdentity.commandDispatch.dispatchId,
        runAttemptId: dispatchedIdentity.plannedAttemptId,
      },
    );
    expect(
      failUndispatchedConversationCommand({
        v2: dispatched.v2,
        conversationId: dispatched.input.threadId,
        prepared: dispatchedIdentity,
        reason: "dispatched no-op",
      }),
    ).toBe(false);
    expect(
      dispatched.v2.getCommandJob(
        dispatched.input.principalId,
        dispatched.input.threadId,
        dispatched.input.clientCommandId,
      )?.status,
    ).toBe("running");
    dispatched.db.close();
  });

  test("observes a rejected runtime and durably closes an undispatched command", async () => {
    const state = harness();
    await executeNonRewindRetryCommand(state.input, state.deps);
    const checkpoint = state.v2
      .getCommandJob(state.input.principalId, state.input.threadId, state.input.clientCommandId)
      ?.checkpoints.at(-1)?.payload;
    const rejected: unknown[] = [];
    const observerErrors: unknown[] = [];
    observeConversationCommandRuntime({
      runtime: Promise.reject(new Error("runtime rejected")),
      v2: state.v2,
      conversationId: state.input.threadId,
      prepared: {
        plannedAttemptId: String(checkpoint?.plannedAttemptId),
        commandDispatch: {
          principalId: state.input.principalId,
          clientCommandId: state.input.clientCommandId,
          dispatchId: String(checkpoint?.dispatchId),
        },
      },
      notStartedReason: "runtime did not start",
      onRejected: (error) => rejected.push(error),
      onObserverError: (error) => observerErrors.push(error),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(rejected).toHaveLength(1);
    expect(observerErrors).toEqual([]);
    expect(
      state.v2.getCommandJob(state.input.principalId, state.input.threadId, state.input.clientCommandId),
    ).toMatchObject({
      status: "failed",
      error: { code: "runtime_dispatch_not_started", reason: "runtime did not start" },
    });
    state.db.close();
  });
});
