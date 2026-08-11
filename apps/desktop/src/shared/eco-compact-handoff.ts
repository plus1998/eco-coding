import {
  CODEX_COMPACT_SUMMARY_PREFIX,
  CODEX_COMPACT_SYSTEM_PROMPT,
  truncateMiddleWithTokenBudget,
} from "@eco/runtime";
import type { ActivityContextLine } from "./thread-continuation";
import { estimateTextTokens } from "./token-estimate";

export { CODEX_COMPACT_SUMMARY_PREFIX, CODEX_COMPACT_SYSTEM_PROMPT };

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

/** Codex-aligned default: keep ~20k tokens of recent real user messages verbatim. */
export const DEFAULT_RECENT_TOKEN_BUDGET = 20_000;

const TOOL_RESULT_PREFIX = "[工具结果";
const COMPACT_RECENT_HEADING = "## 近期用户消息（原文保留）";
const LEGACY_COMPACT_SUMMARY_HEADING = "## 对话摘要（结构化压缩）";
const LEGACY_COMPACT_RECENT_HEADING = "## 近期对话（原文保留）";
const COMPACT_FOLLOW_UP_MARKER = "后续消息：";

export function estimateTokens(text: string): number {
  return estimateTextTokens(text);
}

/**
 * Codex-style split: recent = newest-first real user messages up to token budget
 * (boundary message may be middle-truncated within remaining budget); older =
 * everything else needed for summarization (assistant/tool + users outside the
 * keep window, and the full text of a truncated boundary user message).
 */
export function splitMessagesForCompact(
  lines: readonly (ActivityContextLine & { id?: string })[],
  options: { recentTokenBudget?: number } = {},
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
  if (budget === 0) {
    return { older: messages, recent: [] };
  }

  type KeptUser = {
    index: number;
    message: CompactConversationMessage;
    /** When true, the full original message at this index must also go into older. */
    truncated: boolean;
  };

  const kept: KeptUser[] = [];
  let remaining = budget;

  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const original = messages[index];
    if (!original || !isRealUserMessage(original)) {
      continue;
    }
    const tokens = estimateCompactMessageTokens(original);
    if (tokens <= remaining) {
      kept.unshift({ index, message: { ...original }, truncated: false });
      remaining -= tokens;
      continue;
    }
    // Boundary truncation: Codex middle-truncate within remaining body budget.
    // Codex keeps the truncated boundary even if heuristic overhead slightly exceeds the slot.
    const bodyBudget = Math.max(1, remaining);
    const truncatedBody = truncateMiddleWithTokenBudget(original.message, bodyBudget).text;
    if (!truncatedBody.trim()) {
      break;
    }
    kept.unshift({
      index,
      message: {
        ...original,
        message: truncatedBody,
      },
      truncated: true,
    });
    remaining = 0;
    break;
  }

  // Fully kept user messages stay only in recent; truncated boundary originals stay in older;
  // assistant/tool and non-kept users always go to older for summarization.
  const fullKeepIndices = new Set(
    kept.filter((entry) => !entry.truncated).map((entry) => entry.index),
  );
  const older: CompactConversationMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (fullKeepIndices.has(index)) {
      continue;
    }
    older.push({ ...message });
  }

  const recent = kept.map((entry) => entry.message);
  return { older, recent };
}

export function buildCompactionSummaryPrompt(
  threadPrompt: string,
  olderContext: readonly CompactConversationMessage[],
  options: {
    previousHandoff?: CompactPromptPreviousHandoff;
  } = {},
): string {
  const olderText = formatCompactMessages(olderContext, "(no additional older context)");
  const previous = options.previousHandoff;
  const previousContext = previous
    ? [
        `## Previous compaction handoff (generation ${previous.generation ?? "unknown"})`,
        previous.summary.trim(),
        "",
        "### Previous kept recent user messages",
        formatCompactMessages(previous.recentMessages, "(none)"),
      ].join("\n")
    : "## Previous compaction handoff\n(none — first compaction)";

  // Payload only — instructions live in CODEX_COMPACT_SYSTEM_PROMPT on the request system field.
  return [
    "## Original task",
    threadPrompt.trim() || "(none)",
    "",
    previousContext,
    "",
    "## Conversation to compact",
    olderText,
  ].join("\n");
}

export function buildEcoCompactHandoffPrompt(
  threadPrompt: string,
  followUp: string,
  handoff: Pick<ThreadCompactHandoffData, "summary" | "recentMessages">,
): string {
  const recentSection = formatCompactMessages(handoff.recentMessages, "(no recent user messages kept)");

  return [
    threadPrompt.trim(),
    "",
    CODEX_COMPACT_SUMMARY_PREFIX,
    "",
    handoff.summary.trim(),
    "",
    COMPACT_RECENT_HEADING,
    recentSection,
    "",
    COMPACT_FOLLOW_UP_MARKER,
    followUp.trim(),
  ].join("\n");
}

/** Remove the previously injected handoff envelope while retaining only its new follow-up. */
export function stripInjectedCompactHandoffMessage(message: string): string {
  const hasRecentHeading =
    message.includes(COMPACT_RECENT_HEADING) || message.includes(LEGACY_COMPACT_RECENT_HEADING);
  const hasHandoffMarker =
    message.includes(CODEX_COMPACT_SUMMARY_PREFIX) ||
    message.includes(LEGACY_COMPACT_SUMMARY_HEADING) ||
    hasRecentHeading;
  if (!hasHandoffMarker || !hasRecentHeading) {
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
