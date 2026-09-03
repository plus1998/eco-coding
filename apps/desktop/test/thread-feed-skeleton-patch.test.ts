import { describe, expect, test } from "vitest";
import type { FeedSkeletonPatchContext } from "../src/main/thread-feed-skeleton-patch";
import {
  createFeedSkeletonPatchState,
  createThreadFeedSkeletonRecord,
  feedSkeletonTimelineIds,
  patchThreadFeedSkeletonFromEvent,
  shouldTrackEventForFeedSkeletonPatch,
} from "../src/main/thread-feed-skeleton-patch";
import { buildThreadRunProjection, eventToTimelineItem } from "../src/main/thread-run-projection";
import { trimProjectionForFeed } from "../src/main/thread-run-projection-feed";
import type { RunAttemptRecord } from "../src/main/usage-ledger";
import type { ThreadRunEvent } from "../src/shared/ipc";
import type {
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
): FeedSkeletonPatchContext {
  return {
    attempts,
    agents: [],
    historyRevision: 0,
    maxEventSequence,
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
    expect(replayPatchTimelineIds(events, attempts)).toEqual(["user_1", "planner_final"]);
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
});
