import { expect, test } from "bun:test";
import {
  buildPlanExecutionFailureMessage,
  extractPlanFailureMessage,
  genericThreadFailureHint,
  planExecutionFailurePrefix,
  quotaRetryBannerHint,
  resolveRetryBannerDetail,
  resolveRetryBannerHint,
  resolveThreadMessageFromLiveEvent,
  shouldUpdateThreadSummaryFromLiveEvent,
} from "../src/shared/thread-failure-message";
import { formatUserFacingRequestError } from "../src/main/request-retry";

test("resolveThreadMessageFromLiveEvent rebuilds execution failure message", () => {
  expect(resolveThreadMessageFromLiveEvent("thread.execution_failed", "fetch failed")).toBe(
    `${planExecutionFailurePrefix}fetch failed`,
  );
});

test("extractPlanFailureMessage reads detail after execution failure event handling", () => {
  const message = resolveThreadMessageFromLiveEvent("thread.execution_failed", "fetch failed");
  expect(extractPlanFailureMessage(message)).toBe("fetch failed");
});

test("buildPlanExecutionFailureMessage preserves backend wording", () => {
  expect(buildPlanExecutionFailureMessage("network timeout")).toBe(
    `${planExecutionFailurePrefix}network timeout`,
  );
});

test("formatUserFacingRequestError translates fetch failed", () => {
  expect(formatUserFacingRequestError("fetch failed")).toContain("上游模型 API");
});

test("execution failure roundtrip keeps plan approval error visible", () => {
  const detail = formatUserFacingRequestError("fetch failed");
  const message = buildPlanExecutionFailureMessage(detail);
  expect(extractPlanFailureMessage(message)).toBe(detail);
});

test("shouldUpdateThreadSummaryFromLiveEvent ignores worktree cleanup notices", () => {
  expect(shouldUpdateThreadSummaryFromLiveEvent("worktree.removed")).toBe(false);
  expect(shouldUpdateThreadSummaryFromLiveEvent("thread.failed")).toBe(true);
});

test("resolveRetryBannerDetail ignores operational cleanup message on failed thread", () => {
  expect(resolveRetryBannerDetail("已清理隔离工作树。", "failed")).toBe(genericThreadFailureHint);
});

test("resolveRetryBannerDetail keeps formatted upstream error", () => {
  const detail = formatUserFacingRequestError("fetch failed");
  expect(resolveRetryBannerDetail(detail, "failed")).toBe(detail);
});

test("resolveRetryBannerDetail surfaces route config errors for blocked threads", () => {
  expect(
    resolveRetryBannerDetail("Configure a planner route before starting a coding thread.", "blocked"),
  ).toBe("Configure a planner route before starting a coding thread.");
});

test("resolveRetryBannerDetail uses blocked fallback when message is operational", () => {
  expect(resolveRetryBannerDetail("Local model router ready: http://127.0.0.1:1", "blocked")).toContain(
    "模型路由未就绪",
  );
});

test("resolveRetryBannerHint suggests switching routes for quota failures", () => {
  expect(resolveRetryBannerHint("API Error: 429 rate limit exceeded")).toBe(quotaRetryBannerHint);
  expect(resolveRetryBannerHint("fetch failed")).not.toBe(quotaRetryBannerHint);
});
