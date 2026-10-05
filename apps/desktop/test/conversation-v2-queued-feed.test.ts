import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import type { ConversationEventInput } from "@eco/shared";
import { ConversationV2Store } from "../src/main/conversation-v2-store";
import { buildConversationV2OnlyProjection } from "../src/renderer/ActivityLogView";
import { buildThreadRunProjectionViewModel } from "../src/renderer/conversation-v2-projection-view";
import { installConversationV2Bootstrap } from "../src/renderer/conversation-v2-renderer-state";
import { buildThreadRunTurnFeedSections } from "../src/renderer/conversation-v2-turn-feed";

test("sending the last reordered follow-up preserves earlier prompt/response boundaries", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationV2Store(db);
    store.initialize();
    const conversationId = "reordered-follow-ups";
    let eventIndex = 0;
    const append = (event: Omit<ConversationEventInput, "conversationId" | "eventId" | "sourceEventKey">) =>
      store.append({
        ...event,
        conversationId,
        eventId: `event_${++eventIndex}`,
        sourceEventKey: `test:queue:${eventIndex}`,
      });
    const accept = (messageId: string, occurredAt: string) =>
      append({
        type: "message.accepted",
        messageId,
        turnId: `turn_${messageId}`,
        occurredAt,
        payload: { role: "user", channel: "answer", body: messageId, status: "queued" },
      });
    const deliver = (messageId: string, occurredAt: string) => {
      append({ type: "message.finalized", messageId, occurredAt, payload: { status: "final" } });
      // A later history binding also advances versionSeq; it is not the delivery clock.
      append({
        type: "message.history_targeted",
        messageId,
        occurredAt,
        payload: { historyTarget: { activityLineId: `user:${messageId}` } },
      });
    };
    const respond = (messageId: string, startedAt: string, endedAt: string) => {
      const runId = `run_${messageId}`;
      append({ type: "run.started", runId, turnId: runId, occurredAt: startedAt, payload: { startedAt } });
      append({
        type: "tool.started",
        runId,
        toolCallId: `tool_${messageId}`,
        occurredAt: startedAt,
        payload: { name: "Read", input: { file_path: `${messageId}.ts` } },
      });
      append({
        type: "message.created",
        messageId: `answer_${messageId}`,
        runId,
        turnId: runId,
        occurredAt: endedAt,
        payload: { role: "assistant", channel: "answer", body: `answer_${messageId}`, status: "final" },
      });
      append({ type: "run.completed", runId, turnId: runId, occurredAt: endedAt, payload: { endedAt } });
    };
    const sections = () => {
      const projection = buildConversationV2OnlyProjection(
        installConversationV2Bootstrap(store.bootstrap(conversationId, 100)),
      );
      return buildThreadRunTurnFeedSections(
        buildThreadRunProjectionViewModel(projection).mainFeedEntries,
        projection,
      );
    };
    const shape = () =>
      sections().map((section) =>
        section.kind === "entry"
          ? {
              kind: "user",
              key: section.key,
              text: section.entry.kind === "timeline" ? section.entry.item.text : "",
            }
          : {
              kind: "turn",
              key: section.key,
              runId: section.attempt.attemptId,
              answer: section.finalEntry?.kind === "timeline" ? section.finalEntry.item.text : "",
              toolIds: section.processEntries.flatMap((entry) =>
                entry.kind === "tool-group"
                  ? entry.entries.map(
                      (child) =>
                        child.item.metadata?.tool &&
                        (child.item.metadata.tool as { toolUseId?: string }).toolUseId,
                    )
                  : [],
              ),
            },
      );

    accept("original", "2026-10-05T08:37:00.000Z");
    deliver("original", "2026-10-05T08:37:01.000Z");
    accept("cancelled", "2026-10-05T08:41:00.000Z");
    accept("last-queued", "2026-10-05T08:42:00.000Z");
    respond("original", "2026-10-05T08:37:02.000Z", "2026-10-05T08:47:00.000Z");
    append({
      type: "history.deleted",
      messageId: "cancelled",
      occurredAt: "2026-10-05T08:47:01.000Z",
      payload: { affectedMessageIds: ["cancelled"] },
    });
    for (const [messageId, acceptedAt, deliveredAt, startedAt, endedAt] of [
      ["guided", "08:48:00", "08:48:01", "08:48:02", "08:48:30"],
      ["confirmed", "08:49:00", "08:49:01", "08:49:02", "09:01:00"],
      ["moved-first", "08:55:00", "09:01:01", "09:01:02", "09:02:00"],
    ] as const) {
      const at = (time: string) => `2026-10-05T${time}.000Z`;
      accept(messageId, at(acceptedAt));
      deliver(messageId, at(deliveredAt));
      respond(messageId, at(startedAt), at(endedAt));
    }
    const before = shape();
    expect(before.map((section) => (section.kind === "user" ? section.text : section.answer))).toEqual([
      "original",
      "answer_original",
      "guided",
      "answer_guided",
      "confirmed",
      "answer_confirmed",
      "moved-first",
      "answer_moved-first",
    ]);

    deliver("last-queued", "2026-10-05T09:08:00.000Z");
    respond("last-queued", "2026-10-05T09:08:01.000Z", "2026-10-05T09:10:00.000Z");
    const after = shape();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.map((section) => (section.kind === "user" ? section.text : section.answer))).toEqual([
      "original",
      "answer_original",
      "guided",
      "answer_guided",
      "confirmed",
      "answer_confirmed",
      "moved-first",
      "answer_moved-first",
      "last-queued",
      "answer_last-queued",
    ]);
    expect(after.filter((section) => section.kind === "turn").map((section) => section.toolIds)).toEqual([
      ["tool_original"],
      ["tool_guided"],
      ["tool_confirmed"],
      ["tool_moved-first"],
      ["tool_last-queued"],
    ]);
  } finally {
    db.close();
  }
});
