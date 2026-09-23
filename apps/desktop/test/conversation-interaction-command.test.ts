import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import {
  executeBashApprovalResolutionCommand,
  executeClarificationResolutionCommand,
  failInterruptedInteractionCommands,
} from "../src/main/conversation-interaction-command";
import { ConversationV2Store } from "../src/main/conversation-v2-store";
import type { BashApprovalDecision, BashApprovalRequest, ClarificationRequest } from "../src/shared/ipc";

function harness() {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_clarification");
  let pending: ClarificationRequest | undefined = {
    threadId: "thread_clarification",
    toolUseId: "tool_question_1",
    questions: [],
  };
  let resolutions = 0;
  const input = {
    principalId: "principal_1",
    clientCommandId: "clarification_command_1",
    conversationId: "thread_clarification",
    toolUseId: "tool_question_1",
    resolution: "submit" as const,
    answers: { toolUseId: "tool_question_1", selections: [["answer"]] },
    expectedHistoryRevision: 0,
  };
  const deps = {
    v2,
    getPending: () => pending,
    buildDismissAnswers: (request: ClarificationRequest) => ({
      toolUseId: request.toolUseId,
      selections: [],
    }),
    resolve: () => {
      if (!pending) return false;
      pending = undefined;
      resolutions += 1;
      return true;
    },
    errorMessage: (error: unknown) => String(error),
  };
  return { db, v2, input, deps, resolutions: () => resolutions };
}

test("clarification resolution is idempotent after response loss", () => {
  const state = harness();
  expect(executeClarificationResolutionCommand(state.input, state.deps)).toEqual({ ok: true });
  expect(executeClarificationResolutionCommand(state.input, state.deps)).toEqual({ ok: true });
  expect(state.resolutions()).toBe(1);
  expect(
    state.v2.getCommandJob(state.input.principalId, state.input.conversationId, state.input.clientCommandId),
  ).toMatchObject({
    status: "completed",
    request: { toolUseId: state.input.toolUseId, resolution: "submit" },
    result: { ok: true, toolUseId: state.input.toolUseId, resolution: "submit" },
  });
  state.db.close();
});

test("dismiss resolution reuses its durable ignored answers after pending state is gone", () => {
  const state = harness();
  const { answers: _answers, ...baseInput } = state.input;
  const input = { ...baseInput, resolution: "dismiss" as const };
  expect(executeClarificationResolutionCommand(input, state.deps)).toEqual({ ok: true });
  expect(executeClarificationResolutionCommand(input, state.deps)).toEqual({ ok: true });
  expect(state.resolutions()).toBe(1);
  expect(
    state.v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId),
  ).toMatchObject({
    status: "completed",
    request: {
      resolution: "dismiss",
      answers: { toolUseId: input.toolUseId, selections: [] },
    },
  });
  state.db.close();
});

test("missing pending clarification fails durably without pretending it was resolved", () => {
  const state = harness();
  expect(executeClarificationResolutionCommand(state.input, state.deps)).toEqual({ ok: true });
  const missing = {
    ...state.input,
    clientCommandId: "missing_pending",
    answers: { toolUseId: state.input.toolUseId, selections: [["another"]] },
  };
  expect(() => executeClarificationResolutionCommand(missing, state.deps)).toThrow(
    expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }),
  );
  expect(
    state.v2.getCommandJob(missing.principalId, missing.conversationId, missing.clientCommandId),
  ).toMatchObject({ status: "failed", error: { code: CONVERSATION_V2_ERROR.invalidParams } });
  expect(state.resolutions()).toBe(1);
  state.db.close();
});

test("clarification resolution rejects command id reuse and wrong conversation ownership", () => {
  const state = harness();
  expect(() =>
    executeClarificationResolutionCommand(
      { ...state.input, clientCommandId: "wrong_thread", conversationId: "other_thread" },
      state.deps,
    ),
  ).toThrow();
  expect(executeClarificationResolutionCommand(state.input, state.deps)).toEqual({ ok: true });
  expect(() =>
    executeClarificationResolutionCommand(
      { ...state.input, answers: { toolUseId: state.input.toolUseId, selections: [["changed"]] } },
      state.deps,
    ),
  ).toThrow(expect.objectContaining({ code: CONVERSATION_V2_ERROR.idempotencyConflict }));
  state.db.close();
});

