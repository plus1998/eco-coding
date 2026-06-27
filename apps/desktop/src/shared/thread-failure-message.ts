export const planExecutionFailurePrefix = "执行失败，已回退更改。";

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
