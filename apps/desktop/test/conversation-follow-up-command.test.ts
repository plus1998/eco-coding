import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import {
  executeFollowUpMutationCommand,
  failInterruptedFollowUpCommands,
} from "../src/main/conversation-follow-up-command";
import { ConversationV2Store } from "../src/main/conversation-v2-store";

function harness() {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_follow_up_command");
  const input = {
    principalId: "principal_follow_up",
    clientCommandId: "follow_up_1",
    conversationId: "thread_follow_up_command",
    expectedHistoryRevision: 0,
    operation: "update",
    request: { followUpId: "tfu_1", prompt: "updated" },
  };
  let executions = 0;
  const deps = {
    v2,
    execute: async () => {
      executions += 1;
      return { ok: true, value: "receipt" };
    },
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  };
  return { db, v2, input, deps, executions: () => executions };
}

test("follow-up mutation is durable and idempotent after response loss", async () => {
  const state = harness();
  await expect(executeFollowUpMutationCommand(state.input, state.deps)).resolves.toEqual({
    ok: true,
    value: "receipt",
  });
  await expect(executeFollowUpMutationCommand(state.input, state.deps)).resolves.toEqual({
    ok: true,
    value: "receipt",
  });
  expect(state.executions()).toBe(1);
  expect(
    state.v2.getCommandJob(
      state.input.principalId,
      state.input.conversationId,
      state.input.clientCommandId,
    ),
  ).toMatchObject({
    commandType: "followup.mutate",
    status: "completed",
    request: { operation: "update", followUpId: "tfu_1" },
    result: { ok: true, operation: "update", value: { ok: true, value: "receipt" } },
  });
  state.db.close();
});

test("follow-up mutation rejects a changed request under the same command id", async () => {
  const state = harness();
  await executeFollowUpMutationCommand(state.input, state.deps);
  await expect(
    executeFollowUpMutationCommand(
      { ...state.input, request: { followUpId: "tfu_1", prompt: "different" } },
      state.deps,
    ),
  ).rejects.toMatchObject({ code: CONVERSATION_V2_ERROR.idempotencyConflict });
  expect(state.executions()).toBe(1);
  state.db.close();
});

test("follow-up mutation failure is durably recorded", async () => {
  const state = harness();
  const error = new Error("queue update failed");
  await expect(
    executeFollowUpMutationCommand(state.input, {
      ...state.deps,
      execute: async () => {
        throw error;
      },
    }),
  ).rejects.toBe(error);
  expect(
    state.v2.getCommandJob(
      state.input.principalId,
      state.input.conversationId,
      state.input.clientCommandId,
    ),
  ).toMatchObject({ status: "failed", error: { code: "follow_up_mutation_failed", message: error.message } });
  state.db.close();
});

test("startup fails accepted and running follow-up mutations without replaying them", () => {
  const state = harness();
  const accepted = state.v2.acceptCommand({
    principalId: state.input.principalId,
    conversationId: state.input.conversationId,
    clientCommandId: "follow_up_accepted",
    commandType: "followup.mutate",
    request: { operation: "cancel", followUpId: "tfu_1" },
    expectedHistoryRevision: 0,
  });
  const running = state.v2.acceptCommand({
    principalId: state.input.principalId,
    conversationId: state.input.conversationId,
    clientCommandId: "follow_up_running",
    commandType: "followup.mutate",
    request: { operation: "cancel", followUpId: "tfu_2" },
    expectedHistoryRevision: 0,
  });
  state.v2.beginCommandExecution(running.principalId, running.conversationId, running.clientCommandId);

  expect(failInterruptedFollowUpCommands(state.v2)).toBe(2);
  for (const clientCommandId of [accepted.clientCommandId, running.clientCommandId]) {
    expect(
      state.v2.getCommandJob(state.input.principalId, state.input.conversationId, clientCommandId),
    ).toMatchObject({ status: "failed", error: { code: "follow_up_outcome_unknown" } });
  }
  expect(state.executions()).toBe(0);
  state.db.close();
});
