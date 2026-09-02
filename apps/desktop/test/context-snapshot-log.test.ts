import { expect, test } from "bun:test";
import { isContextSnapshotLogEnabled, logContextSnapshot } from "../src/main/context-snapshot-log";

test("logContextSnapshot is a no-op when logging disabled", () => {
  const previous = process.env.ECO_CONTEXT_SNAPSHOT_LOG;
  const previousVerbose = process.env.ECO_UPSTREAM_LOG_VERBOSE;
  delete process.env.ECO_CONTEXT_SNAPSHOT_LOG;
  delete process.env.ECO_UPSTREAM_LOG_VERBOSE;
  try {
    expect(isContextSnapshotLogEnabled()).toBe(false);
    logContextSnapshot("test_phase", { threadId: "thr_log" });
  } finally {
    if (previous === undefined) {
      delete process.env.ECO_CONTEXT_SNAPSHOT_LOG;
    } else {
      process.env.ECO_CONTEXT_SNAPSHOT_LOG = previous;
    }
    if (previousVerbose === undefined) {
      delete process.env.ECO_UPSTREAM_LOG_VERBOSE;
    } else {
      process.env.ECO_UPSTREAM_LOG_VERBOSE = previousVerbose;
    }
  }
});

test("isContextSnapshotLogEnabled respects ECO_CONTEXT_SNAPSHOT_LOG=1", () => {
  const previous = process.env.ECO_CONTEXT_SNAPSHOT_LOG;
  process.env.ECO_CONTEXT_SNAPSHOT_LOG = "1";
  try {
    expect(isContextSnapshotLogEnabled()).toBe(true);
  } finally {
    if (previous === undefined) {
      delete process.env.ECO_CONTEXT_SNAPSHOT_LOG;
    } else {
      process.env.ECO_CONTEXT_SNAPSHOT_LOG = previous;
    }
  }
});
