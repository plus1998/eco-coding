/** Automatic retries after transient request / API failures. */
export const REQUEST_AUTO_RETRY_MAX = 2;
export const REQUEST_AUTO_RETRY_INTERVAL_MS = 5000;
export const REQUEST_AUTO_RETRY_MAX_ELAPSED_MS = 20_000;

export type RequestAttemptResult =
  | { ok: true }
  | { ok: false; reason: string; aborted?: boolean };

import {
  formatApiErrorUserMessage,
  parseLegacyApiErrorActivityMessage,
  parseOtelApiErrorAttribute,
} from "@eco/runtime";
import { isQuotaOrRateLimitFailure } from "../shared/request-errors";

export { isQuotaOrRateLimitFailure } from "../shared/request-errors";

export function isRetryableRequestFailure(reason: string): boolean {
  const text = reason.trim();
  if (!text) {
    return false;
  }
  const normalized = text.toLowerCase();
  if (
    normalized.includes("cancelled by user") ||
    normalized.includes("cancelled") ||
    text.includes("已取消") ||
    text.includes("已停止")
  ) {
    return false;
  }
  if (
    text.includes("未能生成可执行的计划") ||
    text.includes("找不到待批准的计划") ||
    text.includes("未提交 FinalizePlan")
  ) {
    return false;
  }
  if (normalized.includes("permission denied") || text.includes("权限")) {
    return false;
  }

  return (
    normalized.includes("api error") ||
    normalized.includes("malformed response") ||
    normalized.includes("empty or malformed") ||
    normalized.includes("claude code returned an error") ||
    normalized.includes("agent run failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("network") ||
    normalized.includes("fetch failed") ||
    normalized.includes("socket hang up") ||
    normalized.includes("terminated") ||
    normalized.includes("502") ||
    normalized.includes("503") ||
    normalized.includes("504") ||
    normalized.includes("429") ||
    normalized.includes("rate limit") ||
    normalized.includes("overloaded") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable")
  );
}

export function formatUserFacingRequestError(reason: string): string {
  const text = reason.trim();
  if (!text) {
    return "请求失败，请稍后重试。";
  }

  const normalized = text.toLowerCase();
  if (normalized.includes("fetch failed")) {
    return "无法连接上游模型 API（网络错误或地址不可达）。请检查 Provider 的 Base URL、网络与 API Key。";
  }
  if (
    normalized.includes("econnrefused") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("socket hang up")
  ) {
    return "连接上游模型 API 失败。请检查网络与 Provider 配置。";
  }
  if (normalized.includes("terminated")) {
    return "上游模型连接中断（流式响应未完成）。请检查 Provider 的 Base URL、API Key 与网络后重试。";
  }
  if (text.includes("未提交 FinalizePlan")) {
    return "规划阶段未完成：模型未通过 mcp__eco_plan__finalize_plan 提交计划。若对话里只有「计划已提交」等文字而无工具调用，请重试或更换 Planner 模型。";
  }

  const legacyApiError = parseLegacyApiErrorActivityMessage(text);
  if (legacyApiError) {
    return formatApiErrorUserMessage(legacyApiError);
  }
  const otelApiError = parseOtelApiErrorAttribute(text);
  if (otelApiError) {
    return formatApiErrorUserMessage(otelApiError);
  }

  return text;
}

export function appendAutoRetryExhaustedHint(reason: string, retriesAttempted = 0): string {
  if (retriesAttempted <= 0) {
    return reason;
  }
  const hint = `（已自动重试 ${retriesAttempted} 次，可手动点击「重试此次请求」）`;
  if (reason.includes("已自动重试")) {
    return reason;
  }
  return `${reason}${hint}`;
}

export async function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (signal.aborted) {
    throw new Error("cancelled by user");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("cancelled by user"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWithRequestAutoRetry(
  runOnce: () => Promise<RequestAttemptResult>,
  options?: {
    signal?: AbortSignal;
    retryIntervalMs?: number;
    onRetryScheduled?: (retryIndex: number, maxRetries: number, reason: string) => void;
  },
): Promise<RequestAttemptResult> {
  const retryIntervalMs = options?.retryIntervalMs ?? REQUEST_AUTO_RETRY_INTERVAL_MS;
  let lastReason = "请求失败";
  const maxRetries = REQUEST_AUTO_RETRY_MAX;
  const started = Date.now();

  for (let retry = 0; retry <= maxRetries; retry += 1) {
    if (options?.signal?.aborted) {
      return { ok: false, reason: "cancelled by user", aborted: true };
    }

    if (retry > 0) {
      options?.onRetryScheduled?.(retry, maxRetries, lastReason);
      try {
        await sleepMs(retryIntervalMs, options?.signal);
      } catch {
        return { ok: false, reason: "cancelled by user", aborted: true };
      }
    }

    const result = await runOnce();
    if (result.ok || result.aborted) {
      return result;
    }

    lastReason = result.reason;
    const canRetry =
      retry < maxRetries &&
      Date.now() - started < REQUEST_AUTO_RETRY_MAX_ELAPSED_MS &&
      isRetryableRequestFailure(lastReason);
    if (!canRetry) {
      return { ok: false, reason: appendAutoRetryExhaustedHint(lastReason, retry) };
    }
  }

  return { ok: false, reason: appendAutoRetryExhaustedHint(lastReason, maxRetries) };
}
