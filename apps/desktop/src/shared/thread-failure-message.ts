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

export function persistThreadSummaryMessage(status: string, message: string): string {
  if (status === "failed" || status === "blocked") {
    return message;
  }
  if (message.startsWith(planExecutionFailurePrefix)) {
    return message;
  }
  return "";
}

export function resolveThreadMessageFromLiveEvent(eventType: string, eventMessage: string): string {
  if (eventType === "thread.execution_failed") {
    return buildPlanExecutionFailureMessage(eventMessage);
  }
  if (eventType === "thread.failed" || eventType === "thread.blocked") {
    return eventMessage;
  }
  if (eventMessage.startsWith(planExecutionFailurePrefix)) {
    return eventMessage;
  }
  return "";
}

const threadSummaryMessageExclusions = new Set([
  "thread.context_updated",
  "thread.usage_updated",
  "thread.todos_updated",
  "thread.title_updated",
  "thread.title_delta",
  "thread.title_failed",
  "thread.title_generating",
  "thread.runtime_config_updated",
  "thread.session_captured",
  "thread.unstarted_turn_discarded",
]);

export function shouldUpdateThreadSummaryFromLiveEvent(eventType: string): boolean {
  if (threadSummaryMessageExclusions.has(eventType)) {
    return false;
  }
  return eventType.startsWith("thread.");
}
