import { isQuotaOrRateLimitFailure } from "./request-errors";
import type { ThreadStatus } from "./ipc";

export const planExecutionFailurePrefix = "执行失败，已回退更改。";

export const genericThreadFailureHint =
  "连接上游模型失败或请求未完成。请检查 Provider 的 Base URL、API Key 与网络；详细日志见控制台 [eco-upstream]。";

const operationalThreadMessagePatterns = [
  /^已清理隔离工作树/,
  /^Isolated worktree ready:/i,
  /^Local model router ready:/i,
  /^状态已更新$/,
  /^计划阶段已结束/,
  /^执行已结束/,
  /^回答已结束/,
  /^Creating isolated worktree/i,
];

export function buildPlanExecutionFailureMessage(detail: string): string {
  const trimmed = detail.trim();
  return trimmed ? `${planExecutionFailurePrefix}${trimmed}` : planExecutionFailurePrefix;
}

export function extractPlanFailureMessage(threadMessage: string): string | undefined {
  if (!threadMessage.startsWith(planExecutionFailurePrefix)) {
    return undefined;
  }
  const detail = threadMessage.slice(planExecutionFailurePrefix.length).trim();
  return detail.length > 0 ? detail : undefined;
}

export function resolveThreadMessageFromLiveEvent(eventType: string, eventMessage: string): string {
  if (eventType === "thread.execution_failed") {
    return buildPlanExecutionFailureMessage(eventMessage);
  }
  return eventMessage;
}

export function shouldUpdateThreadSummaryFromLiveEvent(eventType: string): boolean {
  return eventType.startsWith("thread.");
}

export function isOperationalThreadMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }
  return operationalThreadMessagePatterns.some((pattern) => pattern.test(trimmed));
}

export function resolveRetryBannerDetail(threadMessage: string, status: ThreadStatus): string {
  const planFailure = extractPlanFailureMessage(threadMessage);
  if (planFailure) {
    return planFailure;
  }
  if (
    (status === "failed" || status === "blocked") &&
    threadMessage.trim() &&
    !isOperationalThreadMessage(threadMessage)
  ) {
    return threadMessage.trim();
  }
  if (status === "blocked") {
    return "模型路由未就绪或会话无法启动。请检查设置中的路由方案与 Provider 配置。";
  }
  return genericThreadFailureHint;
}

export const quotaRetryBannerHint =
  "同一上游已自动重试多次仍失败。请通过输入区「切换路由方案」或下方选择备用方案，换用其他 Provider 后重试；跨服务商续聊将使用对话记录重建上下文。";

export const defaultRetryBannerHint =
  "工作区更改已回退（如有）。可重试同一需求；若仍出现 HTTP 200 空响应，请检查模型代理或上游 API 配置。";

export function resolveRetryBannerHint(detail: string): string {
  if (isQuotaOrRateLimitFailure(detail)) {
    return quotaRetryBannerHint;
  }
  return defaultRetryBannerHint;
}
