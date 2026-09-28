import { describe, expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
  abandonedQueuedAcceptedPrompts,
  discardAbandonedAcceptedPrompts,
} from "../src/main/conversation-follow-up-accepted-prompt";
import { ConversationV2Store } from "../src/main/conversation-v2-store";
import type { ThreadPendingFollowUp } from "../src/shared/ipc";

const CONVERSATION_ID = "thr_follow_up_ghost";

function createStore(): { db: DatabaseSync; store: ConversationV2Store } {
  const db = new DatabaseSync(":memory:");
  const store = new ConversationV2Store(db, {
    idFactory: (() => {
      let counter = 0;
      return () => `id_${++counter}`;
    })(),
    now: (() => {
      let counter = 0;
      return () => `2026-09-28T02:34:0${++counter}.000Z`;
    })(),
  });
  store.initialize();
  return { db, store };
}

/** Mirror the enqueue path: the queue row is written after this acceptance exists. */
function acceptQueuedUserMessage(
  store: ConversationV2Store,
  input: { messageId: string; body: string; turnId: string; index: number },
): void {
  store.append({
    conversationId: CONVERSATION_ID,
    eventId: `accepted_${input.messageId}`,
    sourceEventKey: `desktop:user:accepted:${CONVERSATION_ID}:${input.messageId}`,
    type: "message.accepted",
    occurredAt: `2026-09-28T02:34:${String(input.index).padStart(2, "0")}.000Z`,
    turnId: input.turnId,
    messageId: input.messageId,
    payload: { role: "user", channel: "answer", body: input.body, status: "queued" },
  });
}

function followUpRow(
  id: string,
  status: ThreadPendingFollowUp["status"],
  conversationMessageId: string,
): ThreadPendingFollowUp {
  return {
    id,
    threadId: CONVERSATION_ID,
    prompt: "排队引导",
    priority: "normal",
    status,
    deliveryMode: "queued",
    conversationMessageId,
    createdAt: "2026-09-28T02:34:01.000Z",
    updatedAt: "2026-09-28T02:42:59.000Z",
  };
}

describe("abandoned follow-up acceptances", () => {
  test("recovery settles a cancelled row's acceptance instead of resending it", () => {
    const { db, store } = createStore();
    acceptQueuedUserMessage(store, {
      messageId: "message_delivered_later",
      body: "这条还没发出去",
      turnId: "turn_later",
      index: 1,
    });
    acceptQueuedUserMessage(store, {
      messageId: "message_deleted",
      body: "这条用户删了",
      turnId: "turn_deleted",
      index: 2,
    });
    const followUps = [
      followUpRow("tfu_queued", "queued", "message_delivered_later"),
      followUpRow("tfu_cancelled", "cancelled", "message_deleted"),
    ];
    const listFollowUps = () => followUps;

    const abandoned = abandonedQueuedAcceptedPrompts({
      messages: store.listQueuedUserMessages(),
      listFollowUps,
    });

    expect(abandoned.map((message) => message.messageId)).toEqual(["message_deleted"]);
    for (const message of abandoned) {
      discardAbandonedAcceptedPrompts(store, {
        conversationId: message.conversationId,
        messageIds: [message.messageId],
        reason: "follow-up-abandoned",
      });
    }
    // Recovery may only reschedule the row the queue can still deliver.
    expect(store.listQueuedUserMessages().map((message) => message.messageId)).toEqual([
      "message_delivered_later",
    ]);
    db.close();
  });

  test("discarding a cancelled follow-up takes its queued acceptance out of recovery", () => {
    const { db, store } = createStore();
    acceptQueuedUserMessage(store, {
      messageId: "message_ghost",
      body: "auth.json 有 2 个路径",
      turnId: "turn_ghost",
      index: 1,
    });
    expect(store.listQueuedUserMessages().map((message) => message.messageId)).toEqual(["message_ghost"]);

    const discarded = discardAbandonedAcceptedPrompts(store, {
      conversationId: CONVERSATION_ID,
      messageIds: ["message_ghost"],
      reason: "follow-up-cancelled",
    });

    expect(discarded).toEqual(["message_ghost"]);
    // The ghost is what startup queued-message recovery used to resend as a new run.
    expect(store.listQueuedUserMessages()).toEqual([]);
    expect(store.getMessage(CONVERSATION_ID, "message_ghost")).toMatchObject({
      isDeleted: true,
      status: "deleted",
    });
    db.close();
  });

  test("discarding is idempotent and ignores blank or unknown identities", () => {
    const { db, store } = createStore();
    acceptQueuedUserMessage(store, {
      messageId: "message_once",
      body: "只丢弃一次",
      turnId: "turn_once",
      index: 1,
    });

    expect(
      discardAbandonedAcceptedPrompts(store, {
        conversationId: CONVERSATION_ID,
        messageIds: ["message_once", "", "  ", "message_missing"],
        reason: "follow-up-abandoned",
      }),
    ).toEqual(["message_once"]);
    expect(
      discardAbandonedAcceptedPrompts(store, {
        conversationId: CONVERSATION_ID,
        messageIds: ["message_once"],
        reason: "follow-up-abandoned",
      }),
    ).toEqual([]);
    db.close();
  });

  test("a delivered or failed acceptance is owned by its own outcome, not by the queue row", () => {
    const { db, store } = createStore();
    acceptQueuedUserMessage(store, {
      messageId: "message_delivered",
      body: "真的发出去了",
      turnId: "turn_delivered",
      index: 1,
    });
    store.append({
      conversationId: CONVERSATION_ID,
      eventId: "finalize_delivered",
      type: "message.finalized",
      occurredAt: "2026-09-28T02:35:00.000Z",
      messageId: "message_delivered",
      payload: { status: "final" },
    });

    expect(
      discardAbandonedAcceptedPrompts(store, {
        conversationId: CONVERSATION_ID,
        messageIds: ["message_delivered"],
        reason: "follow-up-cancelled",
      }),
    ).toEqual([]);
    expect(store.getMessage(CONVERSATION_ID, "message_delivered")).toMatchObject({
      isDeleted: false,
      status: "final",
    });
    db.close();
  });
});
