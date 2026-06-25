import { computeOccupancyRatio } from "./models-dev-limits.js";
import {
  buildStructuredCompactFallback,
  formatStructuredCompactSections,
  structuredCompactInstructionSuffix,
} from "./structured-compact-summary.js";

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
    structuredCompactInstructionSuffix("subagent"),
  `角色：${role}`,
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
    return formatStructuredCompactSections({
      任务目标: originalPrompt.trim() || "无",
    });
  }
  return buildStructuredCompactFallback({
    taskGoal: originalPrompt.trim() || undefined,
    olderMessages,
  });
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
    "### 工作摘要（结构化）",
    handoff.summary.trim() || "（无摘要）",
    "",
    "### 近期输出（原文保留）",
    recentSection,
    "",
    "---",
    "请基于以上状态继续任务，避免重复已完成工作。",
  ].join("\n");
}
