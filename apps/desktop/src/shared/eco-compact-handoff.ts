import type { ActivityContextLine } from "./thread-continuation";

export interface ThreadCompactHandoffData {
  summary: string;
  recentUserMessages: string[];
  postTokensEstimate: number;
}

export interface SplitUserMessagesResult {
  older: string[];
  recent: string[];
}

const DEFAULT_RECENT_TOKEN_BUDGET = 20_000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function splitUserMessagesForCompact(
  lines: readonly ActivityContextLine[],
  options: { recentTokenBudget?: number } = {},
): SplitUserMessagesResult {
  const budget = options.recentTokenBudget ?? DEFAULT_RECENT_TOKEN_BUDGET;
  const userMessages = lines
    .filter((line) => line.role === "user")
    .map((line) => line.message.trim())
    .filter(Boolean);

  if (userMessages.length === 0) {
    return { older: [], recent: [] };
  }

  const recent: string[] = [];
  let usedTokens = 0;

  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    const message = userMessages[index]!;
    const messageTokens = estimateTokens(message);
    if (recent.length > 0 && usedTokens + messageTokens > budget) {
      break;
    }
    recent.unshift(message);
    usedTokens += messageTokens;
  }

  const older = userMessages.slice(0, userMessages.length - recent.length);
  return { older, recent };
}

export function buildCompactionSummaryPrompt(threadPrompt: string, olderContext: readonly string[]): string {
  const olderText =
    olderContext.length > 0
      ? olderContext.map((message, index) => `${index + 1}. ${message}`).join("\n\n")
      : "（无更早的用户消息）";

  return [
    "请将以下编码对话中较早的用户消息压缩为一份简洁摘要，供后续续聊使用。",
    "必须保留：任务目标与验收标准、已读/已改文件路径、测试结果与错误信息、已做决策及理由。",
    "使用与用户消息相同的语言。只输出摘要正文，不要 markdown 标题、不要 JSON、不要解释压缩过程。",
    "",
    "## 原始任务",
    threadPrompt.trim() || "（无）",
    "",
    "## 较早的用户消息",
    olderText,
  ].join("\n");
}

export function buildEcoCompactHandoffPrompt(
  threadPrompt: string,
  followUp: string,
  handoff: Pick<ThreadCompactHandoffData, "summary" | "recentUserMessages">,
): string {
  const recentSection =
    handoff.recentUserMessages.length > 0
      ? handoff.recentUserMessages.map((message, index) => `${index + 1}. ${message}`).join("\n\n")
      : "（无保留的近期用户消息）";

  return [
    threadPrompt.trim(),
    "",
    "---",
    "## 对话摘要（自动压缩）",
    handoff.summary.trim() || "（无摘要）",
    "",
    "## 近期用户消息（原文保留）",
    recentSection,
    "",
    "---",
    "后续消息：",
    followUp.trim(),
  ].join("\n");
}

export function estimateHandoffPostTokens(
  threadPrompt: string,
  handoff: Pick<ThreadCompactHandoffData, "summary" | "recentUserMessages">,
): number {
  return estimateTokens(
    buildEcoCompactHandoffPrompt(threadPrompt, "", {
      summary: handoff.summary,
      recentUserMessages: handoff.recentUserMessages,
    }),
  );
}
