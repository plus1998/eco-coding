import { expect, test } from "bun:test";
import { createElectronEventSink, DesktopEventCenter } from "../src/main/event-center";
import {
  classifyThreadLiveEventForCenter,
  EVENT_CENTER_JSON_RPC_ERROR,
  EVENT_CENTER_JSON_RPC_METHODS,
  IPC_CHANNELS,
  type ThreadLiveEvent,
} from "../src/shared/ipc";

const fixedNow = () => new Date("2026-01-01T00:00:00.000Z");

function makeThreadEvent(input: Partial<ThreadLiveEvent> = {}): ThreadLiveEvent {
  return {
    threadId: "thr_event_center",
    type: "thread.running",
    message: "running",
    role: "system",
    stream: false,
    ...input,
  };
}

test("classifies thread live events for event center topics", () => {
  expect(
    classifyThreadLiveEventForCenter(
      makeThreadEvent({
        type: "thread.awaiting_plan",
        plan: {
          userPrompt: "build it",
          analysis: "needs plan",
          plan: "1. implement",
        },
      }),
    ),
  ).toBe("thread.plan");

  expect(
    classifyThreadLiveEventForCenter(
      makeThreadEvent({
        type: "clarification.requested",
        clarification: {
          toolUseId: "toolu_question",
          threadId: "thr_event_center",
          questions: [],
        },
      }),
    ),
  ).toBe("thread.clarification");

  expect(
    classifyThreadLiveEventForCenter(
      makeThreadEvent({
        type: "thread.run_projection_updated",
      }),
    ),
  ).toBe("thread.projection");

  expect(classifyThreadLiveEventForCenter(makeThreadEvent({ stream: true }))).toBe("thread.stream");

  expect(
    classifyThreadLiveEventForCenter(
      makeThreadEvent({
        type: "thread.execution_failed",
        message: "fetch failed",
      }),
    ),
  ).toBe("thread.lifecycle");

  expect(
    classifyThreadLiveEventForCenter(
      makeThreadEvent({
        type: "thread.plan_cleared",
        message: "plan cleared",
      }),
    ),
  ).toBe("thread.plan");
});

test("publishes settings updates with a global aggregate key", () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const seen: unknown[] = [];
  center.subscribe({
    publish(envelope, notification) {
      seen.push({ envelope, notification });
    },
  });

  const envelope = center.publishSettingsUpdated({
    threadId: "settings",
    type: "settings.updated",
    message: "Model provider settings saved.",
  });

  expect(envelope.kind).toBe("settings.updated");
  expect(envelope.aggregateKey).toBe("settings:global");
  expect(envelope.threadId).toBeUndefined();
  expect(seen).toHaveLength(1);
});

test("publishes center envelopes and JSON-RPC event notifications", () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const seen: unknown[] = [];
  center.subscribe({
    publish(envelope, notification) {
      seen.push({ envelope, notification });
    },
  });

  const envelope = center.publishThreadLiveEvent(
    makeThreadEvent({
      type: "clarification.requested",
      message: "Planner needs answers.",
      clarification: {
        toolUseId: "toolu_question",
        threadId: "thr_event_center",
        questions: [],
      },
    }),
  );

  expect(envelope.kind).toBe("thread.clarification");
  expect(envelope.threadId).toBe("thr_event_center");
  expect(envelope.aggregateKey).toBe("thread:thr_event_center");
  expect(envelope.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  expect(seen).toHaveLength(1);
  expect((seen[0] as { notification: { method: string } }).notification.method).toBe(
    EVENT_CENTER_JSON_RPC_METHODS.event,
  );
});

