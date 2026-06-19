/** Normalize activity line text for display (strip redundant subagent prefixes). */

import { parseSubagentMissionMessage, shortenModelId } from "@eco/runtime";
import { resolveSubagentRunDisplayTitle } from "./subagent-roles";

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

export interface ParsedReconnectActivity {
  summary: string;
  detail?: string;
}

/** Auto-retry or upstream connection failure status — should replace prior line, not stack. */
export function isReconnectActivityMessage(message: string): boolean {
  return parseReconnectActivityMessage(message) !== null;
}

export function parseReconnectActivityMessage(message: string): ParsedReconnectActivity | null {
  const trimmed = message.trim();
  const autoRetry = trimmed.match(/^【自动重试\s*(\d+)\/(\d+)】\s*([\s\S]*)$/);
  if (autoRetry?.[1] && autoRetry[2]) {
    const detail = autoRetry[3]?.trim();
    return {
      summary: `正在重新连接 ${autoRetry[1]}/${autoRetry[2]}`,
      ...(detail && { detail }),
    };
  }

  const connectionFailed = trimmed.match(/^【连接失败】\s*([\s\S]*)$/);
  if (connectionFailed) {
    const body = connectionFailed[1]?.trim() ?? "";
    const httpMatch = body.match(/^HTTP\s*(\d{3})\s*(?:[：:]\s*([\s\S]*))?$/);
    if (httpMatch?.[1]) {
      const detail = httpMatch[2]?.trim() || undefined;
      return {
        summary: `连接失败 · HTTP ${httpMatch[1]}`,
        ...(detail && { detail }),
      };
    }
    const colonSplit = body.match(/^([^：:]+)[：:]\s*([\s\S]+)$/);
    if (colonSplit?.[1] && colonSplit[2]) {
      return {
        summary: `连接失败 · ${colonSplit[1].trim()}`,
        detail: colonSplit[2].trim(),
      };
    }
    return {
      summary: "连接失败",
      ...(body && { detail: body }),
    };
  }

  const legacyRetry = trimmed.match(/^上游不可用，正在重试\s*(\d+)\/(\d+)[^：:]*[：:]\s*([\s\S]*)$/);
  if (legacyRetry?.[1] && legacyRetry[2]) {
    const detail = legacyRetry[3]?.trim();
    return {
      summary: `正在重新连接 ${legacyRetry[1]}/${legacyRetry[2]}`,
      ...(detail && { detail }),
    };
  }

  return null;
}

