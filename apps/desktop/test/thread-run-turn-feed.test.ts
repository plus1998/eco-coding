import { expect, test } from "bun:test";
import type { ThreadRunProjectionMainFeedEntry } from "../src/renderer/thread-run-projection-view";
import { buildThreadRunTurnFeedSections } from "../src/renderer/thread-run-turn-feed";
import type { ThreadRunProjectionAttempt, ThreadRunProjectionTimelineItem } from "../src/shared/ipc";

function item(
  id: string,
  text: string,
  input: Partial<ThreadRunProjectionTimelineItem> = {},
): ThreadRunProjectionTimelineItem {
  return {
    id,
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "message.final",
    scope: input.scope ?? "main",
    role: input.role ?? "planner",
    text,
    at: input.at ?? "2026-01-01T00:00:02.000Z",
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.metadata && { metadata: input.metadata }),
  };
}

function entry(value: ThreadRunProjectionTimelineItem): ThreadRunProjectionMainFeedEntry {
  return {
    kind: "timeline",
    key: `main:${value.id}`,
    item: value,
    at: value.at,
    sequence: value.sequence,
  };
}

function attempt(status: ThreadRunProjectionAttempt["status"]): ThreadRunProjectionAttempt {
  return {
    attemptId: "attempt-1",
    phase: "execution",
    retryIndex: 0,
    status,
    startedAt: "2026-01-01T00:00:01.000Z",
    ...(status !== "running" ? { endedAt: "2026-01-01T00:00:08.000Z" } : {}),
  };
}

test("completed turn separates the last planner narrative as final output", () => {
  const sections = buildThreadRunTurnFeedSections(
    [
      entry(
        item("user", "修复问题", {
          role: "user",
          at: "2026-01-01T00:00:00.500Z",
          metadata: { liveType: "thread.user_prompt" },
        }),
      ),
      entry(item("progress", "先检查投影。", { runAttemptId: "attempt-1" })),
      entry(
        item("tool", "Tool: Read · src/a.ts", {
          eventType: "tool.completed",
          role: "tool",
          runAttemptId: "attempt-1",
          sequence: 2,
          metadata: { tool: { name: "Read", detail: "src/a.ts", status: "completed" } },
        }),
      ),
      entry(
        item("final", "已修复。", {
          runAttemptId: "attempt-1",
          at: "2026-01-01T00:00:07.000Z",
          sequence: 3,
        }),
      ),
    ],
    { attempts: [attempt("completed")], timeline: [] },
  );

  expect(sections[0]?.kind).toBe("entry");
  expect(sections[1]?.kind).toBe("turn");
  if (sections[1]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[1].processEntries.map((value) => value.key)).toEqual(["main:progress", "main:tool"]);
  expect(sections[1].finalEntry?.key).toBe("main:final");
  expect(sections[1].running).toBe(false);
});

test("running turn keeps every narrative in the expanded process", () => {
  const sections = buildThreadRunTurnFeedSections(
    [
      entry(item("progress", "正在处理。", { runAttemptId: "attempt-1" })),
      entry(item("latest", "继续检查。", { runAttemptId: "attempt-1", sequence: 2 })),
    ],
    { attempts: [attempt("running")], timeline: [] },
  );

  expect(sections[0]?.kind).toBe("turn");
  if (sections[0]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[0].processEntries).toHaveLength(2);
  expect(sections[0].finalEntry).toBeUndefined();
  expect(sections[0].running).toBe(true);
});

test("running attempt renders immediately before the first process event", () => {
  const sections = buildThreadRunTurnFeedSections(
    [
      entry(
        item("user", "立即开始", {
          role: "user",
          at: "2026-01-01T00:00:00.500Z",
          metadata: { liveType: "thread.user_prompt" },
        }),
      ),
    ],
    { attempts: [attempt("running")], timeline: [] },
  );

  expect(sections).toHaveLength(2);
  expect(sections[0]?.kind).toBe("entry");
  expect(sections[1]?.kind).toBe("turn");
  if (sections[1]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[1].running).toBe(true);
  expect(sections[1].processEntries).toEqual([]);
});

