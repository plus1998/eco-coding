import { expect, test } from "bun:test";
import {
  type ApplicationShutdownDeps,
  buildQuitConfirmationDialogOptions,
  collectRunningWorkSummary,
  hasRunningWork,
  isThreadActivelyRunning,
} from "../src/main/application-shutdown-work";

function createDeps(overrides: Partial<ApplicationShutdownDeps> = {}): ApplicationShutdownDeps {
  return {
    locale: () => "zh-CN",
    listThreads: () => [],
    hasActiveRun: () => false,
    isCompactInFlight: () => false,
    countRunningBackgroundTasks: () => 0,
    cancelThreadRuntime: async () => {},
    abortActiveRun: () => false,
    finishActiveRun: () => {},
    cancelClarifications: () => {},
    cancelBashApprovals: () => {},
    cancelPlanApprovals: () => {},
    settleRecoveredLifecycleRecords: () => {},
    getPendingPlan: () => undefined,
    updateThreadOnQuit: () => {},
    emitThreadQuitEvent: () => {},
    stopAllBackgroundTasks: () => {},
    killAllInteractiveTerminals: () => {},
    disposeBrowserHost: () => {},
    closeImageGenerationGateway: async () => {},
    closeImageViewGateway: async () => {},
    closeImageDisplayGateway: async () => {},
    stopGlobalCodexRuntime: async () => {},
    stopGlobalEcoGateway: async () => {},
    disposeDesktopUpdateService: () => {},
    clearCodexSubagentRuntimeLimit: () => {},
    flushAllThreadMetrics: () => {},
    disposeCodexGatewayUsagePending: () => {},
    clearCodexGatewayUsageDeduplicator: () => {},
    disposeGitAutoFetcher: () => {},
    disposeCenterServerClient: () => {},
    ...overrides,
  };
}

test("isThreadActivelyRunning treats runtime and persisted running states as active", () => {
  expect(isThreadActivelyRunning({ status: "idle", runtimeActive: false })).toBe(false);
  expect(isThreadActivelyRunning({ status: "running", runtimeActive: false })).toBe(true);
  expect(isThreadActivelyRunning({ status: "queued", runtimeActive: false })).toBe(true);
  expect(isThreadActivelyRunning({ status: "idle", runtimeActive: true })).toBe(true);
});

test("collectRunningWorkSummary aggregates threads, background tasks, and compaction", () => {
  const summary = collectRunningWorkSummary(
    createDeps({
      listThreads: () => [
        {
          id: "thr_running",
          title: "Running thread",
          status: "running",
          coreKind: "codex",
        },
        {
          id: "thr_idle",
          title: "Idle thread",
          status: "idle",
          coreKind: "claude",
        },
      ],
      hasActiveRun: (threadId) => threadId === "thr_runtime_only",
      isCompactInFlight: (threadId) => threadId === "thr_compact",
      countRunningBackgroundTasks: () => 2,
    }),
  );

  expect(summary.runningThreads.map((thread) => thread.threadId)).toEqual(["thr_running"]);
  expect(summary.backgroundTaskCount).toBe(2);
  expect(summary.compactingThreadIds).toEqual([]);
});

test("hasRunningWork is false when nothing is active", () => {
  expect(
    hasRunningWork({
      runningThreads: [],
      backgroundTaskCount: 0,
      compactingThreadIds: [],
    }),
  ).toBe(false);
});

test("buildQuitConfirmationDialogOptions includes running counts", () => {
  const options = buildQuitConfirmationDialogOptions("zh-CN", {
    runningThreads: [
      {
        threadId: "thr_1",
        title: "One",
        status: "running",
        coreKind: "codex",
        runtimeActive: true,
      },
    ],
    backgroundTaskCount: 1,
    compactingThreadIds: ["thr_2"],
  });

  expect(options.title).toBe("退出 Eco？");
  expect(options.detail).toContain("1 个对话任务正在运行");
  expect(options.detail).toContain("1 个后台终端任务正在运行");
  expect(options.detail).toContain("1 个对话正在压缩上下文");
  expect(options.buttons).toEqual(["仍要退出", "取消"]);
  expect(options.defaultId).toBe(1);
});
