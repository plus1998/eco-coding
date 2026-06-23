import { expect, test } from "bun:test";
import { buildThreadSessionBootstrap } from "../src/main/thread-session-bootstrap";
import type { ThreadSummary } from "../src/shared/ipc";

const thread: ThreadSummary = {
  id: "thr_boot",
  title: "Boot",
  prompt: "hello",
  workspacePath: "/tmp/repo",
  status: "idle",
  message: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("buildThreadSessionBootstrap assembles session metadata", () => {
  const result = buildThreadSessionBootstrap("thr_boot", {
    getThread: () => thread,
    listFollowUps: () => [
      {
        id: "fup_1",
        threadId: "thr_boot",
        prompt: "next",
        priority: "normal",
        status: "queued",
        deliveryMode: "interrupt",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    getPendingPlan: () => undefined,
    getPendingBashApproval: () => undefined,
    getPendingClarification: () => undefined,
    listSubagentSessionTimings: () => [],
    usageSnapshotServices: {
      getLegacyBilling: () => undefined,
      resolveBillingSnapshot: () => ({ snapshot: { ecoCostUsd: 0 } as never }),
      enrichBillingSnapshot: () => ({ ecoCostUsd: 0 } as never),
      projectBillingSnapshot: () => undefined,
      getThreadStatus: () => "idle",
      getDisplayContextSnapshot: () => undefined,
    },
  });

  expect(result.thread).toEqual(thread);
  expect(result.followUps).toHaveLength(1);
  expect(result.subagentSessions).toEqual([]);
  expect(result.usage).toEqual({});
});

test("buildThreadSessionBootstrap returns empty payload for blank thread id", () => {
  expect(buildThreadSessionBootstrap("  ", {
    getThread: () => thread,
    listFollowUps: () => [],
    getPendingPlan: () => undefined,
    getPendingBashApproval: () => undefined,
    getPendingClarification: () => undefined,
    listSubagentSessionTimings: () => [],
    usageSnapshotServices: {
      getLegacyBilling: () => undefined,
      resolveBillingSnapshot: () => ({ snapshot: { ecoCostUsd: 0 } as never }),
      enrichBillingSnapshot: () => ({ ecoCostUsd: 0 } as never),
      projectBillingSnapshot: () => undefined,
      getThreadStatus: () => undefined,
      getDisplayContextSnapshot: () => undefined,
    },
  })).toEqual({
    followUps: [],
    subagentSessions: [],
    usage: {},
  });
});
