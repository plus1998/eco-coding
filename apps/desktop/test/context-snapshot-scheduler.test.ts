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
  expect(coderSegments).toEqual([{ key: "conversation", label: "会话", tokens: 40_000, color: "#ea580c" }]);
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
    limit: 200_000,
    ratio: 0.18,
    occupancyPct: 18,
    limitsResolved: true,
    displayRole: "planner",
    roles: [
      {
        role: "planner",
        occupied: 36_000,
        limit: 200_000,
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
          entry.role === role
            ? { ...entry, occupied, occupancyPct: Math.round((occupied / entry.limit) * 100) }
            : entry,
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
  expect(
    snapshot?.roles
      ?.find((role) => role.role === "planner")
      ?.segments.some((s) => s.label === "未归因上下文"),
  ).toBe(true);
});

interface MutableCompactionMonitorState {
  inFlight: boolean;
  suspended: boolean;
  failures: number;
  completedTokens?: number;
}

function createCompactionMonitor(
  state: MutableCompactionMonitorState,
  options: { shouldCompact?: boolean; atThreshold?: boolean } = {},
): ContextWindowMonitor {
  return {
    getSnapshot: () => undefined,
    getRoleOccupancy: () => 80_000,
    restoreFromContextSnapshot: () => {},
    clearThread: () => {},
    shouldCompact: () => options.shouldCompact ?? true,
    isAtCompactionThreshold: () => options.atThreshold ?? true,
    isAutoCompactSuspended: () => state.suspended,
    isCompactInFlight: () => state.inFlight,
    beginCompactIfIdle: () => {
      if (state.inFlight) return false;
      state.inFlight = true;
      return true;
    },
    markCompactInFlight: () => {
      state.inFlight = true;
    },
    clearCompactInFlight: () => {
      state.inFlight = false;
    },
    markCompactCompleted: (_threadId: string, postTokens?: number) => {
      state.inFlight = false;
      state.failures = 0;
      state.suspended = false;
      state.completedTokens = postTokens;
      return {} as ContextMonitorSnapshot;
    },
    recordAutoCompactFailure: () => {
      state.failures += 1;
      state.suspended = state.failures >= 3;
      return { tripped: state.suspended, failures: state.failures };
    },
  } as unknown as ContextWindowMonitor;
}

test("ensureHeadroom runs Eco compaction while thread is running when ignoreRunningGuard is set", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const calls: string[] = [];
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => true,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: () => {},
    archiveBeforeCompaction: async () => {
      calls.push("archive");
    },
    runEcoCompact: async () => {
      calls.push("eco");
      return { postTokensEstimate: 9_000 };
    },
    recordEcoCompactionBoundary: () => {
      calls.push("boundary");
    },
  });

  const compacted = await scheduler.ensureHeadroom("t1", "/tmp", new AbortController().signal, {
    ignoreRunningGuard: true,
  });
  expect(compacted).toBe(true);
  expect(calls).toEqual(["archive", "eco", "boundary"]);
  expect(state.completedTokens).toBe(9_000);
});

test("ensureHeadroom skips a running thread without ignoreRunningGuard", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  let ecoCalled = false;
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => true,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: () => {},
    runEcoCompact: async () => {
      ecoCalled = true;
      return { postTokensEstimate: 9_000 };
    },
  });

  const compacted = await scheduler.ensureHeadroom("t1", "/tmp", new AbortController().signal);
  expect(compacted).toBe(false);
  expect(ecoCalled).toBe(false);
});

test("ensureHeadroom returns false when no resumable SDK session exists", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => false,
    getResume: () => undefined,
    emitContext: () => {},
    emitCompactionStatus: () => {},
  });

  expect(await scheduler.ensureHeadroom("t1", "/tmp", new AbortController().signal)).toBe(false);
});

test("compactManual always uses Eco compaction without checking the auto threshold", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const calls: string[] = [];
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state, { shouldCompact: false }),
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: () => {},
    archiveBeforeCompaction: async () => {
      calls.push("archive");
    },
    runEcoCompact: async () => {
      calls.push("eco");
      return { postTokensEstimate: 4_000 };
    },
    recordEcoCompactionBoundary: () => {
      calls.push("boundary");
    },
  });

  expect(await scheduler.compactManual("t1", "/tmp", new AbortController().signal)).toEqual({ ok: true });
  expect(calls).toEqual(["archive", "eco", "boundary"]);
});

test("compactManual rejects while thread is running", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => true,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: () => {},
  });

  expect(await scheduler.compactManual("t1", "/tmp", new AbortController().signal)).toEqual({
    ok: false,
    reason: "thread_running",
  });
});

test("ensureHeadroom records failure, clears the lock, and rethrows", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const failures: Array<{ trigger: string; detail: string }> = [];
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: () => {},
    runEcoCompact: async () => {
      throw new Error("summary failed");
    },
    recordEcoCompactionFailure: (_threadId, input) => failures.push(input),
  });

  await expect(scheduler.ensureHeadroom("t1", "/tmp", new AbortController().signal)).rejects.toThrow(
    "summary failed",
  );
  expect(state.inFlight).toBe(false);
  expect(state.failures).toBe(1);
  expect(failures).toEqual([{ trigger: "auto", detail: "summary failed", sessionId: "sess-1" }]);
});

test("ensureHeadroom emits suspended after the third consecutive Eco failure", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const statuses: Array<{ stage: string; consecutiveFailures?: number }> = [];
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: (_threadId, status) => statuses.push(status),
    runEcoCompact: async () => {
      throw new Error("summary failed");
    },
  });

  for (let index = 0; index < 3; index += 1) {
    await expect(scheduler.ensureHeadroom("t1", "/tmp", new AbortController().signal)).rejects.toThrow(
      "summary failed",
    );
  }
  expect(statuses.at(-1)).toEqual({ stage: "suspended", trigger: "auto", consecutiveFailures: 3 });
});

test("ensureHeadroom blocks an over-threshold session after auto compaction is suspended", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: true, failures: 3 };
  let ecoCalled = false;
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: () => {},
    runEcoCompact: async () => {
      ecoCalled = true;
      return { postTokensEstimate: 1 };
    },
  });

  await expect(scheduler.ensureHeadroom("t1", "/tmp", new AbortController().signal)).rejects.toThrow(
    "不能继续恢复旧会话",
  );
  expect(ecoCalled).toBe(false);
});

test("compactManual reports Eco summary failures explicitly", async () => {
  const state: MutableCompactionMonitorState = { inFlight: false, suspended: false, failures: 0 };
  const statuses: Array<{ stage: string; detail?: string }> = [];
  const scheduler = new ContextSnapshotScheduler({
    monitor: createCompactionMonitor(state),
    isThreadRunning: () => false,
    getResume: () => ({ resumeSessionId: "sess-1", cwd: "/tmp" }),
    emitContext: () => {},
    emitCompactionStatus: (_threadId, status) => statuses.push(status),
    runEcoCompact: async () => {
      throw new Error("摘要生成超时（180 秒）");
    },
  });

  expect(await scheduler.compactManual("t1", "/tmp", new AbortController().signal)).toEqual({
    ok: false,
    reason: "摘要生成超时（180 秒）",
  });
  expect(statuses).toContainEqual({
    stage: "failed",
    trigger: "manual",
    detail: "摘要生成超时（180 秒）",
  });
  expect(state.inFlight).toBe(false);
});
