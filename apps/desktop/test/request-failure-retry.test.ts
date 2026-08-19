import { expect, test } from "bun:test";
import {
  buildRequestFailureRetryTargets,
  isRetryableRequestFailureItem,
  readUserPromptRetryIdentity,
} from "../src/renderer/request-failure-retry";
import { supportsHistoryRewrite, supportsOneClickRequestRetry } from "../src/shared/thread-request-retry";
import type { ThreadRunProjectionTimelineItem } from "../src/shared/ipc";

function item(
  input: Partial<ThreadRunProjectionTimelineItem> & { id: string },
): ThreadRunProjectionTimelineItem {
  return {
    id: input.id,
    sequence: input.sequence ?? 1,
    eventType: input.eventType ?? "message.final",
    scope: input.scope ?? "main",
    text: input.text ?? "",
    at: input.at ?? "2026-01-01T00:00:00.000Z",
    ...(input.role && { role: input.role }),
    ...(input.agentId && { agentId: input.agentId }),
    ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
    ...(input.requestId && { requestId: input.requestId }),
    ...(input.streamKey && { streamKey: input.streamKey }),
    ...(input.metadata && { metadata: input.metadata }),
  };
}

const userPrompt = item({
  id: "user-1",
  sequence: 1,
  eventType: "thread.status",
  role: "user",
  text: "请继续实现登录页",
  streamKey: "user:abc",
  metadata: {
    liveType: "thread.user_prompt",
    rewindTarget: { activityLineId: "user:abc" },
  },
});

test("supportsOneClickRequestRetry covers rewrite cores and ACP, not Pi", () => {
  expect(supportsHistoryRewrite("claude")).toBe(true);
  expect(supportsHistoryRewrite("codex")).toBe(true);
  expect(supportsHistoryRewrite("acp")).toBe(false);
  expect(supportsOneClickRequestRetry("claude")).toBe(true);
  expect(supportsOneClickRequestRetry("acp")).toBe(true);
  expect(supportsOneClickRequestRetry("pi")).toBe(false);
});

test("readUserPromptRetryIdentity prefers rewindTarget then streamKey", () => {
  expect(readUserPromptRetryIdentity(userPrompt)).toEqual({
    activityLineId: "user:abc",
    prompt: "请继续实现登录页",
    hasImages: false,
  });
  expect(
    readUserPromptRetryIdentity(
      item({
        id: "tre:live_1",
        eventType: "thread.status",
        role: "user",
        text: "Cursor 失败后再试",
        streamKey: "user:from-stream",
        metadata: { liveType: "thread.user_prompt" },
      }),
    ),
  ).toEqual({
    activityLineId: "user:from-stream",
    prompt: "Cursor 失败后再试",
    hasImages: false,
  });
});

test("isRetryableRequestFailureItem accepts connection, upstream, and thread failures", () => {
  expect(
    isRetryableRequestFailureItem(
      item({
        id: "reconnect",
        eventType: "api.error",
        text: "【连接失败】HTTP 502：upstream unavailable",
        metadata: {
          activityOrigin: "proxy.connection_error",
          apiError: { statusCode: 502, message: "upstream unavailable" },
        },
      }),
    ),
  ).toBe(true);
  expect(
    isRetryableRequestFailureItem(
      item({
        id: "upstream",
        eventType: "message.final",
        text: "API Error: 503 Loading model.",
        metadata: { activityOrigin: "sdk.upstream_error" },
      }),
    ),
  ).toBe(true);
  expect(
    isRetryableRequestFailureItem(
      item({
        id: "retrying",
        eventType: "request.retry_scheduled",
        text: "API retry 2/5…",
        metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 2, maxRetries: 5 } },
      }),
    ),
  ).toBe(false);
  expect(
    isRetryableRequestFailureItem(
      item({
        id: "agent-error",
        scope: "agent",
        eventType: "api.error",
        text: "subagent boom",
        metadata: { activityOrigin: "proxy.connection_error" },
      }),
    ),
  ).toBe(false);
  expect(
    isRetryableRequestFailureItem(
      item({
        id: "cursor-exhausted",
        eventType: "message.final",
        text: "Error: RetriableError: [resource_exhausted] Error",
      }),
    ),
  ).toBe(true);
});

