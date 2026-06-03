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
    emitActivity: () => {},
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

test("refreshBreakdownNow applies /context header and planner segments", async () => {
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

  const contextText = `
claude-sonnet-4 · 76k/200k tokens (38%)
System prompt: 2.7k tokens
System tools: 16.8k tokens
Messages: 9.6k tokens
`;

  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async (_threadId, fn) => {
      const driver = {
        contextSnapshot: async function* () {
          yield {
            type: "usage.recorded",
            payload: { type: "result", result: contextText },
          };
        },
      };
      await fn(driver as never, new AbortController().signal, [
        {
          role: "planner",
          primary: {
            id: "planner:p1",
            provider: "custom",
            displayName: "Planner",
            baseUrl: "https://api.example",
            modelId: "claude-sonnet-4",
            capabilities: ["messages_api"],
            enabled: true,
          },
          fallbacks: [],
        },
      ]);
    },
    emitContext: (_threadId, snapshot) => emitted.push(snapshot),
    emitActivity: () => {},
  });

  scheduler.scheduleBreakdownRefresh("t1", [], "/tmp", true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const snapshot = emitted.at(-1);
  expect(snapshot?.occupied).toBe(76_000);
  expect(snapshot?.roles?.find((role) => role.role === "planner")?.segments.length).toBeGreaterThan(1);
  expect(snapshot?.breakdownRefreshing).toBeUndefined();
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
    emitActivity: () => {},
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
    emitActivity: () => {},
  });

  await scheduler.ensureHeadroom("t1", [], "/tmp", new AbortController().signal);
  expect(compactCalled).toBe(false);
});

test("emits activity when context snapshot refresh fails", async () => {
  const activities: string[] = [];
  const monitor = {
    getSnapshot: () => ({
      occupied: 12_000,
      limit: 200_000,
      ratio: 0.06,
      occupancyPct: 6,
      limitsResolved: true,
      displayRole: "planner",
      roles: [
        {
          role: "planner",
          occupied: 12_000,
          limit: 200_000,
          ratio: 0.06,
          occupancyPct: 6,
          limitsResolved: true,
        },
      ],
    }),
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => false,
  } as unknown as ContextWindowMonitor;
  const scheduler = new ContextSnapshotScheduler({
    monitor,
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    withSdkDriver: async () => {
      throw new Error("Route planner references a missing provider.");
    },
    emitContext: () => {},
    emitActivity: (_threadId, message) => activities.push(message),
  });

  scheduler.scheduleBreakdownRefresh("t1", [], "/tmp", true);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(activities.some((entry) => entry.includes("Context snapshot failed:"))).toBe(true);
  expect(
    activities.some((entry) => entry.includes("Route planner references a missing provider.")),
  ).toBe(true);
});
