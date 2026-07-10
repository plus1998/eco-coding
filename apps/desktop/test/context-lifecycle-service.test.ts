import { expect, test } from "bun:test";
import {
  type ContextLifecycleMonitor,
  createContextLifecycleService,
} from "../src/main/context-lifecycle-service";

function createMonitor(input: { shouldCompact?: boolean } = {}) {
  const calls = {
    shouldCompact: [] as string[],
    inFlight: [] as string[],
    completed: [] as Array<{ threadId: string; postTokens?: number }>,
    compacting: [] as string[],
  };
  const monitor: ContextLifecycleMonitor = {
    shouldCompact(threadId) {
      calls.shouldCompact.push(threadId);
      return input.shouldCompact ?? false;
    },
    markCompactInFlight(threadId) {
      calls.inFlight.push(threadId);
    },
    markCompactCompleted(threadId, postTokens) {
      calls.completed.push({ threadId, ...(postTokens !== undefined && { postTokens }) });
      return {
        occupied: postTokens ?? 0,
        limit: 100_000,
        ratio: 0,
        occupancyPct: 0,
        limitsResolved: true,
        roles: [],
        instances: [],
      };
    },
    noteCompactionObserved(threadId) {
      calls.compacting.push(threadId);
    },
  };
  return { monitor, calls };
}

test("afterRunRefresh emits live context and schedules post-run compaction when needed", async () => {
  const { monitor, calls } = createMonitor({ shouldCompact: true });
  const live: string[] = [];
  const headroom: Array<{ threadId: string; worktreePath: string; aborted: boolean }> = [];
  const service = createContextLifecycleService({
    monitor,
    emitLiveContext: (threadId) => live.push(threadId),
    ensureHeadroom: async (threadId, worktreePath, signal) => {
      headroom.push({ threadId, worktreePath, aborted: signal.aborted });
      return true;
    },
    getThreadStatus: () => "idle",
    resolveThreadWorktreePath: () => "/workspace/thread",
    applySdkContextUsageBreakdown: () => undefined,
    recordCompactionBoundary: () => undefined,
  });

  await service.afterRunRefresh("thr_context");

  expect(live).toEqual(["thr_context"]);
  expect(calls.shouldCompact).toEqual([]);
  expect(headroom).toEqual([{ threadId: "thr_context", worktreePath: "/workspace/thread", aborted: false }]);
});

test("afterRunRefresh skips post-run compaction for failed or blocked threads", async () => {
  const { monitor, calls } = createMonitor({ shouldCompact: true });
  const live: string[] = [];
  const headroom: string[] = [];
  const service = createContextLifecycleService({
    monitor,
    emitLiveContext: (threadId) => live.push(threadId),
    ensureHeadroom: async (threadId) => {
      headroom.push(threadId);
      return true;
    },
    getThreadStatus: () => "failed",
    resolveThreadWorktreePath: () => "/workspace/thread",
    applySdkContextUsageBreakdown: () => undefined,
    recordCompactionBoundary: () => undefined,
  });

  await service.afterRunRefresh("thr_failed");

  expect(live).toEqual(["thr_failed"]);
  expect(calls.shouldCompact).toEqual([]);
  expect(headroom).toEqual([]);
});

test("afterRunRefresh awaits and reports post-run compaction failures", async () => {
  const { monitor } = createMonitor();
  const errors: Array<{ threadId: string; message: string }> = [];
  const service = createContextLifecycleService({
    monitor,
    emitLiveContext: () => {},
    ensureHeadroom: async () => {
      throw new Error("summary failed");
    },
    getThreadStatus: () => "idle",
    resolveThreadWorktreePath: () => "/workspace/thread",
    applySdkContextUsageBreakdown: () => undefined,
    recordCompactionBoundary: () => undefined,
    onPostRunCompactionError: (threadId, error) => {
      errors.push({ threadId, message: error instanceof Error ? error.message : String(error) });
    },
  });

  await service.afterRunRefresh("thr_context");
  expect(errors).toEqual([{ threadId: "thr_context", message: "summary failed" }]);
});

test("handleSdkContextEvent applies context usage and consumes that event", () => {
  const { monitor } = createMonitor();
  const applied: unknown[] = [];
  const service = createContextLifecycleService({
    monitor,
    emitLiveContext: () => undefined,
    ensureHeadroom: async () => false,
    getThreadStatus: () => "running",
    resolveThreadWorktreePath: () => undefined,
    applySdkContextUsageBreakdown: (_threadId, payload) => applied.push(payload),
    recordCompactionBoundary: () => undefined,
  });

  const consumed = service.handleSdkContextEvent({
    threadId: "thr_context",
    eventId: "evt_context",
    payload: {
      type: "sdk_context_usage",
      ecoSdkContextUsage: { total: 123 },
    },
  });

  expect(consumed).toBe(true);
  expect(applied).toEqual([{ total: 123 }]);
});

test("handleSdkContextEvent records compact boundary and compacting status", () => {
  const { monitor, calls } = createMonitor();
  const live: string[] = [];
  const boundaries: Array<{ threadId: string; sourceEventId?: string; payload: unknown }> = [];
  const service = createContextLifecycleService({
    monitor,
    emitLiveContext: (threadId) => live.push(threadId),
    ensureHeadroom: async () => false,
    getThreadStatus: () => "running",
    resolveThreadWorktreePath: () => undefined,
    applySdkContextUsageBreakdown: () => undefined,
    recordCompactionBoundary: (threadId, payload, sourceEventId) => {
      boundaries.push({ threadId, payload, ...(sourceEventId && { sourceEventId }) });
    },
  });

  expect(
    service.handleSdkContextEvent({
      threadId: "thr_compact",
      eventId: "evt_boundary",
      payload: {
        subtype: "compact_boundary",
        compact_metadata: { post_tokens: 42 },
      },
    }),
  ).toBe(false);
  expect(
    service.handleSdkContextEvent({
      threadId: "thr_compact",
      eventId: "evt_status",
      payload: { type: "system", subtype: "status", status: "compacting" },
    }),
  ).toBe(false);

  expect(boundaries).toHaveLength(1);
  expect(boundaries[0]).toMatchObject({
    threadId: "thr_compact",
    sourceEventId: "evt_boundary",
  });
  expect(calls.completed).toEqual([{ threadId: "thr_compact", postTokens: 42 }]);
  expect(calls.compacting).toEqual(["thr_compact"]);
  expect(live).toEqual(["thr_compact"]);
});

test("service exposes compact in-flight and compaction markers", () => {
  const { monitor, calls } = createMonitor();
  const service = createContextLifecycleService({
    monitor,
    emitLiveContext: () => undefined,
    ensureHeadroom: async () => false,
    getThreadStatus: () => "running",
    resolveThreadWorktreePath: () => undefined,
    applySdkContextUsageBreakdown: () => undefined,
    recordCompactionBoundary: () => undefined,
  });

  service.markCompactInFlight("thr_compact");
  service.noteCompactionObserved("thr_compact");

  expect(calls.inFlight).toEqual(["thr_compact"]);
  expect(calls.compacting).toEqual(["thr_compact"]);
});
