import { formatSubagentLabel, isSubagentRole } from "@eco/runtime";
import { mergeStreamText } from "@eco/runtime";
import type { ThreadActivityLine, ThreadStatus } from "../shared/ipc";

export type ActivityActionIcon = "search" | "file" | "edit" | "terminal" | "agent";

export type ActivityLogBlock =
  | { kind: "progress"; label: string; running: boolean; activeSubagent?: string }
  | { kind: "phase"; label: string }
  | { kind: "user-prompt"; text: string; lineId: string }
  | { kind: "narrative"; text: string; streaming?: boolean; subagent?: string }
  | { kind: "action"; icon: ActivityActionIcon; label: string };

interface ParsedToolAction {
  tool: string;
  detail?: string;
  subagent?: string;
  category: "read" | "search" | "edit" | "run" | "agent";
}

const systemNoisePatterns = [
  /^Creating isolated worktree/i,
  /^Isolated worktree ready:/i,
  /^Local model router ready:/i,
  /^Claude Agent SDK ready/i,
  /^Agent session started/i,
  /^Agent run completed/i,
  /^已清理隔离工作树/,
  /^Requesting model/,
  /^Compacting context/,
  /^API retry /,
  /^Usage recorded/,
  /^Run finished/,
];

export function buildActivityLogBlocks(
  lines: ThreadActivityLine[],
  options: { status?: ThreadStatus; createdAt?: string },
): ActivityLogBlock[] {
  const blocks: ActivityLogBlock[] = [];
  const activeSubagent = resolveActiveSubagent(lines, options.status);
  let progressInserted = false;

  const ensureProgress = () => {
    if (progressInserted || lines.length === 0) {
      return;
    }
    blocks.push(createProgressBlock(options, activeSubagent));
    progressInserted = true;
  };

  let narrative = "";
  let narrativeStreaming = false;
  let narrativeSubagent: string | undefined;
  let pendingTools: ParsedToolAction[] = [];
  const recentNarratives: string[] = [];

  const flushNarrative = () => {
    const text = narrative.trim();
    if (!text) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      return;
    }
    if (isRepeatedNarrative(text, recentNarratives)) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      return;
    }
    recentNarratives.push(normalizeNarrative(text));
    if (recentNarratives.length > 6) {
      recentNarratives.shift();
    }
    blocks.push({
      kind: "narrative",
      text,
      streaming: narrativeStreaming,
      ...(narrativeSubagent && { subagent: narrativeSubagent }),
    });
    narrative = "";
    narrativeStreaming = false;
    narrativeSubagent = undefined;
  };

  const noteNarrativeRole = (line: ThreadActivityLine) => {
    if (isSubagentRole(line.role)) {
      narrativeSubagent = line.role;
    }
  };

  const flushTools = () => {
    for (const action of summarizeToolActions(pendingTools)) {
      blocks.push(action);
    }
    pendingTools = [];
  };

  for (const line of lines) {
    if (line.role === "user") {
      flushNarrative();
      flushTools();
      const text = line.message.trim();
      if (text) {
        blocks.push({ kind: "user-prompt", text: line.message, lineId: line.id });
      }
      continue;
    }

    ensureProgress();

    if (isPhaseLine(line.message)) {
      flushNarrative();
      flushTools();
      blocks.push({ kind: "phase", label: line.message });
      continue;
    }

    if (shouldHideSystemLine(line)) {
      continue;
    }

    const tool = parseToolLine(line.message);
    if (tool) {
      flushNarrative();
      pendingTools.push(tool);
      continue;
    }

    if (isNarrativeLine(line)) {
      flushTools();
      noteNarrativeRole(line);
      if (line.stream) {
        narrative = mergeStreamText(narrative, line.message);
        narrativeStreaming = true;
      } else if (narrative) {
        narrative += `\n\n${line.message}`;
      } else {
        narrative = line.message;
      }
      continue;
    }

    if (line.message.trim().length > 0) {
      flushTools();
      noteNarrativeRole(line);
      if (narrative) {
        narrative += `\n\n${line.message}`;
      } else {
        narrative = line.message;
      }
    }
  }

  flushNarrative();
  flushTools();
  ensureProgress();
  return blocks;
}

function isRepeatedNarrative(text: string, recentNarratives: readonly string[]): boolean {
  const normalized = normalizeNarrative(text);
  if (!normalized) {
    return true;
  }
  const firstSentence = normalized.split(/[.!?。！？]/)[0]?.trim() ?? normalized;
  const compactFirstSentence = firstSentence.replace(/\s+/g, "");

  return recentNarratives.some((recent) => {
    if (recent === normalized) {
      return true;
    }
    const recentFirstSentence = recent.split(/[.!?。！？]/)[0]?.trim() ?? recent;
    if (firstSentence.length >= 18 && recentFirstSentence === firstSentence) {
      return true;
    }
    return (
      compactFirstSentence.startsWith("nowihaveenoughcontext") &&
      recentFirstSentence.replace(/\s+/g, "").startsWith("nowihaveenoughcontext")
    );
  });
}

function normalizeNarrative(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function resolveActiveSubagent(
  lines: ThreadActivityLine[],
  status?: ThreadStatus,
): string | undefined {
  if (status !== "running" && status !== "queued") {
    return undefined;
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    if (isSubagentRole(line.role)) {
      return line.role;
    }
    const tool = parseToolLine(line.message);
    if (tool?.category === "agent" && tool.subagent) {
      return tool.subagent;
    }
    if (line.message.includes("【") && line.message.includes("】")) {
      const match = line.message.match(/【([^】]+)】/);
      if (match?.[1]) {
        const inner = match[1];
        const roleMatch = inner.match(/\(([^)]+)\)\s*$/);
        if (roleMatch?.[1]) {
          return roleMatch[1];
        }
      }
    }
  }

  return undefined;
}

