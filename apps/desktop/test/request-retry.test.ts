import { expect, test } from "bun:test";
import {
  appendAutoRetryExhaustedHint,
  isQuotaOrRateLimitFailure,
  isRetryableRequestFailure,
  REQUEST_AUTO_RETRY_INTERVAL_MS,
  REQUEST_AUTO_RETRY_MAX,
  runWithRequestAutoRetry,
} from "../src/main/request-retry";

test("detects quota and rate limit failures", () => {
  expect(isQuotaOrRateLimitFailure("HTTP 429 Too Many Requests")).toBe(true);
  expect(isQuotaOrRateLimitFailure("rate limit exceeded")).toBe(true);
  expect(isQuotaOrRateLimitFailure("fetch failed")).toBe(false);
});

test("detects retryable API / proxy failures", () => {
  expect(
    isRetryableRequestFailure(
      "Claude Code returned an error result: API Error: API returned an empty or malformed response (HTTP 200)",
    ),
  ).toBe(true);
  expect(isRetryableRequestFailure("fetch failed")).toBe(true);
});

test("does not retry user cancel or plan business errors", () => {
  expect(isRetryableRequestFailure("cancelled by user")).toBe(false);
  expect(isRetryableRequestFailure("未能生成可执行的计划。")).toBe(false);
});

test("retries up to REQUEST_AUTO_RETRY_MAX times before giving up", async () => {
  let calls = 0;
  let scheduledRetries = 0;

  const result = await runWithRequestAutoRetry(
    async () => {
      calls += 1;
      return { ok: false as const, reason: "API Error: timeout" };
    },
    {
      retryIntervalMs: 0,
      onRetryScheduled: () => {
        scheduledRetries += 1;
      },
    },
  );

  expect(calls).toBe(REQUEST_AUTO_RETRY_MAX + 1);
  expect(scheduledRetries).toBe(REQUEST_AUTO_RETRY_MAX);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toContain(`已自动重试 ${REQUEST_AUTO_RETRY_MAX} 次`);
  }
});

test("succeeds on later attempt without exhausting retries", async () => {
  let calls = 0;
  const result = await runWithRequestAutoRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        return { ok: false as const, reason: "API Error: bad gateway" };
      }
      return { ok: true as const };
    },
    { retryIntervalMs: 0 },
  );

  expect(result.ok).toBe(true);
  expect(calls).toBe(3);
});

test("appendAutoRetryExhaustedHint is idempotent", () => {
  const once = appendAutoRetryExhaustedHint("API Error", 3);
  expect(appendAutoRetryExhaustedHint(once, 3)).toBe(once);
});

test("appendAutoRetryExhaustedHint skips hint when no retries happened", () => {
  expect(appendAutoRetryExhaustedHint("未提交 FinalizePlan", 0)).toBe("未提交 FinalizePlan");
});

test("does not retry FinalizePlan business errors", () => {
  expect(isRetryableRequestFailure("未提交 FinalizePlan，无法生成可执行计划。")).toBe(false);
});

test("REQUEST_AUTO_RETRY_INTERVAL_MS is 5 seconds", () => {
  expect(REQUEST_AUTO_RETRY_INTERVAL_MS).toBe(5000);
});