/** Retry-in-progress placeholders — not evidence that upstream recovered. */
const reconnectInProgressPatterns = [
  /^Requesting model/i,
  /^API error/i,
];

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
  if (reconnectInProgressPatterns.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  if (parseSubagentMissionMessage(trimmed)) {
    return true;
  }
  if (/^正在刷新上下文用量/.test(trimmed)) {
    return false;
  }
  if (/^Tool:/i.test(trimmed) && !/^Tool failed:/i.test(trimmed)) {
    return true;
  }
  if (/^【\d+\/\d+】/.test(trimmed)) {
    return true;
  }
  if (/^(Reading|Writing|Editing|Searching|Running)\s+/i.test(trimmed)) {
    return true;
  }
  if (line.role === "thinking" && trimmed.length > 0) {
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

/** Display label for a tool action row (icon conveys the verb; text shows target/detail). */
export function normalizeAgentLabelToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function isRedundantAgentModelShort(roleLabel: string, modelShort: string): boolean {
  if (!roleLabel.trim() || !modelShort.trim()) {
    return false;
  }
  return normalizeAgentLabelToken(roleLabel) === normalizeAgentLabelToken(modelShort);
}

export function activityLabelIncludesAgentRole(
  role: string,
  label: string,
  options?: {
    modelId?: string | undefined;
    displayName?: string | undefined;
  },
): boolean {
  const normalizedLabel = label.trim().toLowerCase();
  if (!normalizedLabel || !role.trim()) {
    return false;
  }
  const tokens = new Set<string>();
  for (const candidate of [
    role,
    options?.displayName,
    options?.modelId ? shortenModelId(options.modelId) : undefined,
    resolveSubagentRunDisplayTitle(role),
  ]) {
    if (!candidate?.trim()) {
      continue;
    }
    tokens.add(normalizeAgentLabelToken(candidate));
  }
  for (const token of tokens) {
    if (
      normalizedLabel === token ||
      normalizedLabel.startsWith(`${token} ·`) ||
      normalizedLabel.startsWith(`${token}·`)
    ) {
      return true;
    }
  }
  return false;
}

export function clampActivityPreviewLine(text: string, max = 56): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine || oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Compact single-line preview for subagent cards and status rows. */
export function formatToolStatusPreview(toolName: string, detail?: string, max = 56): string {
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail) {
    return TOOL_VERB_LABELS[toolName] ?? toolName;
  }
  if (toolName === "Bash") {
    return clampActivityPreviewLine(normalizedDetail, max);
  }
  return clampActivityPreviewLine(formatToolDisplayLabel(toolName, normalizedDetail), max);
}

export function formatToolDisplayLabel(toolName: string, detail?: string): string {
  const normalizedDetail = detail?.trim() || undefined;
  if (toolName === "Skill" || (normalizedDetail && normalizedDetail.endsWith(" 技能"))) {
    return normalizedDetail ?? "读取技能";
  }
  if (toolName === "mcp_tool" && normalizedDetail?.startsWith("mcp__")) {
    return formatMcpToolDisplayName(normalizedDetail);
  }
  if (isMcpToolName(toolName)) {
    return formatMcpToolDisplayName(toolName);
  }
  if (toolName === "Agent") {
    return normalizedDetail ?? "启动子代理";
  }
  if (normalizedDetail) {
    return normalizedDetail;
  }
  return TOOL_VERB_LABELS[toolName] ?? toolName;
}

export function parseToolActionDisplayLabel(raw: string): string {
  const text = stripSubagentBracketPrefix(raw.trim());
  if (!text) {
    return raw.trim();
  }

  for (const { pattern } of PROGRESS_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return pathBasename(match[1].trim());
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
    return formatToolDisplayLabel(tool, detail);
  }

  const bareMatch = text.match(/^([A-Za-z][A-Za-z0-9_]*)\s*·\s*(.+)$/);
  if (bareMatch?.[1] && bareMatch[2]) {
    const detail = bareMatch[2].replace(/\s+\(\d+(?:\.\d+)?s\)\s*$/, "").trim();
    return formatToolDisplayLabel(bareMatch[1], detail);
  }

  if (isMcpToolName(text)) {
    return formatMcpToolDisplayName(text);
  }

  return text;
}

export function normalizeActivityActionLabel(raw: string): string {
  return parseToolActionDisplayLabel(raw);
}

export function activityActionKey(
  subagent: string | undefined,
  label: string,
  icon?: string,
): string {
  return `${subagent ?? ""}\0${icon ?? ""}\0${normalizeActivityActionLabel(label)}`;
}

const BASH_APPROVAL_ACTIVITY_PATTERN =
  /^(?:等待确认|已允许本次|已拒绝|Bash 已拒绝：)\s*([A-Za-z][A-Za-z0-9_]*)(?:[：:]\s*(.+))?$/u;

export interface ParsedBashApprovalActivityText {
  toolName: string;
  detail?: string;
  phase: "approval-pending" | "approval-approved" | "approval-rejected";
}

export function parseBashApprovalActivityText(text: string): ParsedBashApprovalActivityText | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("Bash 已拒绝：")) {
    return { toolName: "Bash", detail: trimmed.slice("Bash 已拒绝：".length).trim(), phase: "approval-rejected" };
  }
  const match = trimmed.match(BASH_APPROVAL_ACTIVITY_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }
  const toolName = match[1];
  const detail = match[2]?.trim() || undefined;
  if (trimmed.startsWith("等待确认")) {
    return { toolName, ...(detail && { detail }), phase: "approval-pending" };
  }
  if (trimmed.startsWith("已允许本次")) {
    return { toolName, ...(detail && { detail }), phase: "approval-approved" };
  }
  if (trimmed.startsWith("已拒绝")) {
    return { toolName, ...(detail && { detail }), phase: "approval-rejected" };
  }
  return undefined;
}

export type ToolActionLifecycle =
  | "approval-pending"
  | "approval-approved"
  | "approval-rejected"
  | "running"
  | "completed"
  | "failed";

export function bashApprovalPhaseToLifecycle(
  phase: "requested" | "approved" | "rejected" | "denied",
): ToolActionLifecycle {
  if (phase === "requested") {
    return "approval-pending";
  }
  if (phase === "approved") {
    return "approval-approved";
  }
  return "approval-rejected";
}

export function toolStatusToLifecycle(
  status: "started" | "completed" | "failed" | undefined,
  eventType?: string,
): ToolActionLifecycle | undefined {
  if (status === "failed" || eventType === "tool.failed") {
    return "failed";
  }
  if (status === "completed" || eventType === "tool.completed") {
    return "completed";
  }
  if (status === "started" || eventType === "tool.started") {
    return "running";
  }
  return undefined;
}

export function compareToolActionLifecyclePriority(
  left: ToolActionLifecycle,
  right: ToolActionLifecycle,
): number {
  const rank: Record<ToolActionLifecycle, number> = {
    "approval-rejected": 1,
    "approval-pending": 2,
    "approval-approved": 3,
    running: 4,
    completed: 5,
    failed: 5,
  };
  return rank[left] - rank[right];
}

export interface ThreadRunBashApprovalMetadataLike {
  toolUseId: string;
  phase: "requested" | "approved" | "rejected" | "denied";
  toolName: string;
  detail?: string;
}

export function readBashApprovalMetadata(
  metadata: Record<string, unknown> | undefined,
): ThreadRunBashApprovalMetadataLike | undefined {
  const raw = metadata?.bashApproval;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const toolUseId = typeof record.toolUseId === "string" ? record.toolUseId.trim() : "";
  const toolName = typeof record.toolName === "string" ? record.toolName.trim() : "";
  const phase = record.phase;
  if (
    !toolUseId ||
    !toolName ||
    (phase !== "requested" && phase !== "approved" && phase !== "rejected" && phase !== "denied")
  ) {
    return undefined;
  }
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  return {
    toolUseId,
    phase,
    toolName,
    ...(detail && { detail }),
  };
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
  WebSearch: "网络搜索",
  WebFetch: "获取网页",
  Skill: "读取技能",
};
