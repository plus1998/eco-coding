import { expect, test } from "bun:test";
import {
  isReconnectActivityOrigin,
  isRedundantApiFailureBlockedMessage,
  isRequestFailureFeedNoiseOrigin,
  isUpstreamErrorPhaseOrigin,
  resolveReconnectPhaseDisplay,
  resolveThreadActivityOrigin,
  shouldClearReconnectTimelineItem,
} from "../src/shared/thread-activity-origin";

test("resolveThreadActivityOrigin maps legacy liveType values", () => {
  expect(resolveThreadActivityOrigin({ metadata: { liveType: "thread.api_error" } })).toBe(
    "proxy.connection_error",
  );
  expect(resolveThreadActivityOrigin({ metadata: { liveType: "thread.blocked" } })).toBe(
    "eco.thread_blocked",
  );
  expect(resolveThreadActivityOrigin({ metadata: { liveType: "request.retry_scheduled" } })).toBe(
    "sdk.api_retry",
  );
});

test("resolveReconnectPhaseDisplay uses origin metadata instead of SDK text", () => {
  expect(
    resolveReconnectPhaseDisplay({
      text: "API retry 2/5…",
      metadata: {
        activityOrigin: "sdk.api_retry",
        retry: { attempt: 2, maxRetries: 5 },
      },
    }),
  ).toEqual({ summary: "重连 2/5" });

  expect(
    resolveReconnectPhaseDisplay({
      text: "【连接失败】HTTP 503：ignored body",
      metadata: { activityOrigin: "proxy.connection_error" },
      apiError: { statusCode: 503 },
    }),
  ).toEqual({
    summary: "连接失败 · HTTP 503",
    failed: true,
  });
});

test("request failure feed noise origins", () => {
  expect(isRequestFailureFeedNoiseOrigin("sdk.run_failure")).toBe(true);
  expect(isRequestFailureFeedNoiseOrigin("eco.thread_failed")).toBe(true);
  // Infrastructure blocks must not be global feed noise (port conflict, etc.).
  expect(isRequestFailureFeedNoiseOrigin("eco.thread_blocked")).toBe(false);
  expect(isUpstreamErrorPhaseOrigin("sdk.upstream_error")).toBe(true);
  expect(isReconnectActivityOrigin("sdk.upstream_error")).toBe(false);
});

test("isRedundantApiFailureBlockedMessage only matches API wrap blockers", () => {
  expect(
    isRedundantApiFailureBlockedMessage(
      "Claude Code returned an error result: API Error: 503 Loading model. 可在下方继续对话、切换模型后重试，或点击「重试此次请求」。",
    ),
  ).toBe(true);
  expect(
    isRedundantApiFailureBlockedMessage(
      "eco-bridge port 18765 is already in use by another process. Stop it so Electron main can host the SDK bridge.",
    ),
  ).toBe(false);
});

test("shouldClearReconnectTimelineItem treats successful agent output as recovery", () => {
  expect(
    shouldClearReconnectTimelineItem({
      eventType: "message.final",
      text: "已根据你的需求完成修改。",
      role: "planner",
    }),
  ).toBe(true);
  expect(
    shouldClearReconnectTimelineItem({
      eventType: "request.retry_scheduled",
      text: "API retry 2/5…",
      metadata: { activityOrigin: "sdk.api_retry", retry: { attempt: 2, maxRetries: 5 } },
    }),
  ).toBe(false);
  expect(
    shouldClearReconnectTimelineItem({
      eventType: "message.final",
      text: "API Error: 503 upstream",
      metadata: { activityOrigin: "sdk.upstream_error" },
    }),
  ).toBe(false);
});
