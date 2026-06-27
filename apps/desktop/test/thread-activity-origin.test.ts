import { expect, test } from "bun:test";
import {
  isReconnectActivityOrigin,
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
  expect(isRequestFailureFeedNoiseOrigin("eco.thread_blocked")).toBe(true);
  expect(isUpstreamErrorPhaseOrigin("sdk.upstream_error")).toBe(true);
  expect(isReconnectActivityOrigin("sdk.upstream_error")).toBe(false);
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
