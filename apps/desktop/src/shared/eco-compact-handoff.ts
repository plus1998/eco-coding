import { structuredCompactInstructionSuffix } from "@eco/runtime/structured-compact-summary";
import type { ActivityContextLine } from "./thread-continuation";
import { estimateTextTokens } from "./token-estimate";

export interface CompactConversationMessage {
  id?: string;
  role: string;
  message: string;
}

export interface ThreadCompactHandoffData {
  summary: string;
  recentMessages: CompactConversationMessage[];
  postTokensEstimate: number;
  summaryId?: string;
  schemaVersion?: number;
  generation?: number;
}

export interface SplitCompactMessagesResult {
  older: CompactConversationMessage[];
  recent: CompactConversationMessage[];
}

export interface CompactPromptPreviousHandoff {
  summary: string;
  recentMessages: readonly CompactConversationMessage[];
  generation?: number;
}

const DEFAULT_RECENT_TOKEN_BUDGET = 8_000;
const DEFAULT_RECENT_TURNS = 2;
const TOOL_RESULT_PREFIX = "[工具结果";
const COMPACT_SUMMARY_HEADING = "## 对话摘要（结构化压缩）";
const COMPACT_RECENT_HEADING = "## 近期对话（原文保留）";
const COMPACT_FOLLOW_UP_MARKER = "后续消息：";

export function estimateTokens(text: string): number {
  return estimateTextTokens(text);
}

export function splitMessagesForCompact(
  lines: readonly (ActivityContextLine & { id?: string })[],
  options: { recentTokenBudget?: number; recentTurns?: number } = {},
): SplitCompactMessagesResult {
  const messages = lines
    .map((line) => ({
      ...(line.id?.trim() ? { id: line.id.trim() } : {}),
      role: line.role.trim(),
      message: line.message.trim(),
    }))
    .filter((line) => line.role && line.message);
  if (messages.length === 0) {
    return { older: [], recent: [] };
  }

  const budget = Math.max(0, options.recentTokenBudget ?? DEFAULT_RECENT_TOKEN_BUDGET);
  const recentTurns = Math.max(0, Math.trunc(options.recentTurns ?? DEFAULT_RECENT_TURNS));
  if (budget === 0 || recentTurns === 0) {
    return { older: messages, recent: [] };
  }

  const turnStarts = messages.flatMap((message, index) => (isRealUserMessage(message) ? [index] : []));
  let recentStart = turnStarts[Math.max(0, turnStarts.length - recentTurns)] ?? 0;

  while (recentStart < messages.length) {
    const usedTokens = messages
      .slice(recentStart)
      .reduce((total, message) => total + estimateCompactMessageTokens(message), 0);
    if (usedTokens <= budget) {
      break;
    }
    const nextTurnStart = turnStarts.find((start) => start > recentStart);
    recentStart = nextTurnStart ?? messages.length;
  }

  return {
    older: messages.slice(0, recentStart),
    recent: messages.slice(recentStart),
  };
}

/** Split history at message boundaries so every chunk fits the summary-model input budget. */
export function chunkMessagesForCompact(
  messages: readonly CompactConversationMessage[],
  maxTokens: number,
): CompactConversationMessage[][] {
  const budget = Math.max(1, Math.trunc(maxTokens));
  const chunks: CompactConversationMessage[][] = [];
  let current: CompactConversationMessage[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
  };

  for (const message of messages) {
    const tokens = estimateCompactMessageTokens(message);
    if (current.length > 0 && currentTokens + tokens > budget) {
      flush();
    }
    if (tokens <= budget) {
      current.push({ ...message });
      currentTokens += tokens;
      continue;
    }

    // Preserve the message boundary but split its text explicitly. No content is silently dropped.
    const pieces = splitTextToTokenBudget(message.message, budget);
    for (const piece of pieces) {
      flush();
      chunks.push([{ ...message, message: piece }]);
    }
  }
  flush();
  return chunks;
}

export function buildCompactionSummaryPrompt(
  threadPrompt: string,
  olderContext: readonly CompactConversationMessage[],
  options: {
    previousHandoff?: CompactPromptPreviousHandoff;
    chunkIndex?: number;
    chunkCount?: number;
  } = {},
): string {
  const olderText = formatCompactMessages(olderContext, "（无本轮新增较早对话）");
  const previous = options.previousHandoff;
  const previousContext = previous
    ? [
        `## 上一代压缩交接（generation ${previous.generation ?? "未知"}）`,
        previous.summary.trim(),
        "",
        "### 上一代保留的近期原文",
        formatCompactMessages(previous.recentMessages, "（无）"),
      ].join("\n")
    : "## 上一代压缩交接\n（无，这是第一次压缩）";
  const chunkLabel =
    options.chunkIndex !== undefined && options.chunkCount !== undefined
      ? `这是分块摘要的第 ${options.chunkIndex + 1}/${options.chunkCount} 块。只总结本块新增事实，并保留与上一代交接仍相关的事实。`
      : "这是单块摘要。";

  return [
    "你正在执行 CONTEXT CHECKPOINT COMPACTION。",
    "下一编码代理看不到被压缩的原始历史，只能依赖最终摘要、保留的近期完整对话和当前工作区继续任务。",
    structuredCompactInstructionSuffix("thread"),
    "必须保留具体文件路径、命令、退出状态、错误文本、测试结果、用户偏好、禁止事项、关键约束和未完成步骤。",
    "不得把推测写成事实，不得声称未执行的测试已经通过，不得假设输入中未提供的历史工具状态仍然存在。",
    "如果上一代摘要与本轮新增历史冲突，以本轮明确的新事实为准，并在摘要中反映状态变化。",
    chunkLabel,
    "",
    "## 原始任务",
    threadPrompt.trim() || "（无）",
    "",
    previousContext,
    "",
    "## 本轮待压缩对话",
    olderText,
  ].join("\n");
}

