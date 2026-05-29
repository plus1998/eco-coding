import { formatSubagentLabel, isSubagentRole } from "@eco/runtime";
import { mergeStreamText } from "@eco/runtime";
import type { ThreadActivityLine, ThreadStatus } from "../shared/ipc";

export type ActivityActionIcon = "search" | "file" | "edit" | "terminal" | "agent";

export type ActivityDetailBlock =
  | { kind: "phase"; label: string }
  | { kind: "narrative"; text: string; streaming?: boolean; subagent?: string }
  | { kind: "action"; icon: ActivityActionIcon; label: string };

export type ActivityLogBlock =
  | { kind: "user-prompt"; text: string; lineId: string }
  | {
      kind: "work-session";
      durationMs: number;
      running: boolean;
      defaultCollapsed: boolean;
      activeSubagent?: string;
      children: ActivityDetailBlock[];
    }
  | {
      kind: "assistant-message";
      text: string;
      streaming?: boolean;
      subagent?: string;
    };

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

const terminalStatuses = new Set<ThreadStatus>(["completed", "failed", "blocked", "idle", "awaiting_plan"]);

export function buildActivityLogBlocks(
  lines: ThreadActivityLine[],
  options: { status?: ThreadStatus; createdAt?: string },
): ActivityLogBlock[] {
  const segments = splitLinesIntoSegments(lines);
  const isRunning = options.status === "running" || options.status === "queued";
  const isTerminal = options.status ? terminalStatuses.has(options.status) : false;
  const startedAt = options.createdAt ? Date.parse(options.createdAt) : Date.now();
  const durationMs = Math.max(0, Date.now() - startedAt);
  const activeSubagent = resolveActiveSubagent(lines, options.status);

  const output: ActivityLogBlock[] = [];

  for (const segment of segments) {
    for (const userLine of segment.userLines) {
      const text = userLine.message.trim();
      if (text) {
        output.push({ kind: "user-prompt", text: userLine.message, lineId: userLine.id });
      }
    }

    if (segment.details.length === 0) {
      continue;
    }

    const { processBlocks, summaryBlock } = partitionSessionBlocks(segment.details, isTerminal && !isRunning);

    if (isRunning && segment === segments[segments.length - 1]) {
      output.push({
        kind: "work-session",
        durationMs,
        running: true,
        defaultCollapsed: false,
        ...(activeSubagent && { activeSubagent }),
        children: processBlocks,
      });
      if (summaryBlock) {
        output.push({
          kind: "assistant-message",
          text: summaryBlock.text,
          ...(summaryBlock.streaming !== undefined && { streaming: summaryBlock.streaming }),
          ...(summaryBlock.subagent && { subagent: summaryBlock.subagent }),
        });
      }
      continue;
    }

    if (processBlocks.length > 0) {
      output.push({
        kind: "work-session",
        durationMs,
        running: false,
        defaultCollapsed: true,
        children: processBlocks,
      });
    }

    if (summaryBlock) {
      output.push({
        kind: "assistant-message",
        text: summaryBlock.text,
        ...(summaryBlock.streaming !== undefined && { streaming: summaryBlock.streaming }),
        ...(summaryBlock.subagent && { subagent: summaryBlock.subagent }),
      });
    } else if (!isRunning && processBlocks.length === 0 && segment.details.length > 0) {
      const last = segment.details[segment.details.length - 1];
      if (last?.kind === "narrative") {
        output.push({
          kind: "assistant-message",
          text: last.text,
          ...(last.streaming !== undefined && { streaming: last.streaming }),
          ...(last.subagent && { subagent: last.subagent }),
        });
      }
    }
  }

  return output;
}

interface ActivitySegment {
  userLines: ThreadActivityLine[];
  details: ActivityDetailBlock[];
}

function splitLinesIntoSegments(lines: ThreadActivityLine[]): ActivitySegment[] {
  const segments: ActivitySegment[] = [];
  let current: ActivitySegment = { userLines: [], details: [] };

  const pushSegment = () => {
    if (current.userLines.length > 0 || current.details.length > 0) {
      segments.push(current);
    }
    current = { userLines: [], details: [] };
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
    current.details.push({
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
      current.details.push(action);
    }
    pendingTools = [];
  };

  for (const line of lines) {
    if (line.role === "user") {
      flushNarrative();
      flushTools();
      if (current.details.length > 0) {
        pushSegment();
      }
      current.userLines.push(line);
      continue;
    }

    if (isPhaseLine(line.message)) {
      flushNarrative();
      flushTools();
      current.details.push({ kind: "phase", label: line.message });
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
  pushSegment();
  return segments;
}

function partitionSessionBlocks(
  details: ActivityDetailBlock[],
  extractSummary: boolean,
): { processBlocks: ActivityDetailBlock[]; summaryBlock?: ActivityDetailBlock & { kind: "narrative" } } {
  if (!extractSummary || details.length === 0) {
    return { processBlocks: details };
  }

  const lastNarrativeIndex = findLastNarrativeIndex(details);
  if (lastNarrativeIndex < 0) {
    return { processBlocks: details };
  }

  const last = details[lastNarrativeIndex];
  if (last?.kind !== "narrative" || last.streaming) {
    return { processBlocks: details };
  }

  const hasPriorContent = details.slice(0, lastNarrativeIndex).some(
    (block) => block.kind === "action" || block.kind === "phase" || block.kind === "narrative",
  );
  if (!hasPriorContent && lastNarrativeIndex === details.length - 1) {
    return { processBlocks: [], summaryBlock: last };
  }

  return {
    processBlocks: details.slice(0, lastNarrativeIndex),
    summaryBlock: last,
  };
}

function findLastNarrativeIndex(details: ActivityDetailBlock[]): number {
  for (let index = details.length - 1; index >= 0; index -= 1) {
    if (details[index]?.kind === "narrative") {
      return index;
    }
  }
  return -1;
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
  const trimmed = message.trim();
  return /^【\d+\/\d+】/.test(trimmed) || /^【自动重试 \d+\/\d+】/.test(trimmed);
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

function summarizeToolActions(tools: ParsedToolAction[]): ActivityDetailBlock[] {
  if (tools.length === 0) {
    return [];
  }

  const reads = tools.filter((tool) => tool.category === "read");
  const searches = tools.filter((tool) => tool.category === "search");
  const edits = tools.filter((tool) => tool.category === "edit");
  const runs = tools.filter((tool) => tool.category === "run");
  const agents = tools.filter((tool) => tool.category === "agent");

  const blocks: ActivityDetailBlock[] = [];

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
