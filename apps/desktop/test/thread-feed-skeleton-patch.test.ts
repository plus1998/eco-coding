import { describe, expect, test } from "vitest";
import type { FeedSkeletonPatchContext } from "../src/main/thread-feed-skeleton-patch";
import {
  createFeedSkeletonPatchState,
  createThreadFeedSkeletonRecord,
  feedSkeletonTimelineIds,
  hasFeedSkeletonAttemptBecameTerminal,
  patchThreadFeedSkeletonFromEvent,
  shouldPatchAgentTimelineForFeedSkeleton,
  shouldTrackEventForFeedSkeletonPatch,
} from "../src/main/thread-feed-skeleton-patch";
import { buildThreadRunProjection, eventToTimelineItem } from "../src/main/thread-run-projection";
import { trimProjectionForFeed } from "../src/main/thread-run-projection-feed";
import type { RunAttemptRecord } from "../src/main/usage-ledger";
import type { ThreadRunEvent } from "../src/shared/ipc";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/thread-run-projection";
import { selectSkeletonTimelineItems } from "../src/shared/thread-run-projection-skeleton";

const THREAD_ID = "thr_patch";
const STARTED_AT = "2026-01-01T00:00:00.000Z";

function runEvent(
  overrides: Partial<ThreadRunEvent> & Pick<ThreadRunEvent, "id" | "sequence" | "eventType" | "message">,
): ThreadRunEvent {
  return {
    threadId: THREAD_ID,
    scope: "main",
    streamState: "finalized",
    observedAt: `2026-01-01T00:00:${String(overrides.sequence).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

function attemptRecord(
  attemptId: string,
  status: RunAttemptRecord["status"],
  startedAt = STARTED_AT,
): RunAttemptRecord {
  return {
    attemptId,
    threadId: THREAD_ID,
    phase: "run",
    retryIndex: 0,
    status,
    startedAt,
    ...(status === "running" ? {} : { endedAt: "2026-01-01T00:10:00.000Z" }),
  };
}

function projectionAttempt(
  attemptId: string,
  status: ThreadRunProjectionAttempt["status"],
  startedAt = STARTED_AT,
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

function mapAttempts(records: readonly RunAttemptRecord[]): ThreadRunProjectionAttempt[] {
  return records.map((record) => projectionAttempt(record.attemptId, record.status, record.startedAt));
}

function emptySnapshot() {
  return {
    thread: {
      threadId: THREAD_ID,
      status: "running",
      generatedAt: STARTED_AT,
    },
    attempts: [] as ThreadRunProjectionAttempt[],
    agents: [],
    requestSpans: [],
    timeline: [] as ThreadRunProjectionTimelineItem[],
    diagnostics: [],
    sourceEventCount: 0,
    historyRevision: 0,
  };
}

function patchContext(
  attempts: readonly ThreadRunProjectionAttempt[],
  maxEventSequence: number,
  agents: readonly ThreadRunProjectionAgent[] = [],
): FeedSkeletonPatchContext {
  return {
    attempts,
    agents: [...agents],
    historyRevision: 0,
    maxEventSequence,
  };
}

function exploreAgent(
  status: ThreadRunProjectionAgent["status"] = "active",
): ThreadRunProjectionAgent {
  return {
    agentId: "explore_a",
    role: "explore",
    kind: "subagent",
    status,
    startedAt: STARTED_AT,
    durationMs: 0,
    timeline: [],
  };
}

function referenceFeedTimelineIds(
  events: readonly ThreadRunEvent[],
  attempts: readonly RunAttemptRecord[],
): string[] {
  const projection = buildThreadRunProjection({
    threadId: THREAD_ID,
    status: "running",
    attempts,
    agents: [],
    events,
    historyComplete: true,
  });
  return trimProjectionForFeed(projection).timeline.map((item) => item.id);
}

function replayPatchTimelineIds(
  events: readonly ThreadRunEvent[],
  attempts: readonly RunAttemptRecord[],
): string[] {
  let record = createThreadFeedSkeletonRecord(emptySnapshot(), {
    attempts: mapAttempts(attempts),
    agents: [],
    historyRevision: 0,
    maxEventSequence: 0,
  });
  record.patchState = createFeedSkeletonPatchState(record.snapshot);

  for (const event of events) {
    const attemptRecords = [...attempts];
    const context = patchContext(mapAttempts(attemptRecords), event.sequence);
    const patched = patchThreadFeedSkeletonFromEvent(record, event, context);
    expect(patched).not.toBeNull();
    record = patched!;
  }
  return feedSkeletonTimelineIds(record.snapshot);
}

describe("thread feed skeleton patch", () => {
  test("matches selectSkeletonTimelineItems for multi-turn completed thread", () => {
    const attempts = [attemptRecord("att_1", "completed")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "message.final",
        message: "第一句",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "tool_1",
        sequence: 2,
        eventType: "tool.completed",
        message: "Tool: Bash",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "narr_1",
        sequence: 3,
        eventType: "message.final",
        message: "过程旁白",
        role: "coder",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "final_1",
        sequence: 4,
        eventType: "message.final",
        message: "第一轮最终输出",
        role: "coder",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "user_2",
        sequence: 5,
        eventType: "message.final",
        message: "要啊，不然我怎么设置呢",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "think_2",
        sequence: 6,
        eventType: "thinking.delta",
        message: "思考中",
        role: "thinking",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "final_2",
        sequence: 7,
        eventType: "message.final",
        message: "第二轮最终输出",
        role: "coder",
        runAttemptId: "att_1",
      }),
    ];

    const timeline = events.map((event) => eventToTimelineItem(event));
    const selected = selectSkeletonTimelineItems(timeline, mapAttempts(attempts)).map((item) => item.id);
    const patched = replayPatchTimelineIds(events, attempts);
    expect(patched).toEqual(selected);
    expect(patched).toEqual(referenceFeedTimelineIds(events, attempts));
  });

  test("keeps running attempt process items until attempt completes", () => {
    const attempts = [attemptRecord("att_run", "running")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "message.final",
        message: "继续",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "tool_live",
        sequence: 2,
        eventType: "tool.started",
        message: "Tool: Read",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "delta_live",
        sequence: 3,
        eventType: "message.delta",
        message: "正在写",
        role: "coder",
        runAttemptId: "att_run",
        streamKey: "stream_1",
        streamState: "streaming",
      }),
    ];

    const patched = replayPatchTimelineIds(events, attempts);
    expect(patched).toEqual(["user_1", "tool_live", "delta_live"]);

    const completedAttempts = [attemptRecord("att_run", "completed")];
    const finalEvents = [
      ...events,
      runEvent({
        id: "final_run",
        sequence: 4,
        eventType: "message.final",
        message: "写完了",
        role: "coder",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "att_done",
        sequence: 5,
        eventType: "run.attempt.completed",
        message: "Turn completed",
        runAttemptId: "att_run",
      }),
    ];
    const patchedAfterComplete = replayPatchTimelineIds(finalEvents, completedAttempts);
    expect(patchedAfterComplete).toEqual(["user_1", "final_run"]);
    expect(patchedAfterComplete).toEqual(referenceFeedTimelineIds(finalEvents, completedAttempts));
  });

  test("keeps every running-attempt message.final between tools (no mid-turn collapse)", () => {
    const attempts = [attemptRecord("att_run", "running")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "thread.status",
        message: "修一下 Feed 丢正文",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "narr_1",
        sequence: 2,
        eventType: "message.final",
        message: "先改 shared helpers",
        role: "planner",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "tool_1",
        sequence: 3,
        eventType: "tool.completed",
        message: "Tool: Edit · helpers.ts",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "narr_2",
        sequence: 4,
        eventType: "message.final",
        message: "再改 main handler",
        role: "planner",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "tool_2",
        sequence: 5,
        eventType: "tool.started",
        message: "Tool: Edit · index.ts",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "narr_3",
        sequence: 6,
        eventType: "message.final",
        message: "最后补测试",
        role: "planner",
        runAttemptId: "att_run",
      }),
    ];

    const patched = replayPatchTimelineIds(events, attempts);
    expect(patched).toEqual(["user_1", "narr_1", "tool_1", "narr_2", "tool_2", "narr_3"]);
    expect(patched).toEqual(referenceFeedTimelineIds(events, attempts));

    const completedAttempts = [attemptRecord("att_run", "completed")];
    const finalEvents = [
      ...events,
      runEvent({
        id: "att_done",
        sequence: 7,
        eventType: "run.attempt.completed",
        message: "Turn completed",
        runAttemptId: "att_run",
      }),
    ];
    const patchedAfterComplete = replayPatchTimelineIds(finalEvents, completedAttempts);
    expect(patchedAfterComplete).toEqual(["user_1", "narr_3"]);
    expect(patchedAfterComplete).toEqual(referenceFeedTimelineIds(finalEvents, completedAttempts));
  });

  test("running-attempt tool.failed does not wipe earlier message.final bodies", () => {
    const attempts = [attemptRecord("att_run", "running")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "thread.status",
        message: "继续改",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "narr_1",
        sequence: 2,
        eventType: "message.final",
        message: "先写测试",
        role: "planner",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "tool_ok",
        sequence: 3,
        eventType: "tool.completed",
        message: "Tool: Edit · ok.ts",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "tool_fail",
        sequence: 4,
        eventType: "tool.failed",
        message: "Tool failed: Edit overlap",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "tool_retry",
        sequence: 5,
        eventType: "tool.started",
        message: "Tool: Edit · retry.ts",
        runAttemptId: "att_run",
      }),
    ];

    const patched = replayPatchTimelineIds(events, attempts);
    expect(patched).toEqual(["user_1", "narr_1", "tool_ok", "tool_fail", "tool_retry"]);
    expect(patched).toEqual(referenceFeedTimelineIds(events, attempts));
  });

  test("completed-attempt tool.failed after message.final keeps the narrative final", () => {
    const attempts = [attemptRecord("att_1", "completed")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "thread.status",
        message: "提问",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "narr_1",
        sequence: 2,
        eventType: "message.final",
        message: "回答正文",
        role: "planner",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "tool_fail",
        sequence: 3,
        eventType: "tool.failed",
        message: "Tool failed: Edit overlap",
        runAttemptId: "att_1",
      }),
    ];

    const patched = replayPatchTimelineIds(events, attempts);
    expect(patched).toEqual(["user_1", "narr_1"]);
    expect(patched).toEqual(referenceFeedTimelineIds(events, attempts));
  });

  test("ignores completed-attempt tool noise but advances sequence watermark", () => {
    const attempts = [attemptRecord("att_1", "completed")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "message.final",
        message: "提问",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "final_1",
        sequence: 2,
        eventType: "message.final",
        message: "回答",
        role: "coder",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "tool_noise_1",
        sequence: 3,
        eventType: "tool.completed",
        message: "Tool: Bash",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "tool_noise_2",
        sequence: 4,
        eventType: "tool.completed",
        message: "Tool: Read",
        runAttemptId: "att_1",
      }),
    ];

    expect(shouldTrackEventForFeedSkeletonPatch(events[2]!, mapAttempts(attempts))).toBe(false);
    expect(shouldTrackEventForFeedSkeletonPatch(events[3]!, mapAttempts(attempts))).toBe(false);

    let record = createThreadFeedSkeletonRecord(emptySnapshot(), {
      attempts: mapAttempts(attempts),
      agents: [],
      historyRevision: 0,
      maxEventSequence: 0,
    });
    record.patchState = createFeedSkeletonPatchState(record.snapshot);
    for (const event of events) {
      record = patchThreadFeedSkeletonFromEvent(
        record,
        event,
        patchContext(mapAttempts(attempts), event.sequence),
      )!;
    }
    expect(feedSkeletonTimelineIds(record.snapshot)).toEqual(["user_1", "final_1"]);
    expect(record.maxEventSequence).toBe(4);
  });

  test("matches reference feed projection across a long tool-heavy thread", () => {
    const attempts = [attemptRecord("att_1", "completed")];
    const events: ThreadRunEvent[] = [];
    let sequence = 0;
    const push = (event: Omit<Parameters<typeof runEvent>[0], "sequence">) => {
      sequence += 1;
      events.push(runEvent({ ...event, sequence }));
    };

    push({
      id: "user_open",
      eventType: "message.final",
      message: "开始",
      role: "user",
      metadata: { liveType: "thread.user_prompt" },
    });
    for (let index = 1; index <= 120; index += 1) {
      push({
        id: `tool_${index}`,
        eventType: "tool.completed",
        message: `Tool ${index}`,
        runAttemptId: "att_1",
      });
    }
    push({
      id: "user_mid",
      eventType: "message.final",
      message: "中间提问",
      role: "user",
      metadata: { liveType: "thread.user_prompt" },
    });
    for (let index = 1; index <= 80; index += 1) {
      push({
        id: `tool_mid_${index}`,
        eventType: "tool.completed",
        message: `Mid tool ${index}`,
        runAttemptId: "att_1",
      });
    }
    push({
      id: "final_mid",
      eventType: "message.final",
      message: "中间回答",
      role: "coder",
      runAttemptId: "att_1",
    });
    push({
      id: "user_close",
      eventType: "message.final",
      message: "结束",
      role: "user",
      metadata: { liveType: "thread.user_prompt" },
    });
    push({
      id: "final_close",
      eventType: "message.final",
      message: "最终回答",
      role: "coder",
      runAttemptId: "att_1",
    });

    const patched = replayPatchTimelineIds(events, attempts);
    const reference = referenceFeedTimelineIds(events, attempts);
    expect(patched).toEqual(reference);
    expect(patched.filter((id) => id.startsWith("tool_"))).toEqual([]);
    expect(patched.filter((id) => id.startsWith("user_"))).toEqual(["user_open", "user_mid", "user_close"]);
  });

  test("uses api.error as segment final when no message.final exists", () => {
    const attempts = [attemptRecord("att_1", "failed")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "message.final",
        message: "提问",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "tool_1",
        sequence: 2,
        eventType: "tool.completed",
        message: "Tool: Bash",
        runAttemptId: "att_1",
      }),
      runEvent({
        id: "err_1",
        sequence: 3,
        eventType: "api.error",
        message: "请求失败",
        role: "coder",
        runAttemptId: "att_1",
      }),
    ];

    expect(replayPatchTimelineIds(events, attempts)).toEqual(["user_1", "err_1"]);
    expect(replayPatchTimelineIds(events, attempts)).toEqual(referenceFeedTimelineIds(events, attempts));
  });

  test("updates stream delta text in place for running attempts", () => {
    const attempts = [attemptRecord("att_run", "running")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "message.final",
        message: "写代码",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "delta_1",
        sequence: 2,
        eventType: "message.delta",
        message: "正在",
        role: "coder",
        runAttemptId: "att_run",
        streamKey: "stream_1",
        streamState: "streaming",
      }),
      runEvent({
        id: "delta_1",
        sequence: 2,
        eventType: "message.delta",
        message: "正在写代码",
        role: "coder",
        runAttemptId: "att_run",
        streamKey: "stream_1",
        streamState: "streaming",
      }),
    ];

    const patched = replayPatchTimelineIds(events, attempts);
    expect(patched).toEqual(["user_1", "delta_1"]);
    let record = createThreadFeedSkeletonRecord(emptySnapshot(), {
      attempts: mapAttempts(attempts),
      agents: [],
      historyRevision: 0,
      maxEventSequence: 0,
    });
    record.patchState = createFeedSkeletonPatchState(record.snapshot);
    for (const event of events) {
      record = patchThreadFeedSkeletonFromEvent(
        record,
        event,
        patchContext(mapAttempts(attempts), event.sequence),
      )!;
    }
    const delta = record.snapshot.timeline.find((item) => item.id === "delta_1");
    expect(delta?.text).toBe("正在写代码");
  });

  test("does not put running-attempt subagent prompt or thinking on the main skeleton", () => {
    const attempts = [attemptRecord("att_run", "running")];
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "thread.status",
        message: "加产品排行",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "planner_final",
        sequence: 2,
        eventType: "message.final",
        message: "我先用 explore 勘察",
        role: "assistant",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "explore_prompt",
        sequence: 3,
        eventType: "message.final",
        scope: "agent",
        message: "请只读探索当前仓库，禁止编辑、生成或删除任何文件。",
        role: "explore",
        agentId: "explore_a",
        runAttemptId: "att_run",
        metadata: { liveType: "message.user", itemType: "userMessage" },
      }),
      runEvent({
        id: "explore_think",
        sequence: 4,
        eventType: "thinking.delta",
        scope: "agent",
        message: "The user wants me to explore the codebase",
        role: "explore",
        agentId: "explore_a",
        runAttemptId: "att_run",
      }),
    ];

    expect(shouldTrackEventForFeedSkeletonPatch(events[2]!, mapAttempts(attempts))).toBe(false);
    expect(shouldTrackEventForFeedSkeletonPatch(events[3]!, mapAttempts(attempts))).toBe(false);
    expect(shouldPatchAgentTimelineForFeedSkeleton(events[2]!)).toBe(true);
    expect(shouldPatchAgentTimelineForFeedSkeleton(events[3]!)).toBe(true);
    expect(replayPatchTimelineIds(events, attempts)).toEqual(["user_1", "planner_final"]);
  });

  test("routes running-attempt subagent prompt and thinking onto the live agent timeline", () => {
    const attempts = [projectionAttempt("att_run", "running")];
    const agent = exploreAgent();
    const events = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "thread.status",
        message: "加产品排行",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "planner_final",
        sequence: 2,
        eventType: "message.final",
        message: "我先用 explore 勘察",
        role: "assistant",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "explore_prompt",
        sequence: 3,
        eventType: "message.final",
        scope: "agent",
        message: "请只读探索当前仓库，禁止编辑、生成或删除任何文件。",
        role: "explore",
        agentId: "explore_a",
        runAttemptId: "att_run",
        metadata: { liveType: "message.user", itemType: "userMessage" },
      }),
      runEvent({
        id: "explore_think",
        sequence: 4,
        eventType: "thinking.delta",
        scope: "agent",
        message: "The user wants me to explore the codebase",
        role: "explore",
        agentId: "explore_a",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "planner_think",
        sequence: 5,
        eventType: "thinking.delta",
        message: "**Preparing subagent**",
        role: "thinking",
        runAttemptId: "att_run",
      }),
    ];

    let record = createThreadFeedSkeletonRecord(
      {
        ...emptySnapshot(),
        attempts,
        agents: [agent],
      },
      {
        attempts,
        agents: [agent],
        historyRevision: 0,
        maxEventSequence: 0,
      },
    );
    record.patchState = createFeedSkeletonPatchState(record.snapshot);
    for (const event of events) {
      record = patchThreadFeedSkeletonFromEvent(
        record,
        event,
        patchContext(attempts, event.sequence, [agent]),
      )!;
    }

    expect(feedSkeletonTimelineIds(record.snapshot)).toEqual([
      "user_1",
      "planner_final",
      "planner_think",
    ]);
    expect(record.snapshot.timeline.some((item) => item.scope === "agent")).toBe(false);
    expect(record.snapshot.agents[0]?.timeline.map((item) => item.id)).toEqual([
      "explore_prompt",
      "explore_think",
    ]);
    expect(record.snapshot.agents[0]?.latestActivity).toBe("The user wants me to explore the codebase");
  });

  test("strips already leaked agent-scoped items from a dirty skeleton on the next patch", () => {
    const attempts = [projectionAttempt("att_run", "running")];
    const leaked = {
      id: "explore_prompt",
      sequence: 3,
      eventType: "message.final" as const,
      scope: "agent" as const,
      role: "explore",
      text: "请只读探索当前仓库",
      at: "2026-01-01T00:00:03.000Z",
      metadata: { liveType: "message.user" },
    };
    let record = createThreadFeedSkeletonRecord(
      {
        ...emptySnapshot(),
        attempts,
        timeline: [
          {
            id: "user_1",
            sequence: 1,
            eventType: "thread.status",
            scope: "main",
            role: "user",
            text: "加产品排行",
            at: "2026-01-01T00:00:01.000Z",
            metadata: { liveType: "thread.user_prompt" },
          },
          leaked,
        ],
      },
      {
        attempts,
        agents: [],
        historyRevision: 0,
        maxEventSequence: 3,
      },
    );
    record.patchState = {
      trackedItems: [
        ...(record.patchState?.trackedItems ?? []),
        leaked,
      ],
    };

    const patched = patchThreadFeedSkeletonFromEvent(
      record,
      runEvent({
        id: "planner_think",
        sequence: 5,
        eventType: "thinking.delta",
        message: "**Preparing subagent**",
        role: "thinking",
        runAttemptId: "att_run",
      }),
      patchContext(attempts, 5),
    );

    expect(patched).not.toBeNull();
    expect(feedSkeletonTimelineIds(patched!.snapshot)).toEqual(["user_1", "planner_think"]);
    expect(patched!.snapshot.timeline.some((item) => item.scope === "agent")).toBe(false);
  });

  test("compacts live process rows on request.failed without run.attempt.*", () => {
    const running = [attemptRecord("att_run", "running")];
    const failed = [attemptRecord("att_run", "failed")];
    const liveEvents = [
      runEvent({
        id: "user_1",
        sequence: 1,
        eventType: "message.final",
        message: "提问",
        role: "user",
        metadata: { liveType: "thread.user_prompt" },
      }),
      runEvent({
        id: "tool_live",
        sequence: 2,
        eventType: "tool.completed",
        message: "Tool: Bash",
        runAttemptId: "att_run",
      }),
      runEvent({
        id: "delta_live",
        sequence: 3,
        eventType: "message.delta",
        message: "还在写",
        role: "coder",
        runAttemptId: "att_run",
        streamKey: "stream_1",
        streamState: "streaming",
      }),
    ];

    let record = createThreadFeedSkeletonRecord(emptySnapshot(), {
      attempts: mapAttempts(running),
      agents: [],
      historyRevision: 0,
      maxEventSequence: 0,
    });
    record.patchState = createFeedSkeletonPatchState(record.snapshot);
    for (const event of liveEvents) {
      record = patchThreadFeedSkeletonFromEvent(
        record,
        event,
        patchContext(mapAttempts(running), event.sequence),
      )!;
    }
    expect(feedSkeletonTimelineIds(record.snapshot)).toEqual(["user_1", "tool_live", "delta_live"]);

    record = patchThreadFeedSkeletonFromEvent(
      record,
      runEvent({
        id: "req_failed",
        sequence: 4,
        eventType: "request.failed",
        message: "请求失败",
        runAttemptId: "att_run",
      }),
      patchContext(mapAttempts(failed), 4),
    )!;

    expect(feedSkeletonTimelineIds(record.snapshot)).toEqual(["user_1"]);
    expect(shouldTrackEventForFeedSkeletonPatch(
      runEvent({
        id: "req_failed",
        sequence: 4,
        eventType: "request.failed",
        message: "请求失败",
        runAttemptId: "att_run",
      }),
      mapAttempts(failed),
    )).toBe(false);
  });

  test("reconciles when attempt becomes terminal even without a terminal event type", () => {
    const running = [projectionAttempt("att_run", "running")];
    const failed = [projectionAttempt("att_run", "failed")];
    let record = createThreadFeedSkeletonRecord(
      {
        ...emptySnapshot(),
        attempts: running,
        timeline: [
          {
            id: "user_1",
            sequence: 1,
            eventType: "message.final",
            scope: "main",
            role: "user",
            text: "提问",
            at: "2026-01-01T00:00:01.000Z",
            metadata: { liveType: "thread.user_prompt" },
          },
          {
            id: "tool_live",
            sequence: 2,
            eventType: "tool.completed",
            scope: "main",
            role: "coder",
            text: "Tool: Bash",
            at: "2026-01-01T00:00:02.000Z",
            runAttemptId: "att_run",
          },
        ],
      },
      {
        attempts: running,
        agents: [],
        historyRevision: 0,
        maxEventSequence: 2,
      },
    );
    record.patchState = createFeedSkeletonPatchState(record.snapshot);

    const patched = patchThreadFeedSkeletonFromEvent(
      record,
      runEvent({
        id: "noise_after_stop",
        sequence: 3,
        eventType: "tool.completed",
        message: "Tool: Read",
        runAttemptId: "att_run",
      }),
      patchContext(failed, 3),
    );

    expect(patched).not.toBeNull();
    expect(feedSkeletonTimelineIds(patched!.snapshot)).toEqual(["user_1"]);
    expect(hasFeedSkeletonAttemptBecameTerminal(running, failed)).toBe(true);
  });
});
