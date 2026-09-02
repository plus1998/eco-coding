import { expect, test } from "bun:test";
import {
  buildThreadRunProjectionDetail,
  parseThreadRunProjectionDetailRequest,
} from "../src/main/thread-run-projection-detail";
import { mergeThreadRunProjectionUpdate } from "../src/renderer/run-projection-merge";
import type { ThreadRunProjectionSnapshot, ThreadRunProjectionTimelineItem } from "../src/shared/ipc";

function item(
  id: string,
  sequence: number,
  overrides: Partial<ThreadRunProjectionTimelineItem> = {},
): ThreadRunProjectionTimelineItem {
  return {
    id,
    sequence,
    eventType: "message.final",
    scope: "agent",
    text: id,
    at: `2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

function projection(): ThreadRunProjectionSnapshot {
  const agentTimeline = Array.from({ length: 5 }, (_, index) => item(`agent_evt_${index + 1}`, index + 1));
  const toolItem = item("tool_1", 10, {
    eventType: "tool.completed",
    scope: "main",
    metadata: {
      tool: {
        name: "Bash",
        toolUseId: "toolu_1",
        detail: "npm test",
      },
    },
  });
  const approvalItem = item("approval_1", 11, {
    eventType: "tool.started",
    scope: "agent",
    metadata: {
      bashApproval: {
        toolUseId: "toolu_1",
        phase: "approved",
        toolName: "Bash",
      },
    },
  });
  return {
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [],
    agents: [
      {
        agentId: "agent_1",
        role: "coder",
        kind: "subagent",
        status: "active",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 10,
        timeline: [...agentTimeline, approvalItem],
      },
    ],
    requestSpans: [],
    timeline: [toolItem],
    diagnostics: [],
    sourceEventCount: 7,
  };
}

test("parseThreadRunProjectionDetailRequest accepts valid object", () => {
  expect(
    parseThreadRunProjectionDetailRequest({
      threadId: " thr_1 ",
      kind: "agent",
      key: " agent_1 ",
      afterSequence: 2,
      limit: 3,
    }),
  ).toEqual({
    threadId: "thr_1",
    kind: "agent",
    key: "agent_1",
    afterSequence: 2,
    limit: 3,
  });
});

test("parseThreadRunProjectionDetailRequest rejects invalid objects", () => {
  expect(parseThreadRunProjectionDetailRequest("thr_1")).toBeUndefined();
  expect(
    parseThreadRunProjectionDetailRequest({
      threadId: "thr_1",
      kind: "unknown",
      key: "agent_1",
    }),
  ).toBeUndefined();
});

test("buildThreadRunProjectionDetail pages agent timeline", () => {
  const detail = buildThreadRunProjectionDetail(projection(), {
    threadId: "thr_1",
    kind: "agent",
    key: "agent_1",
    afterSequence: 2,
    limit: 2,
  });

  expect(detail?.agent?.agentId).toBe("agent_1");
  expect(detail?.agent?.timeline).toEqual([]);
  expect(detail?.timeline.map((entry) => entry.id)).toEqual(["agent_evt_3", "agent_evt_4"]);
  expect(detail?.hasMore).toBe(true);
  expect(detail?.nextAfterSequence).toBe(4);
});

test("buildThreadRunProjectionDetail returns tool timeline from main and agent scopes", () => {
  const detail = buildThreadRunProjectionDetail(projection(), {
    threadId: "thr_1",
    kind: "tool",
    key: "toolu_1",
  });

  expect(detail?.timeline.map((entry) => entry.id)).toEqual(["tool_1", "approval_1"]);
  expect(detail?.hasMore).toBe(false);
});

test("buildThreadRunProjectionDetail returns the newest agent page and an earlier cursor", () => {
  const detail = buildThreadRunProjectionDetail(projection(), {
    threadId: "thr_1",
    kind: "agent",
    key: "agent_1",
    tail: true,
    limit: 2,
  });

  expect(detail?.timeline.map((entry) => entry.id)).toEqual(["agent_evt_5", "approval_1"]);
  expect(detail?.hasEarlier).toBe(true);
  expect(detail?.previousBeforeSequence).toBe(5);
  expect(detail?.hasMore).toBe(false);
});

test("buildThreadRunProjectionDetail pages older agent history before a cursor", () => {
  const detail = buildThreadRunProjectionDetail(projection(), {
    threadId: "thr_1",
    kind: "agent",
    key: "agent_1",
    beforeSequence: 5,
    tail: true,
    limit: 2,
  });

  expect(detail?.timeline.map((entry) => entry.id)).toEqual(["agent_evt_3", "agent_evt_4"]);
  expect(detail?.hasEarlier).toBe(true);
});

test("parseThreadRunProjectionDetailRequest accepts main kind", () => {
  expect(
    parseThreadRunProjectionDetailRequest({
      threadId: "thr_1",
      kind: "main",
      key: "thr_1",
      beforeSequence: 10,
      tail: true,
      limit: 100,
    }),
  ).toEqual({
    threadId: "thr_1",
    kind: "main",
    key: "thr_1",
    beforeSequence: 10,
    tail: true,
    limit: 100,
  });
});

test("buildThreadRunProjectionDetail pages a complete turn across main and agent timelines", () => {
  const result = buildThreadRunProjectionDetail(
    {
      ...projection(),
      attempts: [
        {
          attemptId: "attempt_1",
          phase: "execution",
          retryIndex: 0,
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      timeline: [{ ...projection().timeline[0]!, runAttemptId: "attempt_1" }],
      agents: [
        {
          ...projection().agents[0]!,
          timeline: projection().agents[0]!.timeline.map((entry) => ({
            ...entry,
            runAttemptId: "attempt_1",
          })),
        },
      ],
    },
    { threadId: "thr_1", kind: "turn", key: "attempt_1", limit: 50 },
  );

  expect(result?.timeline.map((entry) => entry.id)).toEqual([
    "agent_evt_1",
    "agent_evt_2",
    "agent_evt_3",
    "agent_evt_4",
    "agent_evt_5",
    "tool_1",
    "approval_1",
  ]);
});

test("buildThreadRunProjectionDetail pages older main timeline history", () => {
  const items = Array.from({ length: 6 }, (_, index) =>
    item(`main_${index + 1}`, index + 1, { scope: "main" }),
  );
  const snapshot: ThreadRunProjectionSnapshot = {
    ...projection(),
    timeline: items,
    sourceEventCount: items.length,
  };
  const newest = buildThreadRunProjectionDetail(snapshot, {
    threadId: "thr_1",
    kind: "main",
    key: "thr_1",
    tail: true,
    limit: 2,
  });
  expect(newest?.timeline.map((entry) => entry.id)).toEqual(["main_5", "main_6"]);
  expect(newest?.hasEarlier).toBe(true);
  expect(newest?.previousBeforeSequence).toBe(5);

  const earlier = buildThreadRunProjectionDetail(snapshot, {
    threadId: "thr_1",
    kind: "main",
    key: "thr_1",
    beforeSequence: 5,
    tail: true,
    limit: 2,
  });
  expect(earlier?.timeline.map((entry) => entry.id)).toEqual(["main_3", "main_4"]);
  expect(earlier?.hasEarlier).toBe(true);
  expect(earlier?.previousBeforeSequence).toBe(3);
});

test("buildThreadRunProjectionDetail rejects main kind for mismatched thread key", () => {
  expect(
    buildThreadRunProjectionDetail(projection(), {
      threadId: "thr_1",
      kind: "main",
      key: "thr_other",
      tail: true,
      limit: 2,
    }),
  ).toBeUndefined();
});

test("mergeThreadRunProjectionUpdate preserves loaded deferred content", () => {
  const current = projection();
  current.timeline = [
    item("thinking_1", 20, {
      eventType: "thinking.final",
      scope: "main",
      text: "complete thinking body",
      contentAvailable: true,
      contentLoaded: true,
    }),
  ];
  const incoming: ThreadRunProjectionSnapshot = {
    ...current,
    sourceEventCount: current.sourceEventCount + 1,
    timeline: [
      item("thinking_1", 20, {
        eventType: "thinking.final",
        scope: "main",
        text: "complete thinking",
        contentAvailable: true,
        contentLoaded: false,
      }),
      item("message_1", 21, { scope: "main", text: "done" }),
    ],
  };
  const merged = mergeThreadRunProjectionUpdate(current, incoming);
  const thinking = merged.timeline.find((entry) => entry.id === "thinking_1");
  expect(thinking?.text).toBe("complete thinking body");
  expect(thinking?.contentLoaded).toBe(true);
});
