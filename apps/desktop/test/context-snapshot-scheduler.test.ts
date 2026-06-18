import { expect, test } from "bun:test";
import { ContextSnapshotScheduler } from "../src/main/context-snapshot-scheduler";
import type { ContextMonitorSnapshot, ContextWindowMonitor } from "../src/main/context-window-monitor";
import type { ThreadContextSnapshot } from "../src/shared/ipc";

test("emits one occupancy segment per independent role window", () => {
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
    emitCompactionStatus: () => {},
  });

  scheduler.restoreSnapshot("t1", {
    occupied: 10_000,
    limit: 100_000,
    occupancyPct: 10,
    limitsResolved: true,
    displayRole: "planner",
    segments: [],
    roles: [
      {
        role: "planner",
        occupied: 10_000,
        limit: 100_000,
        occupancyPct: 10,
        limitsResolved: true,
        segments: [],
      },
    ],
    updatedAt: Date.now(),
  });
  scheduler.emitLiveFromMonitor("t1");

  const snapshot = emitted.at(-1);
  expect(snapshot?.roles?.find((role) => role.role === "planner")?.segments).toEqual([
    { key: "conversation", label: "会话", tokens: 10_000, color: "#ea580c" },
  ]);
  const coderSegments = snapshot?.roles?.find((role) => role.role === "coder")?.segments;
  expect(coderSegments).toEqual([
    { key: "conversation", label: "会话", tokens: 40_000, color: "#ea580c" },
  ]);
});

test("clearSubagentState drops cached child role snapshots and segments", () => {
  const plannerSegments: ThreadContextSnapshot["segments"] = [
    { key: "conversation", label: "会话", tokens: 10_000, color: "#ea580c" },
  ];
  const coderSegments: ThreadContextSnapshot["segments"] = [
    { key: "conversation", label: "会话", tokens: 40_000, color: "#ea580c" },
  ];
  let monitorSnapshot: ContextMonitorSnapshot | undefined;
  const monitor = {
    getSnapshot: () => monitorSnapshot,
    restoreFromContextSnapshot: (_threadId: string, snapshot: ThreadContextSnapshot) => {
      monitorSnapshot = {
        occupied: snapshot.occupied,
        limit: snapshot.limit,
        ratio: snapshot.limit > 0 ? snapshot.occupied / snapshot.limit : 0,
        occupancyPct: snapshot.occupancyPct,
        limitsResolved: snapshot.limitsResolved,
        displayRole: snapshot.displayRole,
        roles:
          snapshot.roles?.map((role) => ({
            role: role.role,
            occupied: role.occupied,
            limit: role.limit,
            ratio: role.limit > 0 ? role.occupied / role.limit : 0,
            occupancyPct: role.occupancyPct,
            limitsResolved: role.limitsResolved,
            ...(role.modelId && { modelId: role.modelId }),
          })) ?? [],
      };
    },
    clearThread: () => {},
    shouldCompact: () => false,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => undefined,
    withSdkDriver: async () => {},
    emitContext: () => {},
    emitCompactionStatus: () => {},
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

test("applySdkContextUsageBreakdown updates planner segments from getContextUsage payload", async () => {
  const emitted: ThreadContextSnapshot[] = [];
  let monitorSnapshot: ContextMonitorSnapshot = {
    occupied: 36_000,
    limit: 147_000,
    ratio: 0.24,
    occupancyPct: 24,
    limitsResolved: true,
    displayRole: "planner",
    roles: [
      {
        role: "planner",
        occupied: 36_000,
        limit: 147_000,
        ratio: 0.24,
        occupancyPct: 24,
        limitsResolved: true,
      },
    ],
  };
  const monitor = {
    getSnapshot: () => monitorSnapshot,
    updateOccupied: async (_threadId: string, role: "planner", occupied: number) => {
      monitorSnapshot = {
        ...monitorSnapshot,
        occupied,
        roles: monitorSnapshot.roles.map((entry) =>
          entry.role === role ? { ...entry, occupied, occupancyPct: Math.round((occupied / entry.limit) * 100) } : entry,
        ),
      };
      return monitorSnapshot;
    },
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
    emitCompactionStatus: () => {},
  });

  scheduler.applySdkContextUsageBreakdown("t1", {
    totalTokens: 31_528,
    maxTokens: 200_000,
    percentage: 16,
    messageBreakdown: {
      userMessageTokens: 2098,
      assistantMessageTokens: 270,
      toolCallTokens: 28,
      toolResultTokens: 42,
      attachmentTokens: 1672,
      unattributedTokens: 27_418,
    },
  });

  const snapshot = emitted.at(-1);
  expect(snapshot?.occupied).toBe(31_528);
  expect(snapshot?.roles?.find((role) => role.role === "planner")?.segments.some((s) => s.label === "未归因上下文")).toBe(
    true,
  );
});

test("ensureHeadroom runs while thread is running when ignoreRunningGuard is set", async () => {
  let compactCalled = false;
  const monitor = {
    getSnapshot: () => undefined,
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => true,
    markCompactInFlight: () => {},
    markCompactCompleted: () => {},
    updateFromUsage: async () => ({}),
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => true,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async (_threadId, fn) => {
      compactCalled = true;
      const driver = {
        compactSession: async function* () {
          yield {
            type: "agent.started",
            payload: { subtype: "compact_boundary", compact_metadata: { post_tokens: 10_000 } },
          };
        },
      };
      await fn(driver as never, new AbortController().signal, []);
    },
    emitContext: () => {},
    emitCompactionStatus: () => {},
  });

  await scheduler.ensureHeadroom("t1", [], "/tmp", new AbortController().signal, {
    ignoreRunningGuard: true,
  });
  expect(compactCalled).toBe(true);
});

test("ensureHeadroom skips while thread is running without ignoreRunningGuard", async () => {
  let compactCalled = false;
  const monitor = {
    getSnapshot: () => undefined,
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => true,
    markCompactInFlight: () => {},
    markCompactCompleted: () => {},
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => true,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async () => {
      compactCalled = true;
    },
    emitContext: () => {},
    emitCompactionStatus: () => {},
  });

  await scheduler.ensureHeadroom("t1", [], "/tmp", new AbortController().signal);
  expect(compactCalled).toBe(false);
});

