import { expect, test } from "bun:test";
import {
  buildCompactionLedgerEvent,
  readCompactionBoundaryMetadata,
} from "../src/main/compaction-ledger-events";

test("buildCompactionLedgerEvent creates non-billable context ledger event", () => {
  const event = buildCompactionLedgerEvent({
    threadId: "thr_compact",
    sourceEventId: "compact:event_1",
    stage: "completed",
    trigger: "auto",
    sessionId: "sess_1",
    archiveId: "archive_1",
    runAttemptId: "run_1",
    plannerAgentId: "planner_1",
    preTokens: 180_000,
    postTokens: 42_000,
    payload: { trigger: "auto", pre_tokens: 180_000, post_tokens: 42_000 },
  });

  expect(event.usageKind).toBe("context");
  expect(event.source).toBe("sdk");
  expect(event.agentId).toBe("planner_1");
  expect(event.runAttemptId).toBe("run_1");
  expect(event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens).toBe(0);
  expect(event.metadata).toMatchObject({
    path: "compaction",
    stage: "completed",
    trigger: "auto",
    sessionId: "sess_1",
    archiveId: "archive_1",
    preTokens: 180_000,
    postTokens: 42_000,
  });
});

test("readCompactionBoundaryMetadata accepts sdk compact metadata spellings", () => {
  expect(
    readCompactionBoundaryMetadata({
      session_id: "sess_1",
      compact_metadata: {
        trigger: "manual",
        pre_tokens: 100_000,
        postTokens: 25_000,
      },
    }),
  ).toMatchObject({
    trigger: "manual",
    sessionId: "sess_1",
    preTokens: 100_000,
    postTokens: 25_000,
  });
});