function createProgressBlock(
  options: {
    status?: ThreadStatus;
    createdAt?: string;
  },
  activeSubagent?: string,
): ActivityLogBlock {
  const startedAt = options.createdAt ? Date.parse(options.createdAt) : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const subagentSuffix = activeSubagent ? ` · ${formatSubagentLabel(activeSubagent)}` : "";

  if (options.status === "awaiting_plan") {
    return { kind: "progress", label: "计划待确认", running: false };
  }

  if (options.status === "running" || options.status === "queued") {
    return {
      kind: "progress",
      label: `处理中${subagentSuffix}…`,
      running: true,
      ...(activeSubagent && { activeSubagent }),
    };
  }

  if (options.status === "idle") {
    return { kind: "progress", label: "可继续对话", running: false };
  }

  if (options.status === "completed" || options.status === "failed" || options.status === "blocked") {
    return { kind: "progress", label: `已处理 ${formatDuration(elapsedMs)}`, running: false };
  }

  return { kind: "progress", label: `已处理 ${formatDuration(elapsedMs)}`, running: false };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function isPhaseLine(message: string): boolean {
  return /^【\d+\/\d+】/.test(message.trim());
}

function shouldHideSystemLine(line: ThreadActivityLine): boolean {
  if (line.role === "tool") {
    return false;
  }
  const trimmed = line.message.trim();
  if (!trimmed) {
    return true;
  }
  if (isPhaseLine(trimmed)) {
    return false;
  }
  return systemNoisePatterns.some((pattern) => pattern.test(trimmed));
}

function isNarrativeLine(line: ThreadActivityLine): boolean {
  if (line.role === "thinking") {
    return true;
  }
  if (line.role === "tool") {
    return false;
  }
  if (parseToolLine(line.message)) {
    return false;
  }
  if (line.role === "system" && line.message.length < 120) {
    return false;
  }
  return ["planner", "architect", "coder", "reviewer", "tester", "system"].includes(line.role);
}

function parseToolLine(message: string): ParsedToolAction | null {
  const match = message.trim().match(/^Tool:\s*([A-Za-z_]+)(?:\s*·\s*(.+))?/);
  if (!match) {
    return null;
  }

  const tool = match[1] ?? "";
  const detail = match[2]?.trim();
  const subagent =
    tool === "Agent" && detail
      ? detail.match(/\(([^)]+)\)\s*$/)?.[1] ?? detail.split(" ")[0]
      : undefined;
  return {
    tool,
    ...(detail && { detail }),
    ...(subagent && { subagent }),
    category: categorizeTool(tool),
  };
}

function categorizeTool(tool: string): ParsedToolAction["category"] {
  if (tool === "Agent") {
    return "agent";
  }
  if (tool === "Bash") {
    return "run";
  }
  if (tool === "Write" || tool === "Edit") {
    return "edit";
  }
  if (tool === "Glob" || tool === "Grep") {
    return "search";
  }
  return "read";
}

function summarizeToolActions(tools: ParsedToolAction[]): ActivityLogBlock[] {
  if (tools.length === 0) {
    return [];
  }

  const reads = tools.filter((tool) => tool.category === "read");
  const searches = tools.filter((tool) => tool.category === "search");
  const edits = tools.filter((tool) => tool.category === "edit");
  const runs = tools.filter((tool) => tool.category === "run");
  const agents = tools.filter((tool) => tool.category === "agent");

  const blocks: ActivityLogBlock[] = [];

  if (searches.length > 0 && runs.length > 0 && reads.length === 0 && edits.length === 0) {
    blocks.push({
      kind: "action",
      icon: "search",
      label: `已探索 ${searches.length} 次搜索 · 已运行 ${runs.length} 条命令`,
    });
  } else {
    if (searches.length > 0) {
      blocks.push({
        kind: "action",
        icon: "search",
        label: searches.length === 1 ? "已探索 1 次搜索" : `已探索 ${searches.length} 次搜索`,
      });
    }

    const exploreCount = reads.length;
    if (exploreCount > 0) {
      blocks.push({
        kind: "action",
        icon: "file",
        label: exploreCount === 1 ? "已探索 1 个文件" : `已探索 ${exploreCount} 个文件`,
      });
    }
  }

  if (edits.length > 0) {
    blocks.push({
      kind: "action",
      icon: "edit",
      label: edits.length === 1 ? "已编辑 1 个文件" : `已编辑 ${edits.length} 个文件`,
    });
  }

  if (runs.length > 0 && !(searches.length > 0 && reads.length === 0 && edits.length === 0)) {
    if (runs.length === 1 && runs[0]?.detail) {
      blocks.push({
        kind: "action",
        icon: "terminal",
        label: `已运行 ${runs[0].detail}`,
      });
    } else {
      blocks.push({
        kind: "action",
        icon: "terminal",
        label: runs.length === 1 ? "已运行 1 条命令" : `已运行 ${runs.length} 条命令`,
      });
    }
  }

  if (agents.length > 0) {
    const latest = agents[agents.length - 1];
    const subagentLabel = latest?.subagent ? formatSubagentLabel(latest.subagent) : "子代理";
    blocks.push({
      kind: "action",
      icon: "agent",
      label:
        agents.length === 1
          ? `子代理 ${subagentLabel} 执行中`
          : `已调用 ${agents.length} 个子代理（当前 ${subagentLabel}）`,
    });
  }

  return blocks;
}

export function splitNarrativeSegments(text: string): Array<{ type: "text" | "code"; value: string }> {
  const segments: Array<{ type: "text" | "code"; value: string }> = [];
  const pattern = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", value: match[1] ?? "" });
    lastIndex = match.index + match[0].length;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
