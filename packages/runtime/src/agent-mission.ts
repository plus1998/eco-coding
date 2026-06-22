import { isSubagentRole, type SubagentRole } from "./subagent-availability.js";
import { normalizeSdkSubagentType } from "./subagent-resume.js";

export interface SubagentMissionPayload {
  role: string;
  summary: string;
  prompt: string;
}

const MISSION_PREFIX = "@mission ";

const ROLE_DEFAULT_SUMMARY: Record<SubagentRole, string> = {
  explore: "只读探索代码库以收集上下文",
  architect: "根据计划梳理架构与实现方案",
  coder: "实现计划中的开发任务",
  reviewer: "审查本轮代码变更是否符合计划",
  tester: "验证实现与测试用例",
};

const GENERIC_MISSION_SUMMARIES = new Set<string>(Object.values(ROLE_DEFAULT_SUMMARY));

export function isGenericMissionSummary(summary: string): boolean {
  return GENERIC_MISSION_SUMMARIES.has(summary.trim());
}

/** Agent tool detail that only names the subagent role, without a real task prompt. */
export function isWeakAgentToolDetail(detail: string | undefined): boolean {
  const trimmed = detail?.trim();
  if (!trimmed || isToolElapsedDuration(trimmed)) {
    return true;
  }
  if (parseSubagentMissionMessage(trimmed)) {
    return false;
  }
  if (missionFromAgentToolDetail(trimmed) && !/[\n.!?。！？]/.test(trimmed) && trimmed.length <= 48) {
    return true;
  }
  return false;
}

export function summarizeAgentObjective(role: string, prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return isSubagentRole(role) ? ROLE_DEFAULT_SUMMARY[role] : `执行 ${role} 任务`;
  }

  const files = extractMentionedPaths(trimmed);
  const firstLine = firstMeaningfulLine(trimmed);

  if (role === "reviewer") {
    const reviewFocus = extractSection(trimmed, [
      /review(?:er)?\s*(?:focus|scope|goal)?\s*[:：]\s*([^\n]+)/i,
      /审查(?:范围|重点|目标)?\s*[:：]\s*([^\n]+)/i,
      /changes?\s+to\s+review\s*[:：]\s*([^\n]+)/i,
      /files?\s+changed\s*[:：]\s*([^\n]+)/i,
      /变更(?:文件|列表)?\s*[:：]\s*([^\n]+)/i,
    ]);
    if (reviewFocus) {
      return clampSummary(`审查：${reviewFocus}`);
    }
    if (files.length > 0) {
      return clampSummary(`审查变更：${files.slice(0, 3).join(", ")}${files.length > 3 ? " 等" : ""}`);
    }
    if (/plan|计划|approved/i.test(trimmed)) {
      return clampSummary("对照已批准计划审查代码变更");
    }
  }

  if (role === "coder") {
    const task = extractSection(trimmed, [
      /task\s*[:：]\s*([^\n]+)/i,
      /(?:coder\s*)?task\s*[:：]\s*([^\n]+)/i,
      /实现(?:任务)?\s*[:：]\s*([^\n]+)/i,
      /goal\s*[:：]\s*([^\n]+)/i,
    ]);
    if (task) {
      return clampSummary(`实现：${task}`);
    }
    if (files.length > 0) {
      return clampSummary(`修改：${files.slice(0, 3).join(", ")}`);
    }
  }

  if (role === "architect") {
    if (/plan|计划/i.test(trimmed)) {
      return clampSummary("制定或细化实现计划");
    }
  }

  if (role === "tester") {
    if (files.length > 0) {
      return clampSummary(`测试：${files.slice(0, 3).join(", ")}`);
    }
    return clampSummary("运行测试并汇报结果");
  }

  if (firstLine) {
    return clampSummary(firstLine);
  }

  return isSubagentRole(role) ? ROLE_DEFAULT_SUMMARY[role] : clampSummary(trimmed);
}