test("electron sink preserves legacy desktop event channels", () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const sent: Array<{ channel: string; payload: unknown }> = [];
  center.subscribe(
    createElectronEventSink((channel, payload) => {
      sent.push({ channel, payload });
    }),
  );

  center.publishPackageScriptEvent({ type: "output", runId: "pkg_1", data: "ready" });
  center.publishPackageJsonChanged("/repo/app");
  center.publishGitStatusChanged({
    workspacePath: "/repo/app",
    dirtyFileCount: 2,
    insertions: 10,
    deletions: 3,
  });
  center.publishThreadLiveEvent(makeThreadEvent({ type: "thread.completed", message: "done" }));

  expect(sent[0]).toEqual({
    channel: IPC_CHANNELS.workspacePackageScriptEvent,
    payload: { type: "output", runId: "pkg_1", data: "ready" },
  });
  expect(sent[1]).toEqual({
    channel: IPC_CHANNELS.workspacePackageJsonChanged,
    payload: "/repo/app",
  });
  expect(sent[2]).toEqual({
    channel: IPC_CHANNELS.threadEventsSubscribe,
    payload: {
      workspacePath: "/repo/app",
      dirtyFileCount: 2,
      insertions: 10,
      deletions: 3,
    },
  });
  expect(sent[3]).toEqual({
    channel: IPC_CHANNELS.threadEventsSubscribe,
    payload: makeThreadEvent({ type: "thread.completed", message: "done" }),
  });
});

test("handles JSON-RPC invoke requests through registered desktop commands", async () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  center.registerCommand(IPC_CHANNELS.threadList, () => [{ id: "thr_1" }]);

  const response = await center.handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: "req_1",
    method: EVENT_CENTER_JSON_RPC_METHODS.invoke,
    params: {
      channel: IPC_CHANNELS.threadList,
      args: [],
      caller: "mobile",
    },
  });

  expect(response).toEqual({
    jsonrpc: "2.0",
    id: "req_1",
    result: {
      channel: IPC_CHANNELS.threadList,
      result: [{ id: "thr_1" }],
    },
  });
});

test("rejects commands that are not remote-enabled", async () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });

  expect(() => center.registerCommand(IPC_CHANNELS.centerServerSignIn, () => undefined)).toThrow(
    "Event center command is not remote-enabled",
  );

  const response = await center.handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: "req_1",
    method: EVENT_CENTER_JSON_RPC_METHODS.invoke,
    params: {
      channel: IPC_CHANNELS.centerServerSignIn,
      args: [],
    },
  });

  expect(response).toEqual({
    jsonrpc: "2.0",
    id: "req_1",
    error: {
      code: EVENT_CENTER_JSON_RPC_ERROR.methodNotFound,
      message: `Desktop command is not remote-enabled: ${IPC_CHANNELS.centerServerSignIn}`,
    },
  });
});

test("validates remote command args before invoking handlers", async () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  let called = false;
  center.registerCommand(IPC_CHANNELS.threadStart, () => {
    called = true;
    return { thread: { id: "thr_1" } };
  });

  const response = await center.handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: "req_1",
    method: EVENT_CENTER_JSON_RPC_METHODS.invoke,
    params: {
      channel: IPC_CHANNELS.threadStart,
      args: [],
    },
  });

  expect(called).toBe(false);
  expect(response).toMatchObject({
    jsonrpc: "2.0",
    id: "req_1",
    error: {
      code: EVENT_CENTER_JSON_RPC_ERROR.invalidParams,
    },
  });
});

test("reports unregistered JSON-RPC commands explicitly", async () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });

  const response = await center.handleJsonRpcMessage({
    jsonrpc: "2.0",
    id: 2,
    method: EVENT_CENTER_JSON_RPC_METHODS.invoke,
    params: {
      channel: IPC_CHANNELS.threadStart,
      args: [{ workspacePath: "/repo", prompt: "ship it", runtimeConfig: {} }],
    },
  });

  expect(response).toEqual({
    jsonrpc: "2.0",
    id: 2,
    error: {
      code: EVENT_CENTER_JSON_RPC_ERROR.methodNotFound,
      message: `Desktop command is not registered: ${IPC_CHANNELS.threadStart}`,
    },
  });
});

test("reports malformed JSON-RPC payloads explicitly", async () => {
  const center = new DesktopEventCenter({ now: fixedNow, idPrefix: "test_evt" });
  const response = await center.handleJsonRpcMessage("{bad json");

  expect(response).toMatchObject({
    jsonrpc: "2.0",
    id: null,
    error: {
      code: EVENT_CENTER_JSON_RPC_ERROR.parseError,
      message: "Invalid JSON-RPC JSON payload.",
    },
  });
});
