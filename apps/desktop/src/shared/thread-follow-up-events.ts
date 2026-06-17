export function isThreadFollowUpLiveEvent(liveType: string): boolean {
  return liveType.startsWith("thread.follow_up.");
}

/** Operational follow-up status lines that should not appear in the dialogue feed. */
export function isThreadFollowUpActivityMessage(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) {
    return false;
  }
  return (
    trimmed === "已取消排队的后续消息。" ||
    trimmed === "已记录后续消息，并标记为需要立即处理。" ||
    trimmed === "正在停止当前步骤，随后处理最新后续消息。" ||
    trimmed === "已开始处理排队的后续消息。" ||
    trimmed.startsWith("后续消息处理失败：")
  );
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