test("rewrite user prompt sorts above running turn only when prompt at precedes attempt startedAt", () => {
  const userEntry = entry(
    item("user-rewrite", "编辑后的消息", {
      role: "user",
      sequence: 10,
      at: "2026-01-01T00:00:05.000Z",
      metadata: { liveType: "thread.user_prompt" },
    }),
  );

  const scrambled = buildThreadRunTurnFeedSections([userEntry], {
    attempts: [
      {
        attemptId: "attempt-1",
        phase: "execution",
        retryIndex: 0,
        status: "running",
        // Started before replacement prompt (continuation attempt pre-fork).
        startedAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    timeline: [],
  });
  expect(scrambled.map((section) => section.kind)).toEqual(["turn", "entry"]);

  const ordered = buildThreadRunTurnFeedSections([userEntry], {
    attempts: [
      {
        attemptId: "attempt-1",
        phase: "execution",
        retryIndex: 0,
        status: "running",
        startedAt: "2026-01-01T00:00:06.000Z",
      },
    ],
    timeline: [],
  });
  expect(ordered.map((section) => section.kind)).toEqual(["entry", "turn"]);
});

test("cancelled and failed attempts render even before the first process event", () => {
  for (const status of ["cancelled", "failed"] as const) {
    const lifecycleItem = item(`${status}-event`, "", {
      eventType: `request.${status}`,
      runAttemptId: "attempt-1",
    });
    const sections = buildThreadRunTurnFeedSections([], {
      attempts: [attempt(status)],
      timeline: [lifecycleItem],
    });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe("turn");
    if (sections[0]?.kind !== "turn") throw new Error("expected turn section");
    expect(sections[0].attempt.status).toBe(status);
    expect(sections[0].running).toBe(false);
    expect(sections[0].processEntries).toEqual([]);
  }
});

test("terminal attempts clipped from the timeline are not synthesized", () => {
  const oldCancelled: ThreadRunProjectionAttempt = {
    attemptId: "attempt-old",
    phase: "execution",
    retryIndex: 0,
    status: "cancelled",
    startedAt: "2026-01-01T00:00:01.000Z",
    endedAt: "2026-01-01T00:00:03.000Z",
  };
  const visibleFailed: ThreadRunProjectionAttempt = {
    attemptId: "attempt-visible",
    phase: "follow_up",
    retryIndex: 0,
    status: "failed",
    startedAt: "2026-01-01T00:00:05.000Z",
    endedAt: "2026-01-01T00:00:08.000Z",
  };
  const failedItem = item("visible-failed", "", {
    eventType: "request.failed",
    runAttemptId: "attempt-visible",
    at: "2026-01-01T00:00:08.000Z",
  });

  const sections = buildThreadRunTurnFeedSections([], {
    attempts: [oldCancelled, visibleFailed],
    timeline: [failedItem],
  });

  expect(sections).toHaveLength(1);
  expect(sections[0]?.kind).toBe("turn");
  if (sections[0]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[0].attempt.attemptId).toBe("attempt-visible");
  expect(sections[0].attempt.status).toBe("failed");
});

test("a late terminal event keeps an older stopped turn before the newer running turn", () => {
  const oldCancelled: ThreadRunProjectionAttempt = {
    attemptId: "attempt-old",
    phase: "execution",
    retryIndex: 0,
    status: "cancelled",
    startedAt: "2026-01-01T00:00:01.000Z",
    endedAt: "2026-01-01T00:00:04.000Z",
  };
  const currentRunning: ThreadRunProjectionAttempt = {
    attemptId: "attempt-current",
    phase: "follow_up",
    retryIndex: 0,
    status: "running",
    startedAt: "2026-01-01T00:00:10.000Z",
  };
  const currentPrompt = item("current-prompt", "继续", {
    role: "user",
    at: "2026-01-01T00:00:10.000Z",
    sequence: 10,
    metadata: { liveType: "thread.user_prompt" },
  });
  const currentProgress = item("current-progress", "正在处理", {
    at: "2026-01-01T00:00:11.000Z",
    sequence: 11,
    runAttemptId: currentRunning.attemptId,
  });
  const lateCancelledEvent = item("late-cancelled", "", {
    eventType: "request.cancelled",
    at: "2026-01-01T00:00:12.000Z",
    sequence: 12,
    runAttemptId: oldCancelled.attemptId,
  });

  const sections = buildThreadRunTurnFeedSections([entry(currentPrompt), entry(currentProgress)], {
    attempts: [oldCancelled, currentRunning],
    timeline: [currentPrompt, currentProgress, lateCancelledEvent],
  });

  expect(
    sections
      .filter(
        (section): section is Extract<ThreadRunTurnFeedSection, { kind: "turn" }> => section.kind === "turn",
      )
      .map((section) => section.attempt.attemptId),
  ).toEqual([oldCancelled.attemptId, currentRunning.attemptId]);
  expect(sections.findIndex((section) => section.key === "turn:attempt-old")).toBeLessThan(
    sections.findIndex((section) => section.key === "turn:attempt-current"),
  );
});

test("legacy entries recover turn ownership from the attempt time window", () => {
  const sections = buildThreadRunTurnFeedSections(
    [entry(item("legacy-final", "旧会话结果。", { at: "2026-01-01T00:00:07.000Z" }))],
    { attempts: [attempt("completed")], timeline: [] },
  );

  expect(sections[0]?.kind).toBe("turn");
  if (sections[0]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[0].finalEntry?.key).toBe("main:legacy-final");
});
