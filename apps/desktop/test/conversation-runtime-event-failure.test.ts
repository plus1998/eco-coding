import { expect, test } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { ConversationStore } from "../src/main/conversation-store";
import { reportConversationRuntimeEventFailure } from "../src/main/conversation-runtime-event-failure";
import { buildThreadRunProjection } from "../src/main/conversation-v2-runtime-projection";
import { projectionItemToDetailBlock } from "../src/renderer/conversation-v2-projection-view";
import type { ThreadRunEventInput } from "../src/shared/thread-run-events";

test("a rejected Codex lifecycle event becomes one Feed error card without changing the agent", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new ConversationStore(db);
    const v2 = store.conversationV2();
    v2.ensureConversation("thread");
    v2.append({
      conversationId: "thread",
      eventId: "agent-start",
      type: "agent.started",
      occurredAt: "2026-09-25T00:00:00Z",
      agentId: "child",
      agentInstanceId: "child",
      parentToolCallId: "spawn-call",
      payload: { role: "explore", kind: "subagent", status: "running" },
    });
    const badEvent: ThreadRunEventInput = {
      threadId: "thread",
      id: "child-stop",
      eventType: "agent.stopped",
      scope: "agent",
      role: "explore",
      agentId: "child",
      parentToolUseId: "different-call",
      streamState: "finalized",
      message: "",
      observedAt: "2026-09-25T00:00:01Z",
    };
    const projectionUpdates: string[] = [];
    const logs: string[] = [];
    const report = () => {
      try {
        store.appendConversationRuntimeEvent(badEvent);
      } catch (error) {
        reportConversationRuntimeEventFailure({
          event: badEvent,
          error,
          appendEvent: (event) => {
            store.appendConversationRuntimeEvent(event);
          },
          onProjectionUpdated: (threadId) => projectionUpdates.push(threadId),
          logError: (message) => logs.push(message),
        });
      }
    };

    expect(report).not.toThrow();
    expect(report).not.toThrow();
    const sources = store.listConversationRuntimeSources("thread");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      eventType: "api.error",
      scope: "main",
      metadata: { activityOrigin: "eco.runtime_event_persist_failure" },
    });
    expect(v2.bootstrap("thread").messages).toEqual([
      expect.objectContaining({
        channel: "system",
        providerRole: "eco_runtime_error",
        body: expect.stringContaining("changed identity or ownership"),
      }),
    ]);
    const projection = buildThreadRunProjection({
      threadId: "thread",
      status: "running",
      attempts: [],
      agents: [],
      events: sources,
    });
    expect(projectionItemToDetailBlock(projection.timeline[0]!)).toMatchObject({
      kind: "api-error",
      title: "会话事件记录失败",
      message: expect.stringContaining("changed identity or ownership"),
    });
    expect(v2.agentsOf("thread")[0]).toMatchObject({ agentId: "child", status: "running" });
    expect(projectionUpdates).toEqual(["thread", "thread"]);
    expect(logs).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("an unavailable Feed write is logged without throwing another main-process error", () => {
  const logs: string[] = [];
  expect(() =>
    reportConversationRuntimeEventFailure({
      event: {
        threadId: "thread",
        id: "failed-event",
        eventType: "agent.stopped",
        scope: "agent",
        streamState: "finalized",
        message: "",
        observedAt: "2026-09-25T00:00:00Z",
      },
      error: new Error("identity conflict"),
      appendEvent: () => {
        throw new Error("database unavailable");
      },
      onProjectionUpdated: () => {
        throw new Error("projection should not update");
      },
      logError: (message) => logs.push(message),
    }),
  ).not.toThrow();
  expect(logs[0]).toContain("identity conflict");
  expect(logs[1]).toContain("database unavailable");
});
