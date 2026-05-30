import type { ThreadStatus } from "./ipc";
import { stripSubagentBracketPrefix } from "./activity-display";

export interface ActivityContextLine {
  role: string;
  message: string;
}

/** Thread statuses where the user may send another message on the same thread. */
export const CONTINUABLE_THREAD_STATUSES = ["idle", "completed", "failed", "blocked"] as const;

export type ContinuableThreadStatus = (typeof CONTINUABLE_THREAD_STATUSES)[number];

export function isContinuableThreadStatus(status: ThreadStatus): status is ContinuableThreadStatus {
  return (CONTINUABLE_THREAD_STATUSES as readonly string[]).includes(status);
}

/** Agent turn prompt: keep the original task and add the latest user message. */
export function buildThreadTurnPrompt(threadPrompt: string, followUp: string): string {
  const original = threadPrompt.trim();
  const next = followUp.trim();
  if (!original) {
    return next;
  }
  if (!next || original === next) {
    return original;
  }
  return `${original}\n\n---\n\n后续消息：\n${next}`;
}

export function shouldUseInterruptedWorktree(worktreeExists: boolean, hasPriorActivity: boolean): boolean {
  return worktreeExists && hasPriorActivity;
}

const ACTIVITY_NOISE =
  /^(?:Tool:|Running tool:|Requesting model|Compacting context|API retry |Usage recorded|Run finished|Agent session started|Claude Agent SDK ready|状态已更新|已从异常退出恢复|【\d+\/\d+】)/i;

export function isActivityNoiseMessage(message: string): boolean {
  const text = stripSubagentBracketPrefix(message.trim());
  return !text || ACTIVITY_NOISE.test(text);
}

/** Usage/cost lines that must never appear in the activity body. */
export function isUsageNoiseMessage(message: string): boolean {
  const text = stripSubagentBracketPrefix(message.trim());
  return /^(?:Usage recorded|Run finished)/i.test(text);
}

/** Compress stored activity into narrative context for the next agent turn. */
export function buildActivityContextForPrompt(
  lines: readonly ActivityContextLine[],
  options?: { maxChars?: number; maxLines?: number },
): string {
  const maxChars = options?.maxChars ?? 12_000;
  const maxLines = options?.maxLines ?? 48;
  const entries: string[] = [];

  for (const line of lines) {
    if (line.role === "tool" || line.role === "thinking" || line.role === "system") {
      continue;
    }
    let text = stripSubagentBracketPrefix(line.message.trim());
    if (!text || ACTIVITY_NOISE.test(text)) {
      continue;
    }
    if (text.length > 600) {
      text = `${text.slice(0, 597)}…`;
    }
    const roleLabel =
      line.role === "user"
        ? "用户"
        : line.role === "planner"
          ? "规划"
          : line.role === "explore"
            ? "探索"
            : line.role === "architect"
              ? "架构"
              : line.role === "coder"
                ? "编码"
                : line.role === "reviewer"
                  ? "审查"
                  : line.role === "tester"
                    ? "测试"
                    : line.role;
    entries.push(`[${roleLabel}] ${text}`);
  }

  if (entries.length === 0) {
    return "";
  }

  let body = entries.slice(-maxLines).join("\n");
  if (body.length > maxChars) {
    body = `…（更早记录已省略）\n${body.slice(-maxChars)}`;
  }
  return body;
}

/** Task + optional transcript + latest user message for any agent mode. */
export function buildAgentPromptWithContext(
  threadPrompt: string,
  followUp: string,
  activityLines: readonly ActivityContextLine[],
): string {
  const turn = buildThreadTurnPrompt(threadPrompt, followUp);
  const history = buildActivityContextForPrompt(activityLines);
  if (!history) {
    return turn;
  }
  return `${turn}\n\n---\n\n## 对话记录（供续聊参考）\n${history}`;
}

/** UI: show planner session context, not max across all subagents. */
export function pickDisplayContextTokens(
  usageByRole: Record<string, { contextTokens: number }>,
): number {
  const planner = usageByRole.planner?.contextTokens ?? 0;
  if (planner > 0) {
    return planner;
  }
  return Object.values(usageByRole).reduce((max, usage) => Math.max(max, usage.contextTokens), 0);
}
