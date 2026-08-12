import { expect, test } from "bun:test";
import {
  applyLogicalRequestTerminal,
  handleBridgeMessagesRequest,
} from "../src/main/thread-live-request-coordinator";
import { ThreadLiveRequestRegistry } from "../src/main/thread-live-request-registry";

test("handleBridgeMessagesRequest records emitTimelineActivity on registry entry", () => {
  const registry = new ThreadLiveRequestRegistry();
  const silent = handleBridgeMessagesRequest(registry, {
    threadId: "thr_1",
    role: "coder",
    emitTimelineActivity: false,
  });
  expect(silent.emitTimelineActivity).toBe(false);
  expect(registry.listActive("thr_1")[0]?.emitTimelineActivity).toBe(false);

  const visible = handleBridgeMessagesRequest(registry, {
    threadId: "thr_1",
    role: "planner",
    emitTimelineActivity: true,
  });
  expect(visible.emitTimelineActivity).toBe(true);
  expect(registry.listActive("thr_1")[1]?.emitTimelineActivity).toBe(true);
});

test("handleBridgeMessagesRequest snapshot always corresponds to a registry entry", () => {
  const registry = new ThreadLiveRequestRegistry();
  const snapshot = handleBridgeMessagesRequest(registry, {
    threadId: "thr_create",
    role: "coder",
    agentId: "agent_a",
    emitTimelineActivity: true,
  });

  const entry = registry.findEntryByLogicalId("thr_create", snapshot.logicalRequestId);
  expect(entry).toBeDefined();
  expect(entry?.logicalRequestId).toBe(snapshot.logicalRequestId);
  expect(entry?.role).toBe(snapshot.role);
  expect(entry?.agentId).toBe(snapshot.agentId);
  expect(entry?.emitTimelineActivity).toBe(snapshot.emitTimelineActivity);
});

test("applyLogicalRequestTerminal suppresses UI but clears registry for silent entries", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_silent";
  const { logicalRequestId } = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: false,
  });

  const uiEvents: string[] = [];
  applyLogicalRequestTerminal(
    registry,
    { threadId, eventRole: "coder", logicalRequestId, stage: "completed" },
    ({ displayRequestId }) => {
      uiEvents.push(displayRequestId);
    },
  );

  expect(uiEvents).toEqual([]);
  expect(registry.listActive(threadId)).toHaveLength(0);
});

test("applyLogicalRequestTerminal emits logical correlation id then always clears registry", () => {
  const registry = new ThreadLiveRequestRegistry();
  const threadId = "thr_visible";
  const { logicalRequestId } = handleBridgeMessagesRequest(registry, {
    threadId,
    role: "coder",
    emitTimelineActivity: true,
  });
  registry.recordProviderRequestIdByLogicalId(threadId, logicalRequestId, "provider_1");

  const uiEvents: string[] = [];
  applyLogicalRequestTerminal(
    registry,
    { threadId, eventRole: "coder", logicalRequestId, stage: "failed", detail: "HTTP 502" },
    ({ displayRequestId, providerRequestId, stage, detail }) => {
      uiEvents.push(`${displayRequestId}:${providerRequestId ?? ""}:${stage}:${detail ?? ""}`);
    },
  );

  expect(uiEvents).toEqual([`${logicalRequestId}:provider_1:failed:HTTP 502`]);
  expect(registry.listActive(threadId)).toHaveLength(0);
});
