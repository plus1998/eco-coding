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
      summary: `重连 ${autoRetry[1]}/${autoRetry[2]}`,
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
      summary: `重连 ${legacyRetry[1]}/${legacyRetry[2]}`,
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

export interface BashRunCardDisplay {
  title: string;
  meta?: string;
  body?: string;
}

export function formatBashRunMeta(command: string, durationMs?: number): string {
  const trimmed = command.trim();
  if (!trimmed) {
    return durationMs !== undefined && Number.isFinite(durationMs)
      ? `${(durationMs / 1000).toFixed(1)}s`
      : "";
  }
  const segments = trimmed.split(/\s*(?:&&|\|\||;)\s*/u).filter(Boolean);
  const firstToken = segments[0]?.trim().split(/\s+/u)[0] ?? "";
  const parts: string[] = [];
  if (firstToken) {
    parts.push(firstToken);
  }
  if (segments.length > 1) {
    parts.push(`${segments.length - 1}+`);
  }
  if (durationMs !== undefined && Number.isFinite(durationMs)) {
    parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  }
  return parts.join(", ");
}

export function resolveBashRunCardDisplay(input: {
  toolName?: string;
  command?: string;
  summaryText?: string;
  output?: string;
  durationMs?: number;
  description?: string;
}): BashRunCardDisplay | undefined {
  if (input.toolName !== "Bash") {
    return undefined;
  }
  const command = input.command?.trim();
  const output = input.output?.trim();
  const summaryText = input.summaryText?.trim();
  const title = formatMeaningfulBashTitle(command, summaryText, input.description);
  const meta = command ? formatBashRunMeta(command, input.durationMs) : undefined;
  const body = output ?? command;
  return {
    title,
    ...(meta && { meta }),
    ...(body && { body }),
  };
}

export function formatMeaningfulBashTitle(
  command: string | undefined,
  summaryText?: string,
  description?: string,
): string {
  const normalizedDescription = description?.trim();
  if (normalizedDescription) {
    return clampActivityPreviewLine(normalizedDescription, 48);
  }
  const summary = normalizeBashSummaryCandidate(summaryText);
  if (summary && isReadableBashSummaryTitle(summary)) {
    return clampActivityPreviewLine(summary, 48);
  }
  return deriveBashTitleFromCommand(command) ?? "运行命令";
}

function normalizeBashSummaryCandidate(summaryText: string | undefined): string | undefined {
  const trimmed = summaryText?.trim();
  if (!trimmed) {
    return undefined;
  }
  const toolLine = trimmed.match(/^Tool:\s*Bash(?:\s*·\s*([\s\S]+))?$/i);
  if (toolLine) {
    const detail = toolLine[1]?.replace(/\s+\(\d+(?:\.\d+)?s\)\s*$/u, "").trim();
    return detail || undefined;
  }
  return trimmed;
}

function isReadableBashSummaryTitle(text: string): boolean {
  if (!text || looksLikeShellCommand(text)) {
    return false;
  }
  if (/^Tool:\s*/i.test(text)) {
    return false;
  }
  return /[A-Za-z\u4e00-\u9fff]/.test(text);
}

function deriveBashTitleFromCommand(command: string | undefined): string | undefined {
  const trimmed = command?.trim();
  if (!trimmed) {
    return undefined;
  }

  const lastSegment = trimmed
    .split(/\s*(?:&&|\|\||;)\s*/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .pop();
  if (!lastSegment) {
    return undefined;
  }

  const normalized = lastSegment.replace(/\s+/g, " ");
  const testMatch = normalized.match(/^(?:bun|npm|pnpm|yarn)\s+test(?:\s+(.+))?$/iu);
  if (testMatch) {
    const targets = testMatch[1]?.trim();
    if (!targets) {
      return "Run tests";
    }
    const files = targets
      .split(/\s+/u)
      .map((target) => pathBasename(target.replace(/^['"]|['"]$/gu, "")))
      .filter(Boolean);
    const primary = files[0];
    if (primary && /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(primary)) {
      const base = primary.replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/iu, "");
      return clampActivityPreviewLine(`Run ${base} tests`, 48);
    }
    if (files.length === 1 && primary) {
      return clampActivityPreviewLine(`Run ${primary} tests`, 48);
    }
    return files.length > 1 ? `Run ${files.length} test files` : "Run tests";
  }

  const runMatch = normalized.match(/^(?:npm|bun|pnpm|yarn)\s+run\s+(\S+)/iu);
  if (runMatch?.[1]) {
    return clampActivityPreviewLine(`Run ${runMatch[1]}`, 48);
  }

  const gitMatch = normalized.match(/^git\s+(\S+)(?:\s+(.+))?/iu);
  if (gitMatch?.[1]) {
    const subcommand = gitMatch[1];
    const rest = gitMatch[2]?.trim();
    if (rest) {
      const firstArg = rest.split(/\s+/u)[0]?.replace(/^['"]|['"]$/gu, "");
      if (firstArg && firstArg.length <= 24) {
        return clampActivityPreviewLine(`git ${subcommand} ${pathBasename(firstArg)}`, 48);
      }
    }
    return clampActivityPreviewLine(`git ${subcommand}`, 48);
  }

  if (/^kill\b/iu.test(normalized)) {
    return "Stop process";
  }
  if (/^curl\b/iu.test(normalized)) {
    return "Fetch URL";
  }
  if (/^wget\b/iu.test(normalized)) {
    return "Download file";
  }
  if (/^docker\b/iu.test(normalized)) {
    const dockerMatch = normalized.match(/^docker(?:\s+compose)?\s+(\S+)/iu);
    return clampActivityPreviewLine(dockerMatch ? `docker ${dockerMatch[1]}` : "docker", 48);
  }
  if (/^cd\s+\S+$/iu.test(normalized)) {
    return clampActivityPreviewLine(`cd ${pathBasename(normalized.slice(3).trim())}`, 48);
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  const first = tokens[0] ?? "";
  if (
    first.startsWith("./") ||
    first.startsWith("/") ||
    /\.(?:sh|py|js|ts|mjs|cjs)$/iu.test(first)
  ) {
    return clampActivityPreviewLine(pathBasename(first), 48);
  }
  if (normalized.length <= 48) {
    return normalized;
  }
  if (tokens.length >= 2) {
    return clampActivityPreviewLine(`${tokens[0]} ${tokens[1]}`, 48);
  }
  return clampActivityPreviewLine(first, 48);
}

function looksLikeShellCommand(text: string): boolean {
  return (
    /^(?:cd|bun|npm|pnpm|yarn|git|curl|make|docker|python|node|\.\/|\/)/u.test(text) ||
    text.includes("&&") ||
    text.includes("|") ||
    text.includes("\n")
  );
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
  description?: string;
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
  const description =
    typeof record.description === "string" ? record.description.trim() : "";
  return {
    toolUseId,
    phase,
    toolName,
    ...(detail && { detail }),
    ...(description && { description }),
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