export function formatSubagentMissionMessage(role: string, prompt: string): string {
  const payload: SubagentMissionPayload = {
    role,
    summary: summarizeAgentObjective(role, prompt),
    prompt: prompt.trim().slice(0, 12_000),
  };
  return `${MISSION_PREFIX}${JSON.stringify(payload)}`;
}

export function parseSubagentMissionMessage(message: string): SubagentMissionPayload | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith(MISSION_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(MISSION_PREFIX.length)) as SubagentMissionPayload;
    if (typeof parsed.role !== "string" || typeof parsed.summary !== "string") {
      return null;
    }
    return {
      role: normalizeMissionRole(parsed.role),
      summary: parsed.summary.trim(),
      prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim() : "",
    };
  } catch {
    return null;
  }
}

/** Human-readable mission body; unwraps @mission JSON payloads when present. */
export function resolveMissionDisplayText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = parseSubagentMissionMessage(trimmed);
  if (parsed) {
    return parsed.prompt.trim() || parsed.summary.trim();
  }
  return trimmed;
}

const CHINESE_ROLE_TO_ID: Record<string, string> = {
  探索: "explore",
  架构: "architect",
  编码: "coder",
  审查: "reviewer",
  测试: "tester",
};

function normalizeMissionRole(role: string): string {
  const trimmed = role.trim();
  const fromChinese = CHINESE_ROLE_TO_ID[trimmed];
  if (fromChinese) {
    return fromChinese;
  }
  return normalizeSdkSubagentType(trimmed) ?? trimmed;
}

/** Matches tool progress elapsed suffixes like `(32.5s)` or bare `32.5s`. */
export function isToolElapsedDuration(value: string): boolean {
  const trimmed = value.trim();
  return /^\(\d+(?:\.\d+)?s\)$/.test(trimmed) || /^\d+(?:\.\d+)?s$/.test(trimmed);
}

export function missionFromAgentToolDetail(
  detail: string | undefined,
): { role: string; summary: string } | null {
  if (!detail?.trim() || isToolElapsedDuration(detail)) {
    return null;
  }
  const legacyRole = detail.match(/\(([^)]+)\)\s*(?:·\s*(.+))?$/);
  if (legacyRole?.[1]) {
    const role = normalizeMissionRole(legacyRole[1]);
    if (isToolElapsedDuration(role)) {
      return null;
    }
    const rest = legacyRole[2]?.trim();
    return {
      role,
      summary: rest ? clampSummary(rest) : summarizeAgentObjective(role, ""),
    };
  }
  const chinese = detail.match(/^(探索|架构|编码|审查|测试)(?:\s*·\s*(.+))?$/);
  if (chinese?.[1]) {
    const role = CHINESE_ROLE_TO_ID[chinese[1]] ?? chinese[1];
    const rest = chinese[2]?.trim();
    return {
      role,
      summary: rest ? clampSummary(rest) : summarizeAgentObjective(role, ""),
    };
  }
  return null;
}

function firstMeaningfulLine(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^#+\s/.test(trimmed)) {
      return trimmed.replace(/^#+\s*/, "");
    }
    if (/^[-*]\s/.test(trimmed)) {
      return trimmed.replace(/^[-*]\s*/, "");
    }
    return trimmed;
  }
  return undefined;
}

function extractSection(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function extractMentionedPaths(text: string): string[] {
  const paths = new Set<string>();
  const pattern =
    /(?:^|[\s"'`([{])([\w./-]+\.(?:ts|tsx|js|jsx|vue|py|rs|go|java|md|json|css|scss|sql))(?:$|[\s"'`)\]}.,;:!?])/gm;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    const path = match[1]?.replace(/^\.\//, "");
    if (path && path.length <= 120) {
      paths.add(path);
    }
    match = pattern.exec(text);
  }
  return [...paths];
}

function clampSummary(text: string, max = 140): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, max - 1)}…`;
}
