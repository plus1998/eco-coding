import { describe, expect, test } from "vitest";
import {
  hydrateThreadFeedSkeletonSnapshot,
  isThreadFeedSkeletonFresh,
  resolveFeedSkeletonPatchAgents,
} from "../src/main/thread-feed-skeleton-store";
import type { ThreadRunProjectionSnapshot } from "../src/shared/thread-run-projection";

const baseSnapshot = (): ThreadRunProjectionSnapshot => ({
  thread: {
    threadId: "thr_1",
    status: "idle",
    generatedAt: "2026-01-01T00:00:00.000Z",
  },
  attempts: [
    {
      attemptId: "att_1",
      phase: "execution",
      retryIndex: 0,
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  agents: [],
  requestSpans: [],
  timeline: [
    {
      id: "user_1",
      sequence: 1,
      eventType: "message.final",
      scope: "thread",
      role: "user",
      text: "hello",
      at: "2026-01-01T00:00:00.000Z",
    },
  ],
  diagnostics: [],
  sourceEventCount: 1,
  historyRevision: 0,
});

describe("thread feed skeleton store", () => {
  test("isThreadFeedSkeletonFresh matches revision and sequence", () => {
    const record = {
      historyRevision: 2,
      maxEventSequence: 42,
      snapshot: baseSnapshot(),
    };
    expect(isThreadFeedSkeletonFresh(record, 2, 42)).toBe(true);
    expect(isThreadFeedSkeletonFresh(record, 1, 42)).toBe(false);
    expect(isThreadFeedSkeletonFresh(record, 2, 41)).toBe(false);
  });

  test("hydrateThreadFeedSkeletonSnapshot refreshes volatile thread fields", () => {
    const hydrated = hydrateThreadFeedSkeletonSnapshot(baseSnapshot(), "thr_1", {
      getThread: () => ({
        id: "thr_1",
        title: "Title",
        prompt: "hello",
        workspacePath: "/tmp",
        status: "running",
        message: "working",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      listRunAttempts: () => [
        {
          attemptId: "att_2",
          threadId: "thr_1",
          phase: "execution",
          retryIndex: 0,
          status: "running",
          startedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
      getBilling: () => undefined,
      getContext: () => undefined,
      getHistoryRevision: () => 3,
      getSubagentTimings: () => [],
    });

    expect(hydrated.thread.status).toBe("running");
    expect(hydrated.thread.message).toBe("working");
    expect(hydrated.thread.currentAttemptId).toBe("att_2");
    expect(hydrated.historyRevision).toBe(3);
    expect(hydrated.timeline).toHaveLength(1);
  });

  test("resolveFeedSkeletonPatchAgents heals empty cached agents from store instances", () => {
    const healed = resolveFeedSkeletonPatchAgents([], [
      {
        threadId: "thr_1",
        agentId: "planner:attempt_execution_0",
        role: "planner",
        kind: "planner",
        status: "stopped",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        runAttemptId: "attempt_execution_0",
      },
    ]);

    expect(healed).toHaveLength(1);
    expect(healed[0]).toMatchObject({
      agentId: "planner:attempt_execution_0",
      kind: "planner",
      timeline: [],
    });
  });
});
