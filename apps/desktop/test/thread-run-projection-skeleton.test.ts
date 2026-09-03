import { expect, test } from "bun:test";
import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";
import {
  buildSkeletonFeedProjection,
  selectSkeletonTimelineItems,
} from "../src/shared/thread-run-projection-skeleton";

function item(
  overrides: Partial<ThreadRunProjectionTimelineItem> &
    Pick<ThreadRunProjectionTimelineItem, "id" | "sequence" | "eventType" | "text">,
): ThreadRunProjectionTimelineItem {
  return {
    scope: "main",
    at: `2026-01-01T00:00:${String(overrides.sequence).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

function userPrompt(id: string, sequence: number, text: string): ThreadRunProjectionTimelineItem {
  return item({
    id,
    sequence,
    eventType: "thread.status",
    text,
    role: "user",
    metadata: { liveType: "thread.user_prompt" },
  });
}

function attempt(
  attemptId: string,
  status: ThreadRunProjectionAttempt["status"],
  startedAt: string,
): ThreadRunProjectionAttempt {
  return {
    attemptId,
    phase: "run",
    retryIndex: 0,
    status,
    startedAt,
    ...(status === "running" ? {} : { endedAt: "2026-01-01T00:10:00.000Z" }),
  };
}

test("selectSkeletonTimelineItems keeps every user prompt and only the last readable final per segment", () => {
  const timeline = [
    userPrompt("user_1", 1, "第一句"),
    item({
      id: "tool_1",
      sequence: 2,
      eventType: "tool.completed",
      text: "Tool: Bash",
      runAttemptId: "att_1",
    }),
    item({
      id: "narr_1",
      sequence: 3,
      eventType: "message.final",
      text: "过程旁白",
      runAttemptId: "att_1",
    }),
    item({
      id: "final_1",
      sequence: 4,
      eventType: "message.final",
      text: "第一轮最终输出",
      runAttemptId: "att_1",
    }),
    userPrompt("user_2", 5, "要啊，不然我怎么设置呢"),
    item({
      id: "think_2",
      sequence: 6,
      eventType: "thinking.delta",
      text: "思考中",
      role: "thinking",
      runAttemptId: "att_1",
    }),
    item({
      id: "final_2",
      sequence: 7,
      eventType: "message.final",
      text: "第二轮最终输出",
      runAttemptId: "att_1",
    }),
  ];
  const selected = selectSkeletonTimelineItems(timeline, [
    attempt("att_1", "completed", "2026-01-01T00:00:00.000Z"),
  ]);

  expect(selected.map((row) => row.id)).toEqual(["user_1", "final_1", "user_2", "final_2"]);
});

test("selectSkeletonTimelineItems keeps process items for a running attempt", () => {
  const timeline = [
    userPrompt("user_1", 1, "继续"),
    item({
      id: "tool_live",
      sequence: 2,
      eventType: "tool.started",
      text: "Tool: Read",
      runAttemptId: "att_run",
    }),
    item({
      id: "delta_live",
      sequence: 3,
      eventType: "message.delta",
      text: "正在写",
      runAttemptId: "att_run",
    }),
  ];
  const selected = selectSkeletonTimelineItems(timeline, [
    attempt("att_run", "running", "2026-01-01T00:00:00.000Z"),
  ]);

  expect(selected.map((row) => row.id)).toEqual(["user_1", "tool_live", "delta_live"]);
});

test("selectSkeletonTimelineItems falls back to api.error when a segment has no message.final", () => {
  const timeline = [
    userPrompt("user_1", 1, "提问"),
    item({
      id: "tool_1",
      sequence: 2,
      eventType: "tool.completed",
      text: "Tool: Bash",
      runAttemptId: "att_1",
    }),
    item({
      id: "err_1",
      sequence: 3,
      eventType: "api.error",
      text: "请求失败",
      runAttemptId: "att_1",
    }),
  ];
  const selected = selectSkeletonTimelineItems(timeline, [
    attempt("att_1", "failed", "2026-01-01T00:00:00.000Z"),
  ]);

  expect(selected.map((row) => row.id)).toEqual(["user_1", "err_1"]);
});

test("skeleton keeps mid-thread user prompts that a 100-item page window would drop", () => {
  const attempts = [attempt("att_1", "completed", "2026-01-01T00:00:00.000Z")];
  const timeline: ThreadRunProjectionTimelineItem[] = [];
  for (let index = 1; index <= 250; index += 1) {
    if (index === 50) {
      timeline.push(userPrompt("user_mid", index, "要啊，不然我怎么设置呢"));
      continue;
    }
    if (index === 51) {
      timeline.push(
        item({
          id: "final_after_mid",
          sequence: index,
          eventType: "message.final",
          text: "收到，继续设置",
          runAttemptId: "att_1",
        }),
      );
      continue;
    }
    timeline.push(
      item({
        id: `tool_${index}`,
        sequence: index,
        eventType: "tool.completed",
        text: `Tool ${index}`,
        runAttemptId: "att_1",
      }),
    );
  }
  timeline.push(userPrompt("user_late", 251, "后面一句"));
  timeline.push(
    item({
      id: "final_late",
      sequence: 252,
      eventType: "message.final",
      text: "最后一轮输出",
      runAttemptId: "att_1",
    }),
  );

  const selected = selectSkeletonTimelineItems(timeline, attempts);
  expect(selected.some((row) => row.id === "user_mid")).toBe(true);
  expect(selected.some((row) => row.text === "要啊，不然我怎么设置呢")).toBe(true);
  expect(selected.some((row) => row.id === "user_late")).toBe(true);
  expect(selected.some((row) => row.id === "tool_200")).toBe(false);
  expect(selected.map((row) => row.id)).toContain("final_after_mid");
  expect(selected.map((row) => row.id)).toContain("final_late");
});

test("buildSkeletonFeedProjection clears agent timelines and omits hasEarlier", () => {
  const snapshot: ThreadRunProjectionSnapshot = {
    thread: {
      threadId: "thr_1",
      status: "idle",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [attempt("att_1", "completed", "2026-01-01T00:00:00.000Z")],
    agents: [
      {
        agentId: "agent_1",
        role: "explore",
        kind: "subagent",
        status: "stopped",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 1,
        latestActivity: "正在搜索",
        timeline: [
          item({
            id: "agent_evt",
            sequence: 9,
            eventType: "message.final",
            text: "子代理过程",
            scope: "agent",
          }),
        ],
      },
    ],
    requestSpans: [],
    timeline: [
      userPrompt("user_1", 1, "搜一下"),
      item({
        id: "final_1",
        sequence: 2,
        eventType: "message.final",
        text: "搜完了",
        runAttemptId: "att_1",
      }),
    ],
    diagnostics: [],
    sourceEventCount: 3,
    hasEarlier: true,
    historyRevision: 0,
  };

  const skeleton = buildSkeletonFeedProjection(snapshot);
  expect(skeleton.hasEarlier).toBeUndefined();
  expect(skeleton.agents[0]?.timeline).toEqual([]);
  expect(skeleton.agents[0]?.latestActivity).toBe("正在搜索");
  expect(skeleton.timeline.map((row) => row.id)).toEqual(["user_1", "final_1"]);
});

test("buildSkeletonFeedProjection keeps active agent process timelines", () => {
  const agentItem = item({
    id: "agent_evt",
    sequence: 9,
    eventType: "thinking.delta",
    text: "正在搜索仓库",
    scope: "agent",
    role: "explore",
  });
  const snapshot: ThreadRunProjectionSnapshot = {
    thread: {
      threadId: "thr_1",
      status: "running",
      generatedAt: "2026-01-01T00:00:00.000Z",
    },
    attempts: [attempt("att_run", "running", "2026-01-01T00:00:00.000Z")],
    agents: [
      {
        agentId: "agent_1",
        role: "explore",
        kind: "subagent",
        status: "active",
        startedAt: "2026-01-01T00:00:00.000Z",
        durationMs: 1,
        latestActivity: "正在搜索仓库",
        timeline: [agentItem],
      },
    ],
    requestSpans: [],
    timeline: [userPrompt("user_1", 1, "搜一下")],
    diagnostics: [],
    sourceEventCount: 2,
    historyRevision: 0,
  };

  const skeleton = buildSkeletonFeedProjection(snapshot);
  expect(skeleton.agents[0]?.timeline).toEqual([agentItem]);
  expect(skeleton.agents[0]?.latestActivity).toBe("正在搜索仓库");
});

test("selectSkeletonTimelineItems drops agent-scoped subagent prompt and thinking from a running attempt", () => {
  const timeline = [
    userPrompt("user_1", 1, "加产品排行"),
    item({
      id: "planner_final",
      sequence: 2,
      eventType: "message.final",
      text: "我先用 explore 勘察",
      role: "assistant",
      runAttemptId: "att_run",
    }),
    item({
      id: "explore_prompt",
      sequence: 3,
      eventType: "message.final",
      scope: "agent",
      role: "explore",
      text: "请只读探索当前仓库",
      runAttemptId: "att_run",
      metadata: { liveType: "message.user", itemType: "userMessage" },
    }),
    item({
      id: "explore_think",
      sequence: 4,
      eventType: "thinking.delta",
      scope: "agent",
      role: "explore",
      text: "The user wants me to explore the codebase",
      runAttemptId: "att_run",
    }),
  ];
  const selected = selectSkeletonTimelineItems(timeline, [
    attempt("att_run", "running", "2026-01-01T00:00:00.000Z"),
  ]);

  expect(selected.map((row) => row.id)).toEqual(["user_1", "planner_final"]);
});
