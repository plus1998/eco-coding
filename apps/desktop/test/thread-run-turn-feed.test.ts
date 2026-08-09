import { expect, test } from "bun:test";
import type {
  ThreadRunProjectionAttempt,
  ThreadRunProjectionTimelineItem,
} from "../src/shared/ipc";
import type { ThreadRunProjectionMainFeedEntry } from "../src/renderer/thread-run-projection-view";
import { buildThreadRunTurnFeedSections } from "../src/renderer/thread-run-turn-feed";

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
    { attempts: [attempt("completed")] },
  );

  expect(sections[0]?.kind).toBe("entry");
  expect(sections[1]?.kind).toBe("turn");
  if (sections[1]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[1].processEntries.map((value) => value.key)).toEqual([
    "main:progress",
    "main:tool",
  ]);
  expect(sections[1].finalEntry?.key).toBe("main:final");
  expect(sections[1].running).toBe(false);
});

test("running turn keeps every narrative in the expanded process", () => {
  const sections = buildThreadRunTurnFeedSections(
    [
      entry(item("progress", "正在处理。", { runAttemptId: "attempt-1" })),
      entry(item("latest", "继续检查。", { runAttemptId: "attempt-1", sequence: 2 })),
    ],
    { attempts: [attempt("running")] },
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
    { attempts: [attempt("running")] },
  );

  expect(sections).toHaveLength(2);
  expect(sections[0]?.kind).toBe("entry");
  expect(sections[1]?.kind).toBe("turn");
  if (sections[1]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[1].running).toBe(true);
  expect(sections[1].processEntries).toEqual([]);
});

test("cancelled and failed attempts render even before the first process event", () => {
  for (const status of ["cancelled", "failed"] as const) {
    const sections = buildThreadRunTurnFeedSections([], { attempts: [attempt(status)] });

    expect(sections).toHaveLength(1);
    expect(sections[0]?.kind).toBe("turn");
    if (sections[0]?.kind !== "turn") throw new Error("expected turn section");
    expect(sections[0].attempt.status).toBe(status);
    expect(sections[0].running).toBe(false);
    expect(sections[0].processEntries).toEqual([]);
  }
});

test("legacy entries recover turn ownership from the attempt time window", () => {
  const sections = buildThreadRunTurnFeedSections(
    [entry(item("legacy-final", "旧会话结果。", { at: "2026-01-01T00:00:07.000Z" }))],
    { attempts: [attempt("completed")] },
  );

  expect(sections[0]?.kind).toBe("turn");
  if (sections[0]?.kind !== "turn") throw new Error("expected turn section");
  expect(sections[0].finalEntry?.key).toBe("main:legacy-final");
});
