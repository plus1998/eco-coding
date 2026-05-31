import { expect, test } from "bun:test";
import { ContextSnapshotScheduler } from "../src/main/context-snapshot-scheduler";
import type { ContextMonitorSnapshot, ContextWindowMonitor } from "../src/main/context-window-monitor";
import type { ThreadContextSnapshot } from "../src/shared/ipc";

test("keeps planner breakdown separate from subagent fallback segments", () => {
  const plannerSegments: ThreadContextSnapshot["segments"] = [
    { key: "systemPrompt", label: "系统提示", tokens: 1000, color: "#9ca3af" },
    { key: "conversation", label: "对话", tokens: 9000, color: "#ea580c" },
  ];
  const emitted: ThreadContextSnapshot[] = [];
  const monitorSnapshot: ContextMonitorSnapshot = {
    occupied: 10_000,
    limit: 100_000,
    ratio: 0.1,
    occupancyPct: 10,
    limitsResolved: true,
    displayRole: "planner",
    roles: [
      {
        role: "planner",
        occupied: 10_000,
        limit: 100_000,
        ratio: 0.1,
        occupancyPct: 10,
        limitsResolved: true,
      },
      {
        role: "coder",
        occupied: 40_000,
        limit: 100_000,
        ratio: 0.4,
        occupancyPct: 40,
        limitsResolved: true,
      },
    ],
  };
  const monitor = {
    getSnapshot: () => monitorSnapshot,
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => false,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => undefined,
    withSdkDriver: async () => {},
    emitContext: (_threadId, snapshot) => emitted.push(snapshot),
    emitActivity: () => {},
  });

  scheduler.restoreSnapshot("t1", {
    occupied: 10_000,
    limit: 100_000,
    occupancyPct: 10,
    limitsResolved: true,
    displayRole: "planner",
    segments: plannerSegments,
    roles: [
      {
        role: "planner",
        occupied: 10_000,
        limit: 100_000,
        occupancyPct: 10,
        limitsResolved: true,
        segments: plannerSegments,
      },
    ],
    updatedAt: Date.now(),
  });
  scheduler.emitLiveFromMonitor("t1");

  const snapshot = emitted.at(-1);
  expect(snapshot?.roles?.find((role) => role.role === "planner")?.segments).toEqual(plannerSegments);
  const coderSegments = snapshot?.roles?.find((role) => role.role === "coder")?.segments;
  expect(coderSegments).toEqual([{ key: "conversation", label: "对话", tokens: 40_000, color: "#ea580c" }]);
});

test("clearSubagentState drops cached child role snapshots and segments", () => {
  const plannerSegments: ThreadContextSnapshot["segments"] = [
    { key: "conversation", label: "对话", tokens: 10_000, color: "#ea580c" },
  ];
  const coderSegments: ThreadContextSnapshot["segments"] = [
    { key: "conversation", label: "对话", tokens: 40_000, color: "#ea580c" },
  ];
  const monitor = {
    getSnapshot: () => undefined,
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => false,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => undefined,
    withSdkDriver: async () => {},
    emitContext: () => {},
    emitActivity: () => {},
  });

  scheduler.restoreSnapshot("t1", {
    occupied: 10_000,
    limit: 100_000,
    occupancyPct: 10,
    limitsResolved: true,
    displayRole: "planner",
    segments: plannerSegments,
    roles: [
      {
        role: "planner",
        occupied: 10_000,
        limit: 100_000,
        occupancyPct: 10,
        limitsResolved: true,
        segments: plannerSegments,
      },
      {
        role: "coder",
        occupied: 40_000,
        limit: 100_000,
        occupancyPct: 40,
        limitsResolved: true,
        segments: coderSegments,
      },
    ],
    updatedAt: Date.now(),
  });

  scheduler.clearSubagentState("t1");

  const snapshot = scheduler.getDisplaySnapshot("t1");
  expect(snapshot?.roles?.map((role) => role.role)).toEqual(["planner"]);
  expect(snapshot?.segments).toEqual(plannerSegments);
});
