import { expect, test } from "bun:test";
import {
  buildThreadRunProjectionDetail,
  parseThreadRunProjectionDetailRequest,
} from "../src/main/thread-run-projection-detail";
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
  const agentTimeline = Array.from({ length: 5 }, (_, index) =>
    item(`agent_evt_${index + 1}`, index + 1),
  );
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