test("ensureHeadroom applies sdk_context_usage from compact session events", async () => {
  const emitted: ThreadContextSnapshot[] = [];
  let monitorSnapshot: ContextMonitorSnapshot = {
    occupied: 90_000,
    limit: 200_000,
    ratio: 0.45,
    occupancyPct: 45,
    limitsResolved: true,
    displayRole: "planner",
    roles: [
      {
        role: "planner",
        occupied: 90_000,
        limit: 200_000,
        ratio: 0.45,
        occupancyPct: 45,
        limitsResolved: true,
      },
    ],
  };
  const monitor = {
    getSnapshot: () => monitorSnapshot,
    updateOccupied: async (_threadId: string, role: "planner", occupied: number) => {
      monitorSnapshot = {
        ...monitorSnapshot,
        occupied,
        roles: monitorSnapshot.roles.map((entry) =>
          entry.role === role ? { ...entry, occupied, occupancyPct: Math.round((occupied / entry.limit) * 100) } : entry,
        ),
      };
      return monitorSnapshot;
    },
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => true,
    markCompactInFlight: () => {},
    markCompactCompleted: () => {},
    updateFromUsage: async () => monitorSnapshot,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async (_threadId, fn) => {
      const driver = {
        compactSession: async function* () {
          yield {
            type: "usage.recorded",
            payload: {
              type: "sdk_context_usage",
              ecoSdkContextUsage: {
                totalTokens: 40_000,
                maxTokens: 200_000,
                percentage: 20,
                messageBreakdown: {
                  userMessageTokens: 5000,
                  assistantMessageTokens: 1000,
                  unattributedTokens: 34_000,
                },
              },
            },
          };
        },
      };
      await fn(driver as never, new AbortController().signal, []);
    },
    emitContext: (_threadId, snapshot) => emitted.push(snapshot),
    emitCompactionStatus: () => {},
  });

  await scheduler.ensureHeadroom("t1", [], "/tmp", new AbortController().signal);
  const snapshot = emitted.at(-1);
  expect(snapshot?.occupied).toBe(40_000);
});

test("compactManual runs /compact without shouldCompact threshold", async () => {
  let compactCalled = false;
  const monitor = {
    getSnapshot: () => undefined,
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => false,
    isCompactInFlight: () => false,
    markCompactInFlight: () => {},
    markCompactCompleted: () => ({}),
    updateFromUsage: async () => undefined,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async (_threadId, fn) => {
      const driver = {
        compactSession: async function* () {
          compactCalled = true;
          yield { type: "agent.started", payload: { subtype: "compact_boundary", compact_metadata: { post_tokens: 1000 } } };
        },
      };
      await fn(driver as never, new AbortController().signal, []);
    },
    emitContext: () => {},
    emitCompactionStatus: () => {},
  });

  const result = await scheduler.compactManual("t1", [], "/tmp", new AbortController().signal);
  expect(result).toEqual({ ok: true });
  expect(compactCalled).toBe(true);
});

test("compactManual rejects while thread is running", async () => {
  const monitor = {
    isCompactInFlight: () => false,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => true,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async () => {},
    emitContext: () => {},
    emitCompactionStatus: () => {},
  });

  const result = await scheduler.compactManual("t1", [], "/tmp", new AbortController().signal);
  expect(result).toEqual({ ok: false, reason: "thread_running" });
});
