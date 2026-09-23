import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import {
  executeRuntimeConfigMutationCommand,
  failInterruptedRuntimeConfigCommands,
} from "../src/main/conversation-runtime-config-command";
import { ConversationV2Store } from "../src/main/conversation-v2-store";

function harness() {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_runtime_config_command");
  const input = {
    principalId: "principal_runtime_config",
    clientCommandId: "runtime_config_1",
    conversationId: "thread_runtime_config_command",
    expectedHistoryRevision: 0,
    request: { runtimeConfig: { sessionMode: "agent", modelId: "gpt-test" } },
  };
  let executions = 0;
  const deps = {
    v2,
    execute: async () => {
      executions += 1;
      return { thread: { id: input.conversationId } };
    },
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  };
  return { db, v2, input, deps, executions: () => executions };
}

test("runtime-config mutation is durable and idempotent", async () => {
  const state = harness();
  await expect(executeRuntimeConfigMutationCommand(state.input, state.deps)).resolves.toEqual({
    thread: { id: state.input.conversationId },
  });
  await expect(executeRuntimeConfigMutationCommand(state.input, state.deps)).resolves.toEqual({
    thread: { id: state.input.conversationId },
  });
  expect(state.executions()).toBe(1);
  expect(
    state.v2.getCommandJob(
      state.input.principalId,
      state.input.conversationId,
      state.input.clientCommandId,
    ),
  ).toMatchObject({
    commandType: "runtime-config.mutate",
    status: "completed",
    request: state.input.request,
    result: { ok: true, request: state.input.request },
  });
  state.db.close();
});

test("runtime-config mutation rejects stale revision and changed payload", async () => {
  const state = harness();
  await executeRuntimeConfigMutationCommand(state.input, state.deps);
  await expect(
    executeRuntimeConfigMutationCommand(
      { ...state.input, request: { runtimeConfig: { sessionMode: "chat" } } },
      state.deps,
    ),
  ).rejects.toMatchObject({ code: CONVERSATION_V2_ERROR.idempotencyConflict });
  await expect(
    executeRuntimeConfigMutationCommand(
      { ...state.input, clientCommandId: "runtime_config_stale", expectedHistoryRevision: 1 },
      state.deps,
    ),
  ).rejects.toMatchObject({ code: CONVERSATION_V2_ERROR.cursorStale });
  expect(state.executions()).toBe(1);
  state.db.close();
});

test("startup fails accepted and running runtime-config mutations without replay", () => {
  const state = harness();
  const accepted = state.v2.acceptCommand({
    principalId: state.input.principalId,
    conversationId: state.input.conversationId,
    clientCommandId: "runtime_config_accepted",
    commandType: "runtime-config.mutate",
    request: state.input.request,
    expectedHistoryRevision: 0,
  });
  const running = state.v2.acceptCommand({
    principalId: state.input.principalId,
    conversationId: state.input.conversationId,
    clientCommandId: "runtime_config_running",
    commandType: "runtime-config.mutate",
    request: state.input.request,
    expectedHistoryRevision: 0,
  });
  state.v2.beginCommandExecution(running.principalId, running.conversationId, running.clientCommandId);
  expect(failInterruptedRuntimeConfigCommands(state.v2)).toBe(2);
  for (const clientCommandId of [accepted.clientCommandId, running.clientCommandId]) {
    expect(
      state.v2.getCommandJob(state.input.principalId, state.input.conversationId, clientCommandId),
    ).toMatchObject({ status: "failed", error: { code: "runtime_config_outcome_unknown" } });
  }
  expect(state.executions()).toBe(0);
  state.db.close();
});
