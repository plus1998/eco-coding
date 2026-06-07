import { expect, test } from "bun:test";
import {
  buildPlanExecutionFailureMessage,
  extractPlanFailureMessage,
  planExecutionFailurePrefix,
  quotaRetryBannerHint,
  resolveRetryBannerDetail,
  resolveRetryBannerHint,
  resolveThreadMessageFromLiveEvent,
  shouldUpdateThreadSummaryFromLiveEvent,
  stripThreadInterruptedSuffix,
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

test("shouldUpdateThreadSummaryFromLiveEvent ignores context and usage telemetry", () => {
  expect(shouldUpdateThreadSummaryFromLiveEvent("thread.context_updated")).toBe(false);
  expect(shouldUpdateThreadSummaryFromLiveEvent("thread.usage_updated")).toBe(false);
});

test("resolveRetryBannerDetail keeps blocked reason after context refresh message would have applied", () => {
  const blocked =
    "规划阶段未完成：模型未通过 mcp__eco_plan__finalize_plan 提交计划。可在下方继续对话、切换模型后重试，或点击「重试此次请求」。";
  expect(resolveRetryBannerDetail(blocked, "blocked")).toContain("规划阶段未完成");
  expect(resolveRetryBannerDetail("上下文已更新", "blocked")).toBeUndefined();
});

test("resolveRetryBannerDetail ignores operational cleanup message on failed thread", () => {
  expect(resolveRetryBannerDetail("已清理隔离工作树。", "failed")).toBeUndefined();
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

test("resolveRetryBannerDetail returns undefined when blocked message is operational only", () => {
  expect(resolveRetryBannerDetail("Local model router ready: http://127.0.0.1:1", "blocked")).toBeUndefined();
});

test("stripThreadInterruptedSuffix removes continue hint suffix", () => {
  expect(
    stripThreadInterruptedSuffix("API error 可在下方继续对话、切换模型后重试，或点击「重试此次请求」。"),
  ).toBe("API error");
});

test("resolveRetryBannerHint only adds guidance for quota failures", () => {
  expect(resolveRetryBannerHint("API Error: 429 rate limit exceeded")).toBe(quotaRetryBannerHint);
  expect(resolveRetryBannerHint("fetch failed")).toBeUndefined();
  expect(resolveRetryBannerHint(undefined)).toBeUndefined();
});

test("formatUserFacingRequestError translates structured upstream 502 failures", () => {
  const raw =
    'API error (eco-reviewer-1): 502 {"error":{"message":"Upstream request failed","type":"upstream_error"}}';
  expect(formatUserFacingRequestError(raw)).toBe(
    "上游模型服务暂时不可用，请稍后重试或切换 Provider。",
  );
});

test("formatUserFacingRequestError surfaces local route misses as SDK model leaks", () => {
  const raw =
    '{"error":"No provider route configured for model claude-haiku-4-5-20251001."}';
  expect(formatUserFacingRequestError(raw)).toBe(
    "本地模型路由未配置 SDK 请求的模型 claude-haiku-4-5-20251001。这不是当前子代理编排配置的成功匹配；若再次出现，说明仍有 SDK 路径绕过了 Eco 子代理定义。",
  );
});
