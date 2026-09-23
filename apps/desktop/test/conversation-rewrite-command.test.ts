import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "bun:test";
import { CONVERSATION_V2_ERROR } from "@eco/shared";
import {
  executeConversationRewriteCommand,
  type ConversationRewriteCommandDeps,
} from "../src/main/conversation-rewrite-command";
import { ConversationV2Store } from "../src/main/conversation-v2-store";
import type {
  ThreadRewriteFromMessageRequest,
  ThreadSummary,
} from "../src/shared/ipc";

function createHarness() {
  const db = new DatabaseSync(":memory:");
  const v2 = new ConversationV2Store(db, {
    idFactory: (() => {
      let counter = 0;
      return () => `rewrite_id_${++counter}`;
    })(),
    now: (() => {
      let counter = 0;
      return () => `2026-09-17T01:00:${String(++counter).padStart(2, "0")}.000Z`;
    })(),
  });
  v2.initialize();
  const thread: ThreadSummary = {
    id: "thread_rewrite_rpc",
    title: "Rewrite RPC",
    prompt: "original",
    workspacePath: "/tmp/rewrite-rpc",
    status: "completed",
    message: "done",
    coreKind: "claude",
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
  };
  v2.ensureConversation(thread.id);
  let continuationCalls = 0;
  let editCalls = 0;
  const deps: ConversationRewriteCommandDeps = {
    v2,
    requireConversationV2Thread: (threadId) => {
      if (threadId !== thread.id) throw new Error("Thread was not migrated.");
    },
    getThread: (threadId) => (threadId === thread.id ? thread : undefined),
    ensureThreadRuntimeConfig: (value) => value,
    getThreadUserMessageEdit: async (threadId, activityLineId) => {
      editCalls += 1;
      return {
        threadId,
        activityLineId,
        upstreamMessageId: "sdk-user-1",
        text: "original",
        attachments: [],
        historyRevision: v2.head(threadId).historyRevision,
        capability: { status: "ready" },
      };
    },
    startThreadContinuation: async () => {
      continuationCalls += 1;
      return { thread: { ...thread, status: "running", message: "" } };
    },
    errorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
  };
  const request: ThreadRewriteFromMessageRequest = {
    principalId: "desktop-local",
    clientCommandId: "history_rewrite_stable_1",
    threadId: thread.id,
    activityLineId: "sdk:sdk-user-1",
    prompt: "replacement",
    attachments: [],
    expectedHistoryRevision: 0,
  };
  return {
    db,
    deps,
    request,
    thread,
    v2,
    continuationCalls: () => continuationCalls,
    editCalls: () => editCalls,
  };
}

describe("production conversation rewrite command", () => {
  test("retries the same command without repeating edit resolution or runtime dispatch", async () => {
    const harness = createHarness();

    const first = await executeConversationRewriteCommand(
      harness.request,
      harness.deps,
    );
    const retriedAfterLostResponse = await executeConversationRewriteCommand(
      harness.request,
      harness.deps,
    );

    expect(first.thread.status).toBe("running");
    expect(retriedAfterLostResponse.thread).toEqual(harness.thread);
    expect(harness.editCalls()).toBe(1);
    expect(harness.continuationCalls()).toBe(1);
    expect(
      harness.v2.getCommandJob(
        harness.request.principalId,
        harness.request.threadId,
        harness.request.clientCommandId,
      ),
    ).toMatchObject({ status: "running" });
    harness.db.close();
  });

  test("rejects reuse of a client command id with a different prompt or attachments", async () => {
    const harness = createHarness();
    await executeConversationRewriteCommand(harness.request, harness.deps);

    await expect(
      executeConversationRewriteCommand(
        { ...harness.request, prompt: "different replacement" },
        harness.deps,
      ),
    ).rejects.toMatchObject({
      code: CONVERSATION_V2_ERROR.idempotencyConflict,
    });
    await expect(
      executeConversationRewriteCommand(
        {
          ...harness.request,
          attachments: [{ mediaType: "image/png", data: "different" }],
        },
        harness.deps,
      ),
    ).rejects.toMatchObject({
      code: CONVERSATION_V2_ERROR.idempotencyConflict,
    });
    expect(harness.editCalls()).toBe(1);
    expect(harness.continuationCalls()).toBe(1);
    harness.db.close();
  });

  test("durably fails when history changes after acceptance but before execution claim", async () => {
    const harness = createHarness();
    const originalAccept = harness.v2.acceptCommand.bind(harness.v2);
    harness.v2.acceptCommand = (input) => {
      const accepted = originalAccept(input);
      harness.v2.append({
        conversationId: harness.thread.id,
        eventId: "history_changed_between_accept_and_claim",
        type: "history.branch_created",
        occurredAt: "2026-09-17T01:10:00.000Z",
        payload: { reason: "concurrent rewrite" },
      });
      return accepted;
    };

    await expect(
      executeConversationRewriteCommand(harness.request, harness.deps),
    ).rejects.toThrow("V2 history command failed");

    expect(
      harness.v2.getCommandJob(
        harness.request.principalId,
        harness.request.threadId,
        harness.request.clientCommandId,
      ),
    ).toMatchObject({
      status: "failed",
      error: { code: CONVERSATION_V2_ERROR.cursorStale },
    });
    expect(harness.editCalls()).toBe(0);
    expect(harness.continuationCalls()).toBe(0);
    harness.db.close();
  });

  test("durably records preparation failures before runtime dispatch", async () => {
    const harness = createHarness();
    harness.deps.getThreadUserMessageEdit = async () => {
      throw new Error("SDK edit mapping is unavailable");
    };

    await expect(
      executeConversationRewriteCommand(harness.request, harness.deps),
    ).rejects.toThrow("SDK edit mapping is unavailable");

    expect(
      harness.v2.getCommandJob(
        harness.request.principalId,
        harness.request.threadId,
        harness.request.clientCommandId,
      ),
    ).toMatchObject({
      status: "failed",
      error: {
        code: "history_rewrite_failed",
        message: "SDK edit mapping is unavailable",
      },
    });
    expect(harness.continuationCalls()).toBe(0);
    harness.db.close();
  });

  test("uses the same durable rewind coordinator for history retry commands", async () => {
    const harness = createHarness();
    let dispatchedIdentity: unknown;
    harness.deps.startThreadContinuation = async (input) => {
      dispatchedIdentity = input.historyCommand;
      return { thread: { ...harness.thread, status: "running" } };
    };

    await executeConversationRewriteCommand(harness.request, harness.deps, {
      commandType: "history.retry",
      durableRequestExtras: {
        requestedPrompt: "visible failed prompt",
        hasImages: true,
        upstreamMessageId: "sdk-user-1",
      },
    });

    expect(
      harness.v2.getCommandJob(
        harness.request.principalId,
        harness.request.threadId,
        harness.request.clientCommandId,
      ),
    ).toMatchObject({
      commandType: "history.retry",
      request: {
        activityLineId: harness.request.activityLineId,
        prompt: harness.request.prompt,
        attachments: [],
        requestedPrompt: "visible failed prompt",
        hasImages: true,
        upstreamMessageId: "sdk-user-1",
      },
    });
    expect(dispatchedIdentity).toEqual({
      principalId: harness.request.principalId,
      clientCommandId: harness.request.clientCommandId,
    });
    harness.db.close();
  });
});
