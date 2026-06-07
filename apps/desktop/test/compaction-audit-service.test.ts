import { expect, test } from "bun:test";
import type {
  ThreadActivityLine,
  ThreadContextSnapshot,
  ThreadPendingPlan,
} from "../src/shared/ipc";
import type {
  ThreadCompactionArchiveRecord,
  ThreadSdkSession,
} from "../src/main/conversation-store";
import {
  createCompactionAuditService,
  type CompactionAuditServiceInput,
} from "../src/main/compaction-audit-service";
import type { UsageLedgerEvent } from "../src/main/usage-ledger";

const activityLine: ThreadActivityLine = {
  id: "line_1",
  role: "planner",
  message: "Plan",
};

const context: ThreadContextSnapshot = {
  occupied: 12_345,
  limit: 100_000,
  occupancyPct: 12,
  limitsResolved: true,
  segments: [],
  updatedAt: 1,
};

const sdkSession: ThreadSdkSession = {
  sessionId: "sdk_session_1",
  cwd: "/workspace",
};

const pendingPlan: ThreadPendingPlan = {
  threadId: "thr_compact",
  userPrompt: "Build",
  analysis: "Analysis",
  plan: "Plan",
  workspacePath: "/workspace",
  worktreePath: "/workspace/.worktree",
};

function createArchiveRecord(input: {
  threadId: string;
  trigger: "auto" | "manual";
  sessionId?: string;
  payload: Record<string, unknown>;
}): ThreadCompactionArchiveRecord {
  return {
    id: "archive_1",
    threadId: input.threadId,
    trigger: input.trigger,
    ...(input.sessionId && { sessionId: input.sessionId }),
    payload: input.payload,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function createService(overrides: Partial<CompactionAuditServiceInput> = {}) {
  const savedArchives: Array<Parameters<CompactionAuditServiceInput["saveCompactionArchive"]>> = [];
  const ledgerEvents: UsageLedgerEvent[] = [];
  const compactionStatuses: Array<{
    threadId: string;
    status: Parameters<CompactionAuditServiceInput["emitCompactionStatus"]>[1];
  }> = [];
  const inFlight: string[] = [];
  const errors: string[] = [];
  const services: CompactionAuditServiceInput = {
    listActivityLines: () => [activityLine],
    getContextSnapshot: () => context,
    getSdkSession: () => sdkSession,
    getPendingPlan: () => pendingPlan,
    saveCompactionArchive: (threadId, input) => {
      savedArchives.push([threadId, input]);
      return createArchiveRecord({ threadId, ...input });
    },
    getRunAttemptId: () => "attempt_1",
    getPlannerAgentId: () => "planner_attempt_1",
    appendLedgerEvents: (events) => ledgerEvents.push(...events),
    emitCompactionStatus: (threadId, status) => compactionStatuses.push({ threadId, status }),
    markCompactInFlight: (threadId) => inFlight.push(threadId),
    writeError: (message) => errors.push(message),
    nowIso: () => "2026-01-01T00:00:00.000Z",
    nowMs: () => 123,
    ...overrides,
  };

  return {
    service: createCompactionAuditService(services),
    savedArchives,
    ledgerEvents,
    compactionStatuses,
    inFlight,
    errors,
  };
}

test("archiveBeforeCompaction saves archive records pending audit and started ledger", () => {
  const { service, savedArchives, ledgerEvents, compactionStatuses, inFlight } = createService();

  service.archiveBeforeCompaction("thr_compact", {
    trigger: "manual",
    sessionId: "sdk_session_1",
  });

  expect(savedArchives).toHaveLength(1);
  expect(savedArchives[0]?.[1].payload).toMatchObject({
    archivedAt: "2026-01-01T00:00:00.000Z",
    activityLineCount: 1,
    activityLines: [activityLine],
    context,
    sdkSession,
    pendingPlan: {
      userPrompt: "Build",
      plan: "Plan",
    },
  });
  expect(ledgerEvents).toHaveLength(1);
  expect(ledgerEvents[0]).toMatchObject({
    threadId: "thr_compact",
    sourceEventId: "compact:archive_1:started",
    usageKind: "context",
    runAttemptId: "attempt_1",
    agentId: "planner_attempt_1",
    metadata: {
      path: "compaction",
      stage: "started",
      trigger: "manual",
      sessionId: "sdk_session_1",
      archiveId: "archive_1",
      preTokens: 12_345,
    },
  });
  expect(compactionStatuses).toEqual([
    {
      threadId: "thr_compact",
      status: {
        stage: "started",
        trigger: "manual",
        sessionId: "sdk_session_1",
        archiveId: "archive_1",
        preTokens: 12_345,
      },
    },
  ]);
  expect(inFlight).toEqual(["thr_compact"]);
});

test("recordBoundary links completed ledger to pending archive", () => {
  const { service, ledgerEvents, compactionStatuses } = createService();

  service.archiveBeforeCompaction("thr_compact", {
    trigger: "auto",
    sessionId: "sdk_session_1",
  });
  service.recordBoundary(
    "thr_compact",
    {
      subtype: "compact_boundary",
      compact_metadata: {
        session_id: "sdk_session_1",
        post_tokens: 456,
      },
    },
    "evt_boundary",
  );

  expect(ledgerEvents).toHaveLength(2);
  expect(ledgerEvents[1]).toMatchObject({
    sourceEventId: "compact:evt_boundary",
    metadata: {
      path: "compaction",
      stage: "completed",
      trigger: "auto",
      sessionId: "sdk_session_1",
      archiveId: "archive_1",
      preTokens: 12_345,
      postTokens: 456,
    },
  });
  expect(compactionStatuses.at(-1)).toEqual({
    threadId: "thr_compact",
    status: {
      stage: "completed",
      trigger: "auto",
      sessionId: "sdk_session_1",
      archiveId: "archive_1",
      preTokens: 12_345,
      postTokens: 456,
    },
  });
});

test("recordBoundary uses metadata and generated source when no pending audit exists", () => {
  const { service, ledgerEvents } = createService({
    getRunAttemptId: () => undefined,
    getPlannerAgentId: () => undefined,
  });

  service.recordBoundary("thr_compact", {
    subtype: "compact_boundary",
    compact_metadata: {
      trigger: "manual",
      pre_tokens: 10,
      post_tokens: 3,
    },
  });

  expect(ledgerEvents).toHaveLength(1);
  expect(ledgerEvents[0]).toMatchObject({
    sourceEventId: "compact:thr_compact:123:completed",
    metadata: {
      path: "compaction",
      stage: "completed",
      trigger: "manual",
      preTokens: 10,
      postTokens: 3,
    },
  });
});
