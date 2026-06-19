import { computeOccupancyRatio } from "./models-dev-limits.js";

export const DEFAULT_SUBAGENT_HANDOFF_THRESHOLD = 0.85;

export const DEFAULT_SUBAGENT_HANDOFF_RECENT_TOKEN_BUDGET = 12_000;

export interface SubagentHandoffActivityLine {
  message: string;
}

export interface SplitSubagentActivityResult {
  older: string[];
  recent: string[];
}

export interface SubagentHandoffContent {
  summary: string;
  recentMessages: string[];
  previousAgentId?: string;
}

export function estimateHandoffTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function shouldHandoffSubagentResume(
  occupied: number,
  compactLimit: number,
  threshold = DEFAULT_SUBAGENT_HANDOFF_THRESHOLD,
): boolean {
  if (occupied <= 0 || compactLimit <= 0) {
    return false;
  }
  return computeOccupancyRatio(occupied, compactLimit, threshold).atThreshold;
}

export function splitSubagentActivityForHandoff(
  lines: readonly SubagentHandoffActivityLine[],
  options: { recentTokenBudget?: number } = {},
): SplitSubagentActivityResult {
  const budget = options.recentTokenBudget ?? DEFAULT_SUBAGENT_HANDOFF_RECENT_TOKEN_BUDGET;
  const messages = lines
    .map((line) => line.message.trim())
    .filter(Boolean);

  if (messages.length === 0) {
    return { older: [], recent: [] };
  }

  const recent: string[] = [];
  let usedTokens = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const messageTokens = estimateHandoffTokens(message);
    if (recent.length > 0 && usedTokens + messageTokens > budget) {
      break;
    }
    recent.unshift(message);
    usedTokens += messageTokens;
  }

  const older = messages.slice(0, messages.length - recent.length);
  return { older, recent };
}

export function buildSubagentCompactionSummaryPrompt(
  originalPrompt: string,
  role: string,
  olderMessages: readonly string[],
): string {
  const olderText =
    olderMessages.length > 0
      ? olderMessages.map((message, index) => `${index + 1}. ${message}`).join("\n\n")
      : "（无更早输出）";

  return [
    `请将以下 ${role} 子代理会话中较早的输出压缩为一份简洁摘要，供新的子代理实例继续任务。`,
    "必须保留：已读/已查文件路径、关键发现、测试/命令结果、已做决策及理由、未完成事项。",
    "使用与原任务相同的语言。只输出摘要正文，不要 markdown 标题、不要 JSON、不要解释压缩过程。",
    "",
    "## 原始任务",
    originalPrompt.trim() || "（无）",
    "",
    "## 较早的子代理输出",
    olderText,
  ].join("\n");
}

export function buildFallbackSubagentHandoffSummary(
  originalPrompt: string,
  olderMessages: readonly string[],
): string {
  if (olderMessages.length === 0) {
    return originalPrompt.trim() || "（无可用摘要）";
  }
  const bullets = olderMessages.slice(-8).map((message) => {
    const compact = message.replace(/\s+/g, " ").trim();
    const limit = 400;
    return compact.length > limit ? `${compact.slice(0, limit)}…` : compact;
  });
  return bullets.map((line, index) => `${index + 1}. ${line}`).join("\n");
}

export function buildSubagentHandoffPrompt(
  originalPrompt: string,
  role: string,
  handoff: SubagentHandoffContent,
): string {
  const recentSection =
    handoff.recentMessages.length > 0
      ? handoff.recentMessages.map((message, index) => `${index + 1}. ${message}`).join("\n\n")
      : "（无保留的近期输出）";

  const resumeNote = handoff.previousAgentId
    ? `上一 ${role} 子代理（${handoff.previousAgentId}）`
    : `上一 ${role} 子代理`;

  return [
    originalPrompt.trim(),
    "",
    "---",
    "## 子代理上下文交接（Eco）",
    `${resumeNote} 已接近上下文上限，因此未 Resume 完整历史，改为全新实例继续。`,
    "",
    "### 工作摘要",
    handoff.summary.trim() || "（无摘要）",
    "",
    "### 近期输出（原文保留）",
    recentSection,
    "",
    "---",
    "请基于以上状态继续任务，避免重复已完成工作。",
  ].join("\n");
}
