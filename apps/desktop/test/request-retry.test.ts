import { expect, test } from "bun:test";
import { formatUserFacingRequestError, isQuotaOrRateLimitFailure } from "../src/main/request-retry";

test("detects quota and rate limit failures", () => {
  expect(isQuotaOrRateLimitFailure("HTTP 429 Too Many Requests")).toBe(true);
  expect(isQuotaOrRateLimitFailure("rate limit exceeded")).toBe(true);
  expect(isQuotaOrRateLimitFailure("fetch failed")).toBe(false);
});

test("formatUserFacingRequestError translates fetch failed", () => {
  expect(formatUserFacingRequestError("fetch failed")).toContain("上游模型 API");
});

test("formatUserFacingRequestError translates structured upstream 502 failures", () => {
  const raw =
    'API error (eco-reviewer-1): 502 {"error":{"message":"Upstream request failed","type":"upstream_error"}}';
  expect(formatUserFacingRequestError(raw)).toBe("上游模型服务暂时不可用，请稍后重试或切换 Provider。");
});

test("formatUserFacingRequestError surfaces local route misses as SDK model leaks", () => {
  const raw = '{"error":"No provider route configured for model claude-haiku-4-5-20251001."}';
  expect(formatUserFacingRequestError(raw)).toBe(
    "本地模型路由未配置 SDK 请求的模型 claude-haiku-4-5-20251001。这不是当前子代理编排配置的成功匹配；若再次出现，说明仍有 SDK 路径绕过了 Eco 子代理定义。",
  );
});