test("startup fails accepted and running interaction commands without replaying them", () => {
  const state = harness();
  state.v2.acceptCommand({
    principalId: "principal_1",
    conversationId: state.input.conversationId,
    clientCommandId: "accepted_interaction",
    commandType: "clarification.resolve",
    request: { toolUseId: "tool_accepted", resolution: "dismiss" },
    expectedHistoryRevision: 0,
  });
  const running = state.v2.acceptCommand({
    principalId: "principal_1",
    conversationId: state.input.conversationId,
    clientCommandId: "running_interaction",
    commandType: "clarification.resolve",
    request: { toolUseId: "tool_running", resolution: "submit" },
    expectedHistoryRevision: 0,
  });
  state.v2.beginCommandExecution(running.principalId, running.conversationId, running.clientCommandId);

  for (const [clientCommandId, claim] of [
    ["accepted_approval", false],
    ["running_approval", true],
  ] as const) {
    const approval = state.v2.acceptCommand({
      principalId: "principal_1",
      conversationId: state.input.conversationId,
      clientCommandId,
      commandType: "approval.resolve",
      request: { toolUseId: `tool_${clientCommandId}`, decision: "approved" },
      expectedHistoryRevision: 0,
    });
    if (claim) {
      state.v2.beginCommandExecution(approval.principalId, approval.conversationId, approval.clientCommandId);
    }
  }

  expect(failInterruptedInteractionCommands(state.v2)).toBe(4);
  for (const clientCommandId of [
    "accepted_interaction",
    "running_interaction",
    "accepted_approval",
    "running_approval",
  ]) {
    expect(state.v2.getCommandJob("principal_1", state.input.conversationId, clientCommandId)).toMatchObject({
      status: "failed",
      error: { code: "interaction_context_lost" },
    });
  }
  expect(state.resolutions()).toBe(0);
  state.db.close();
});

test("Bash approval decisions are delivered once and response-loss retries use the receipt", () => {
  for (const decision of [
    "approved",
    "approved_remember_prefix",
    "approved_for_session",
    "approved_execpolicy_amendment",
    "approved_network_policy_amendment",
    "denied",
    "cancelled",
  ] satisfies BashApprovalDecision[]) {
    const db = new DatabaseSync(":memory:");
    const v2 = new ConversationV2Store(db);
    v2.initialize();
    v2.ensureConversation("thread_bash");
    const pending: BashApprovalRequest = {
      toolUseId: `tool_${decision}`,
      threadId: "thread_bash",
      command: "bun test",
      cwd: "/repo",
      reason: "test",
      riskScore: 1,
      riskLevel: "low",
      agentId: "main",
    };
    let current: BashApprovalRequest | undefined = pending;
    const delivered: Array<{ decision: BashApprovalDecision; feedback?: string }> = [];
    const input = {
      principalId: "principal_bash",
      clientCommandId: `command_${decision}`,
      conversationId: pending.threadId,
      toolUseId: pending.toolUseId,
      decision,
      ...(decision === "denied" ? { feedback: "change it" } : {}),
      expectedHistoryRevision: 0,
    };
    const deps = {
      v2,
      getPending: () => current,
      resolve: (_toolUseId: string, resolution: { decision: BashApprovalDecision; feedback?: string }) => {
        if (!current) return false;
        current = undefined;
        delivered.push(resolution);
        return true;
      },
      errorMessage: (error: unknown) => String(error),
    };

    expect(executeBashApprovalResolutionCommand(input, deps)).toMatchObject({
      ok: true,
      alreadyResolved: false,
      request: { toolUseId: pending.toolUseId },
    });
    expect(executeBashApprovalResolutionCommand(input, deps)).toEqual({
      ok: true,
      alreadyResolved: true,
    });
    expect(delivered).toEqual([
      {
        decision,
        ...(decision === "denied" ? { feedback: "change it" } : {}),
      },
    ]);
    db.close();
  }
});

test("a stale Bash approval with a new command id fails instead of claiming success", () => {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db);
  v2.initialize();
  v2.ensureConversation("thread_bash_stale");
  const input = {
    principalId: "principal_bash",
    clientCommandId: "command_stale_bash",
    conversationId: "thread_bash_stale",
    toolUseId: "tool_missing",
    decision: "approved" as const,
    expectedHistoryRevision: 0,
  };
  expect(() =>
    executeBashApprovalResolutionCommand(input, {
      v2,
      getPending: () => undefined,
      resolve: () => false,
      errorMessage: (error: unknown) => String(error),
    }),
  ).toThrow(expect.objectContaining({ code: CONVERSATION_V2_ERROR.invalidParams }));
  expect(v2.getCommandJob(input.principalId, input.conversationId, input.clientCommandId)).toMatchObject({
    status: "failed",
    error: { code: CONVERSATION_V2_ERROR.invalidParams },
  });
  db.close();
});
