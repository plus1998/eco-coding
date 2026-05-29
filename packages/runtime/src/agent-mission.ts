export interface SubagentMissionPayload {
  role: string;
  summary: string;
  prompt: string;
}

const MISSION_PREFIX = "@mission ";

const SUBAGENT_ROLES = ["architect", "coder", "reviewer", "tester"] as const;
type SubagentRole = (typeof SUBAGENT_ROLES)[number];

function isSubagentRole(role: string): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

const ROLE_DEFAULT_SUMMARY: Record<SubagentRole, string> = {
  architect: "根据计划梳理架构与实现方案",
  coder: "实现计划中的开发任务",
  reviewer: "审查本轮代码变更是否符合计划",
  tester: "验证实现与测试用例",
};

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
      role: parsed.role,
      summary: parsed.summary.trim(),
      prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim() : "",
    };
  } catch {
    return null;
  }
}

const CHINESE_ROLE_TO_ID: Record<string, string> = {
  架构: "architect",
  编码: "coder",
  审查: "reviewer",
  测试: "tester",
};

export function missionFromAgentToolDetail(
  detail: string | undefined,
): { role: string; summary: string } | null {
  if (!detail?.trim()) {
    return null;
  }
  const legacyRole = detail.match(/\(([^)]+)\)\s*(?:·\s*(.+))?$/);
  if (legacyRole?.[1]) {
    const role = legacyRole[1].trim();
    const rest = legacyRole[2]?.trim();
    return {
      role,
      summary: rest ? clampSummary(rest) : summarizeAgentObjective(role, ""),
    };
  }
  const chinese = detail.match(/^(架构|编码|审查|测试)(?:\s*·\s*(.+))?$/);
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
