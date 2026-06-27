import type { ThreadStatus } from "./ipc";

export const planExecutionFailurePrefix = "执行失败，已回退更改。";

/** Shown only when the retry banner has no concrete failure text from the backend. */
export const retryBannerNoDetailHint =
  "未记录具体错误详情。请查看 ~/.eco-coding/logs/upstream.log 或终端中的 [eco-upstream] 日志。";

const threadInterruptedContinueSuffix =
  "可在下方继续对话，或切换配置后重新发送。";

const operationalThreadMessagePatterns = [
  /^已清理隔离工作树/,
  /^Isolated worktree ready:/i,
  /^Local model router ready:/i,
  /^状态已更新$/,
  /^计划阶段已结束/,
  /^上下文已更新$/,
  /^正在刷新上下文用量/,
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

const threadSummaryMessageExclusions = new Set([
  "thread.context_updated",
  "thread.usage_updated",
  "thread.todos_updated",
  "thread.title_updated",
  "thread.title_delta",
  "thread.title_failed",
  "thread.runtime_config_updated",
]);

export function shouldUpdateThreadSummaryFromLiveEvent(eventType: string): boolean {
  if (threadSummaryMessageExclusions.has(eventType)) {
    return false;
  }
  return eventType.startsWith("thread.");
}

/** Strip the standard suffix appended by markThreadInterrupted for banner display. */
export function stripThreadInterruptedSuffix(message: string): string {
  const trimmed = message.trim();
  if (trimmed.endsWith(threadInterruptedContinueSuffix)) {
    return trimmed.slice(0, -threadInterruptedContinueSuffix.length).trim();
  }
  return trimmed;
}

export function isOperationalThreadMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return true;
  }
  return operationalThreadMessagePatterns.some((pattern) => pattern.test(trimmed));
}

export function resolveRetryBannerDetail(
  threadMessage: string,
  status: ThreadStatus,
): string | undefined {
  const planFailure = extractPlanFailureMessage(threadMessage);
  if (planFailure) {
    return planFailure;
  }
  const core = stripThreadInterruptedSuffix(threadMessage);
  if (
    (status === "failed" || status === "blocked") &&
    core &&
    !isOperationalThreadMessage(core)
  ) {
    return core;
  }
  return undefined;
}