export function buildCompactionMergePrompt(
  threadPrompt: string,
  partialSummaries: readonly string[],
): string {
  return [
    "你正在合并多个 CONTEXT CHECKPOINT COMPACTION 分块摘要。",
    structuredCompactInstructionSuffix("thread"),
    "必须合并重复事实、保留精确文件路径/命令/错误，并让较新的明确事实覆盖较旧状态。",
    "不得遗漏任一分块中的未完成事项；不得把分块未声称的事情写成已完成。",
    "只输出最终五段结构化摘要正文。",
    "",
    "## 原始任务",
    threadPrompt.trim() || "（无）",
    "",
    "## 分块摘要",
    partialSummaries.map((summary, index) => `### 分块 ${index + 1}\n${summary.trim()}`).join("\n\n"),
  ].join("\n");
}

export function buildEcoCompactHandoffPrompt(
  threadPrompt: string,
  followUp: string,
  handoff: Pick<ThreadCompactHandoffData, "summary" | "recentMessages">,
): string {
  const recentSection = formatCompactMessages(handoff.recentMessages, "（无保留的近期对话）");

  return [
    threadPrompt.trim(),
    "",
    "---",
    COMPACT_SUMMARY_HEADING,
    "这是前一个编码代理留下的压缩交接。不要重复已经明确完成的工作；未明确记录的历史工具状态不可假设仍然存在。",
    handoff.summary.trim(),
    "",
    COMPACT_RECENT_HEADING,
    recentSection,
    "",
    "---",
    COMPACT_FOLLOW_UP_MARKER,
    followUp.trim(),
  ].join("\n");
}

/** Remove the previously injected handoff envelope while retaining only its new follow-up. */
export function stripInjectedCompactHandoffMessage(message: string): string {
  if (!message.includes(COMPACT_SUMMARY_HEADING) || !message.includes(COMPACT_RECENT_HEADING)) {
    return message.trim();
  }
  const markerIndex = message.lastIndexOf(COMPACT_FOLLOW_UP_MARKER);
  if (markerIndex < 0) {
    return "";
  }
  return message.slice(markerIndex + COMPACT_FOLLOW_UP_MARKER.length).trim();
}

export function estimateHandoffPostTokens(
  threadPrompt: string,
  handoff: Pick<ThreadCompactHandoffData, "summary" | "recentMessages">,
  options: { safetyTokens?: number } = {},
): number {
  return (
    estimateTokens(
      buildEcoCompactHandoffPrompt(threadPrompt, "", {
        summary: handoff.summary,
        recentMessages: handoff.recentMessages,
      }),
    ) + Math.max(0, Math.trunc(options.safetyTokens ?? 0))
  );
}

export function estimateCompactMessageTokens(message: CompactConversationMessage): number {
  return estimateTokens(`[${roleLabel(message.role)}]\n${message.message}`);
}

function formatCompactMessages(messages: readonly CompactConversationMessage[], emptyText: string): string {
  return messages.length > 0
    ? messages
        .map((entry, index) => `${index + 1}. [${roleLabel(entry.role)}]\n${entry.message}`)
        .join("\n\n")
    : emptyText;
}

function splitTextToTokenBudget(text: string, maxTokens: number): string[] {
  const pieces: string[] = [];
  let current = "";
  let currentTokens = 0;
  for (const char of text) {
    const tokens = estimateTokens(char);
    if (current && currentTokens + tokens > maxTokens) {
      pieces.push(current);
      current = "";
      currentTokens = 0;
    }
    current += char;
    currentTokens += tokens;
  }
  if (current) {
    pieces.push(current);
  }
  return pieces.length > 0 ? pieces : [text];
}

function isRealUserMessage(message: CompactConversationMessage): boolean {
  return message.role === "user" && !message.message.startsWith(TOOL_RESULT_PREFIX);
}

function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "用户";
    case "assistant":
    case "planner":
      return "助手";
    default:
      return role || "未知";
  }
}
