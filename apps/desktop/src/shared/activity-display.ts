/** Normalize activity line text for display (strip redundant subagent prefixes). */

import { parseSubagentMissionMessage } from "@eco/runtime";

const SUBAGENT_BRACKET_PREFIX = /^【[^】]+】\s*/;

const reconnectClearSystemNoise = [
  /^Local model router ready:/i,
  /^Claude Agent SDK ready/i,
  /^Agent session started/i,
  /^Agent run completed/i,
  /^Compacting context/i,
  /^API retry /i,
  /^Usage recorded/i,
  /^Run finished/i,
  /^已从异常退出恢复/i,
];

/** Auto-retry or upstream connection failure status — should replace prior line, not stack. */
export function isReconnectActivityMessage(message: string): boolean {
  const trimmed = message.trim();
  return /^【(?:自动重试|连接失败)/.test(trimmed);
}

/** True when a new activity line means the upstream connection resumed — drop reconnect status. */
export function shouldClearReconnectActivity(line: { message: string; role: string }): boolean {
  if (isReconnectActivityMessage(line.message)) {
    return false;
  }

  const trimmed = stripSubagentBracketPrefix(line.message.trim());
  if (!trimmed || trimmed === "状态已更新" || /^状态已更新\s/u.test(trimmed)) {
    return false;
  }
  if (reconnectClearSystemNoise.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  if (parseSubagentMissionMessage(trimmed)) {
    return true;
  }
  if (/^Requesting model/i.test(trimmed)) {
    return true;
  }
  if (/^正在刷新上下文用量/.test(trimmed)) {
    return false;
  }
  if (/^Tool(?: failed)?:/i.test(trimmed)) {
    return true;
  }
  if (/^【\d+\/\d+】/.test(trimmed)) {
    return true;
  }
  if (/^(Reading|Writing|Editing|Searching|Running)\s+/i.test(trimmed)) {
    return true;
  }
  if (line.role === "thinking") {
    return true;
  }
  if (["planner", "explore", "architect", "coder", "reviewer", "tester"].includes(line.role)) {
    return true;
  }

  return false;
}

const PROGRESS_PATTERNS: Array<{ pattern: RegExp; verb: string }> = [
  { pattern: /^Reading\s+(.+?)(?:\s*·\s*Read)?\s*$/i, verb: "读取" },
  { pattern: /^Writing\s+(.+?)(?:\s*·\s*Write)?\s*$/i, verb: "写入" },
  { pattern: /^Editing\s+(.+?)(?:\s*·\s*Edit)?\s*$/i, verb: "编辑" },
  { pattern: /^Searching\s+(.+?)(?:\s*·\s*Grep)?\s*$/i, verb: "搜索" },
  { pattern: /^Running\s+(.+?)(?:\s*·\s*Bash)?\s*$/i, verb: "运行命令" },
];

export function stripSubagentBracketPrefix(text: string): string {
  return text.replace(SUBAGENT_BRACKET_PREFIX, "").trim();
}

export function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

const TOOL_LINE_PATTERN =
  /^Tool:\s*([A-Za-z0-9_]+)(?:\s*·\s*(.+?)|\s+(\(\d+(?:\.\d+)?s\)))?\s*$/;

const MCP_TOOL_LINE_PATTERN = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/;

const MCP_TOOL_DISPLAY_LABELS: Record<string, string> = {
  mcp__eco_plan__finalize_plan: "提交计划",
};

export function isMcpToolName(tool: string): boolean {
  return tool.startsWith("mcp__") || tool === "mcp_tool";
}

export function formatMcpToolDisplayName(tool: string): string {
  const known = MCP_TOOL_DISPLAY_LABELS[tool];
  if (known) {
    return known;
  }
  const match = tool.match(MCP_TOOL_LINE_PATTERN);
  if (match?.[1] && match[2]) {
    const server = match[1].replace(/_/g, " ");
    const toolName = match[2].replace(/_/g, " ");
    return `${server} · ${toolName}`;
  }
  if (tool === "mcp_tool") {
    return "MCP 工具";
  }
  return tool.replace(/^mcp__/, "").replace(/__/g, " · ").replace(/_/g, " ");
}

export function normalizeActivityActionLabel(raw: string): string {
  let text = stripSubagentBracketPrefix(raw.trim());
  if (!text) {
    return raw.trim();
  }

  for (const { pattern, verb } of PROGRESS_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return `${verb} · ${pathBasename(match[1].trim())}`;
    }
  }

  const toolMatch = text.match(TOOL_LINE_PATTERN);
  if (toolMatch) {
    const tool = toolMatch[1] ?? "";
    let detail = toolMatch[2]?.trim() ?? toolMatch[3]?.trim();
    if (detail && /^\(\d+(?:\.\d+)?s\)$/.test(detail)) {
      detail = undefined;
    } else if (detail) {
      detail = detail.replace(/\s+\(\d+(?:\.\d+)?s\)\s*$/, "").trim() || undefined;
    }
    if (isMcpToolName(tool)) {
      const base = formatMcpToolDisplayName(tool);
      return detail ? `${base} · ${detail}` : base;
    }
    const verb = TOOL_VERB_LABELS[tool] ?? tool;
    if (detail) {
      return `${verb} · ${detail}`;
    }
    return verb;
  }

  return text;
}

export function activityActionKey(subagent: string | undefined, label: string): string {
  return `${subagent ?? ""}\0${normalizeActivityActionLabel(label)}`;
}

const TOOL_VERB_LABELS: Record<string, string> = {
  Read: "读取",
  Write: "写入",
  Edit: "编辑",
  MultiEdit: "编辑",
  Grep: "搜索",
  Glob: "查找",
  Bash: "运行命令",
  Agent: "调用",
  TodoWrite: "更新任务",
  TaskCreate: "创建任务",
  TaskUpdate: "更新任务",
  TaskList: "列出任务",
  TaskOutput: "读取任务输出",
  AskUserQuestion: "澄清问题",
  Skill: "读取技能",
};
