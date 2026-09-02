import { expect, test } from "bun:test";
import {
  applyExactLogicalRequestLateBind,
  applyLogicalRequestTerminal,
  handleBridgeMessagesRequest,
} from "../src/main/thread-live-request-coordinator";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";

test("applyExactLogicalRequestLateBind: registry conflict leaves DB untouched", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_reg_conflict";
  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    agentId: "agent_a",
    emitTimelineActivity: true,
  });

  let dbCalls = 0;
  const store = {
    attributeThreadRunEventsByLogicalRequestId() {
      dbCalls += 1;
      return { updated: 1, conflict: false };
    },
  };

  const result = applyExactLogicalRequestLateBind(registry, store, {
    threadId,
    logicalRequestId: snapshot.logicalRequestId,
    agentId: "agent_b",
    role: "coder",
  });
  expect(result).toEqual({ ok: false, reason: "agent_conflict" });
  expect(dbCalls).toBe(0);
  expect(registry.findEntryByLogicalId(threadId, snapshot.logicalRequestId)?.agentId).toBe("agent_a");
});

test("applyExactLogicalRequestLateBind: DB conflict leaves registry unbound", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_db_conflict";
  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: true,
  });

  const store = {
    attributeThreadRunEventsByLogicalRequestId() {
      return { updated: 0, conflict: true };
    },
  };

  const result = applyExactLogicalRequestLateBind(registry, store, {
    threadId,
    logicalRequestId: snapshot.logicalRequestId,
    agentId: "agent_a",
    role: "coder",
  });
  expect(result).toEqual({ ok: false, reason: "db_conflict" });
  expect(registry.findEntryByLogicalId(threadId, snapshot.logicalRequestId)?.agentId).toBeUndefined();
});

test("applyExactLogicalRequestLateBind: terminal-before-bind patches via finalized then binds", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_terminal_then_bind";
  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: true,
  });
  applyLogicalRequestTerminal(registry, {
    threadId,
    logicalRequestId: snapshot.logicalRequestId,
    stage: "completed",
    eventRole: "coder",
    runAttemptId: "attempt_1",
  });

  const store = {
    attributeThreadRunEventsByLogicalRequestId(
      _threadId: string,
      logicalRequestId: string,
      input: { agentId: string; role?: string },
    ) {
      expect(logicalRequestId).toBe(snapshot.logicalRequestId);
      expect(input.agentId).toBe("agent_a");
      return { updated: 2, conflict: false };
    },
  };

  const result = applyExactLogicalRequestLateBind(registry, store, {
    threadId,
    logicalRequestId: snapshot.logicalRequestId,
    agentId: "agent_a",
    role: "coder",
  });
  expect(result).toMatchObject({
    ok: true,
    bound: true,
    updated: 2,
    source: "finalized",
    agentId: "agent_a",
  });
  expect(registry.findFinalizedByLogicalId(threadId, snapshot.logicalRequestId)?.agentId).toBe("agent_a");
});

test("applyExactLogicalRequestLateBind: silent path binds registry without DB", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_silent_late";
  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: false,
  });
  let dbCalls = 0;
  const store = {
    attributeThreadRunEventsByLogicalRequestId() {
      dbCalls += 1;
      return { updated: 1, conflict: false };
    },
  };

  const result = applyExactLogicalRequestLateBind(registry, store, {
    threadId,
    logicalRequestId: snapshot.logicalRequestId,
    agentId: "agent_silent",
    role: "coder",
  });
  expect(result).toMatchObject({ ok: true, bound: true, updated: 0, emitTimelineActivity: false });
  expect(dbCalls).toBe(0);
  expect(registry.findEntryByLogicalId(threadId, snapshot.logicalRequestId)?.agentId).toBe("agent_silent");
});
