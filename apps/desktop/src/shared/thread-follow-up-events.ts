export function isThreadFollowUpLiveEvent(liveType: string): boolean {
  return liveType.startsWith("thread.follow_up.");
}

const THREAD_OPERATIONAL_STATUS_PATTERNS = [
  /^正在停止(?:当前步骤|…)/u,
  /^已停止/u,
  /^正在继续执行/u,
  /^正在按计划执行/u,
  /^正在回答/u,
  /^正在分析并制定计划/u,
  /^正在交给主代理处理/u,
  /^正在启动/u,
  /^正在继续 Codex 会话/u,
  /^正在继续处理/u,
  /^Codex 已连接/u,
  /^PI 已就绪/u,
  /^Local model router ready:/iu,
  /^Working in project directory:/u,
  /^已开始处理排队的后续消息。/u,
  /^已取消排队的后续消息。/u,
  /^已记录后续消息，并标记为需要立即处理。/u,
  /^后续消息处理失败：/u,
] as const;

/** Operational lifecycle / follow-up status lines that should not appear in the dialogue feed. */
export function isThreadFollowUpActivityMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  return THREAD_OPERATIONAL_STATUS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function isRecordedUserPromptLiveEvent(liveType: string | undefined): boolean {
  return liveType === "thread.user_prompt";
}

export function isUserPromptActivityLine(line: { role: string; message: string }): boolean {
  if (line.role !== "user") {
    return false;
  }
  const text = line.message.trim();
  return text.length > 0 && !isThreadFollowUpActivityMessage(text);
}
