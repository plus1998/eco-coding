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
  if (status === "failed" && threadMessage.trim() && !isOperationalThreadMessage(threadMessage)) {
    return threadMessage.trim();
  }
  return genericThreadFailureHint;
}