test("buildRequestFailureRetryTargets maps Cursor RetriableError finals without activityOrigin", () => {
  const targets = buildRequestFailureRetryTargets({
    coreKind: "acp",
    threadStatus: "completed",
    items: [
      userPrompt,
      item({
        id: "fail",
        sequence: 2,
        eventType: "message.final",
        text: "Error: RetriableError: [resource_exhausted] Error",
      }),
    ],
  });
  expect(targets.get("fail")).toEqual({
    activityLineId: "user:abc",
    prompt: "请继续实现登录页",
    hasImages: false,
  });
});

test("buildRequestFailureRetryTargets maps the latest failure to the preceding user prompt", () => {
  const targets = buildRequestFailureRetryTargets({
    coreKind: "claude",
    threadStatus: "failed",
    items: [
      userPrompt,
      item({
        id: "fail",
        sequence: 2,
        eventType: "api.error",
        text: "【连接失败】HTTP 502：upstream unavailable",
        metadata: {
          activityOrigin: "proxy.connection_error",
          apiError: { statusCode: 502, message: "upstream unavailable" },
        },
      }),
    ],
  });
  expect(targets.get("fail")).toEqual({
    activityLineId: "user:abc",
    prompt: "请继续实现登录页",
    hasImages: false,
  });
});

test("buildRequestFailureRetryTargets only attaches retry to the latest failure in a turn", () => {
  const earlierFail = item({
    id: "fail-1",
    sequence: 2,
    eventType: "api.error",
    text: "【连接失败】HTTP 502",
    metadata: { activityOrigin: "proxy.connection_error" },
  });
  const laterFail = item({
    id: "fail-2",
    sequence: 3,
    eventType: "message.final",
    text: "API Error: 503 Loading model.",
    metadata: { activityOrigin: "sdk.upstream_error" },
  });
  const targets = buildRequestFailureRetryTargets({
    coreKind: "claude",
    threadStatus: "failed",
    items: [userPrompt, earlierFail, laterFail],
  });
  expect(targets.has("fail-1")).toBe(false);
  expect(targets.get("fail-2")).toMatchObject({ activityLineId: "user:abc" });
});

test("buildRequestFailureRetryTargets hides retry while the thread is running", () => {
  const targets = buildRequestFailureRetryTargets({
    coreKind: "claude",
    threadStatus: "running",
    items: [
      userPrompt,
      item({
        id: "fail",
        sequence: 2,
        eventType: "api.error",
        text: "【连接失败】HTTP 502",
        metadata: { activityOrigin: "proxy.connection_error" },
      }),
    ],
  });
  expect(targets.size).toBe(0);
});

test("ACP only retries failures after the latest user prompt", () => {
  const olderFail = item({
    id: "old-fail",
    sequence: 2,
    eventType: "api.error",
    text: "【连接失败】HTTP 502",
    metadata: { activityOrigin: "proxy.connection_error" },
  });
  const laterUser = item({
    id: "user-2",
    sequence: 3,
    eventType: "thread.status",
    role: "user",
    text: "换个模型再试",
    metadata: {
      liveType: "thread.user_prompt",
      rewindTarget: { activityLineId: "user:later" },
    },
  });
  const latestFail = item({
    id: "new-fail",
    sequence: 4,
    eventType: "api.error",
    text: "【连接失败】HTTP 503",
    metadata: { activityOrigin: "proxy.connection_error" },
  });
  const targets = buildRequestFailureRetryTargets({
    coreKind: "acp",
    threadStatus: "failed",
    items: [userPrompt, olderFail, laterUser, latestFail],
  });
  expect(targets.has("old-fail")).toBe(false);
  expect(targets.get("new-fail")).toMatchObject({
    activityLineId: "user:later",
    prompt: "换个模型再试",
  });
});

test("Pi has no one-click retry target", () => {
  const targets = buildRequestFailureRetryTargets({
    coreKind: "pi",
    threadStatus: "failed",
    items: [
      userPrompt,
      item({
        id: "fail",
        sequence: 2,
        eventType: "api.error",
        text: "【连接失败】HTTP 502",
        metadata: { activityOrigin: "proxy.connection_error" },
      }),
    ],
  });
  expect(targets.size).toBe(0);
});
