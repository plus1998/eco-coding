import {
  isSubagentRole,
  isToolElapsedDuration,
  mergeStreamText,
  missionFromAgentToolDetail,
  parseSubagentMissionMessage,
  type SubagentMissionPayload,
} from "@eco/runtime";
import {
  activityActionKey,
  isReconnectActivityMessage,
  normalizeActivityActionLabel,
  stripSubagentBracketPrefix,
} from "../shared/activity-display";

export { isReconnectActivityMessage };
import type { ThreadActivityLine, ThreadStatus } from "../shared/ipc";
import { isUsageNoiseMessage } from "../shared/thread-continuation";

export type ActivityActionIcon = "search" | "file" | "edit" | "terminal" | "agent";

export type ActivityDetailBlock =
  | { kind: "phase"; label: string; reconnecting?: boolean }
  | { kind: "subagent-mission"; subagent: string; summary: string; prompt?: string }
  | { kind: "model-request"; role?: string }
  | { kind: "agent-request"; subagent?: string }
  | { kind: "thinking"; text: string; streaming?: boolean }
  | { kind: "narrative"; text: string; streaming?: boolean; subagent?: string }
  | { kind: "action"; icon: ActivityActionIcon; label: string; subagent?: string };

export type ActivityLogBlock =
  | { kind: "user-prompt"; text: string; lineId: string }
  | {
      kind: "work-session";
      durationMs: number;
      running: boolean;
      defaultCollapsed: boolean;
      activeSubagent?: string;
      activeMissionSummary?: string;
      awaitingFirstToken?: boolean;
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
  /^Compacting context/,
  /^API retry /,
  /^Usage recorded/,
  /^Run finished/,
  /^状态已更新/,
];

const terminalStatuses = new Set<ThreadStatus>(["completed", "failed", "blocked", "idle", "awaiting_plan"]);

export function buildActivityLogBlocks(
  lines: ThreadActivityLine[],
  options: { status?: ThreadStatus; createdAt?: string },
): ActivityLogBlock[] {
  const filteredLines = lines.filter((line) => !isUsageNoiseMessage(line.message));
  const segments = splitLinesIntoSegments(filteredLines);
  const isRunning = options.status === "running" || options.status === "queued";
  const isTerminal = options.status ? terminalStatuses.has(options.status) : false;
  const startedAt = options.createdAt ? Date.parse(options.createdAt) : Date.now();
  const durationMs = Math.max(0, Date.now() - startedAt);
  const activeSubagent = resolveActiveSubagent(lines, options.status);
  const activeMissionSummary = resolveActiveMissionSummary(lines, activeSubagent);

  const output: ActivityLogBlock[] = [];

  for (const segment of segments) {
    for (const userLine of segment.userLines) {
      const text = userLine.message.trim();
      if (text) {
        output.push({ kind: "user-prompt", text: userLine.message, lineId: userLine.id });
      }
    }

    if (segment.details.length === 0) {
      if (isRunning && segment === segments[segments.length - 1]) {
        output.push({
          kind: "work-session",
          durationMs,
          running: true,
          defaultCollapsed: false,
          awaitingFirstToken: true,
          children: [{ kind: "model-request" }],
        });
      }
      continue;
    }

    const { processBlocks, summaryBlock } = partitionSessionBlocks(segment.details, isTerminal && !isRunning);

    if (isRunning && segment === segments[segments.length - 1]) {
      const awaitingFirstToken = sessionAwaitingFirstToken(processBlocks, activeSubagent);
      output.push({
        kind: "work-session",
        durationMs,
        running: true,
        defaultCollapsed: false,
        ...(activeSubagent && { activeSubagent }),
        ...(activeMissionSummary && { activeMissionSummary }),
        ...(awaitingFirstToken && { awaitingFirstToken }),
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
  let thinking = "";
  let thinkingStreaming = false;
  let toolContextSubagent: string | undefined;
  const recentNarratives: string[] = [];

  const removePendingRequestBlocks = () => {
    for (let index = current.details.length - 1; index >= 0; index -= 1) {
      const kind = current.details[index]?.kind;
      if (kind === "agent-request" || kind === "model-request") {
        current.details.splice(index, 1);
      }
    }
  };

  const upsertReconnectPhase = (label: string) => {
    const block: ActivityDetailBlock = {
      kind: "phase",
      label,
      reconnecting: true,
    };
    for (let index = current.details.length - 1; index >= 0; index -= 1) {
      const child = current.details[index];
      if (child?.kind === "phase" && child.reconnecting) {
        current.details[index] = block;
        return;
      }
    }
    current.details.push(block);
  };

  const upsertModelRequest = (role?: string) => {
    const last = current.details[current.details.length - 1];
    if (last?.kind === "model-request" && last.role === role) {
      return;
    }
    removePendingRequestBlocks();
    current.details.push({
      kind: "model-request",
      ...(role && { role }),
    });
  };

  const upsertAgentRequest = (subagent?: string) => {
    const last = current.details[current.details.length - 1];
    if (last?.kind === "agent-request" && last.subagent === subagent) {
      return;
    }
    current.details.push({
      kind: "agent-request",
      ...(subagent && { subagent }),
    });
  };

  const flushThinking = () => {
    const text = stripActivityStatusNoise(thinking.trim());
    if (!text && !thinkingStreaming) {
      thinking = "";
      thinkingStreaming = false;
      return;
    }
    if (text) {
      removePendingRequestBlocks();
    }
    current.details.push({
      kind: "thinking",
      text,
      streaming: thinkingStreaming,
    });
    thinking = "";
    thinkingStreaming = false;
  };

  const flushTextBuffers = () => {
    flushThinking();
    flushNarrative();
  };

  const flushNarrative = () => {
    let text = narrative.trim();
    if (!text) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      return;
    }
    removePendingRequestBlocks();
    text = stripActivityStatusNoise(text);
    if (!text) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      return;
    }
    const lastThinking = [...current.details]
      .reverse()
      .find((block): block is ActivityDetailBlock & { kind: "thinking" } => block.kind === "thinking");
    if (lastThinking && isNarrativeDuplicateOfThinking(text, lastThinking.text)) {
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

  const noteToolContext = (line: ThreadActivityLine) => {
    if (isSubagentRole(line.role)) {
      toolContextSubagent = line.role;
    }
  };

  const pushSubagentMission = (mission: SubagentMissionPayload) => {
    toolContextSubagent = mission.role;
    const last = current.details[current.details.length - 1];
    if (
      last?.kind === "subagent-mission" &&
      last.subagent === mission.role &&
      last.summary === mission.summary
    ) {
      return;
    }
    current.details.push({
      kind: "subagent-mission",
      subagent: mission.role,
      summary: mission.summary,
      ...(mission.prompt && { prompt: mission.prompt }),
    });
  };

  const pushToolAction = (tool: ParsedToolAction, line: ThreadActivityLine) => {
    noteToolContext(line);
    const subagent =
      tool.subagent ?? (isSubagentRole(line.role) ? line.role : toolContextSubagent);
    if (tool.tool === "Agent") {
      if (subagent) {
        toolContextSubagent = subagent;
      }
      if (isAgentElapsedProgressLine(line.message)) {
        upsertAgentRequest(subagent ?? toolContextSubagent);
        return;
      }
      const legacy = missionFromAgentToolDetail(tool.detail);
      if (legacy && legacy.role) {
        pushSubagentMission({
          role: legacy.role,
          summary: legacy.summary,
          prompt: tool.detail ?? "",
        });
      }
      if (tool.detail || subagent || legacy) {
        return;
      }
      upsertAgentRequest(subagent ?? toolContextSubagent);
      return;
    }
    const label = normalizeActivityActionLabel(formatToolActionLabel(tool));
    const last = current.details[current.details.length - 1];
    const actionKey = activityActionKey(subagent, label);
    if (
      last?.kind === "action" &&
      activityActionKey(last.subagent, last.label) === actionKey &&
      tool.tool !== "Agent"
    ) {
      return;
    }
    if (last?.kind === "action") {
      const replaced = replaceOverlappingToolAction(last, tool, label, subagent);
      if (replaced) {
        current.details[current.details.length - 1] = replaced;
        return;
      }
    }
    current.details.push({
      kind: "action",
      icon: iconForToolCategory(tool.category),
      label,
      ...(subagent && { subagent }),
    });
  };

  for (const line of lines) {
    if (line.role === "user") {
      flushTextBuffers();
      if (current.details.length > 0) {
        pushSegment();
      }
      current.userLines.push(line);
      continue;
    }

    if (isPhaseLine(line.message)) {
      flushTextBuffers();
      if (isReconnectActivityMessage(line.message)) {
        upsertReconnectPhase(line.message);
      } else {
        current.details.push({ kind: "phase", label: line.message });
      }
      continue;
    }

    if (isModelRequestLine(line.message)) {
      flushTextBuffers();
      const role = line.role !== "system" && line.role !== "user" && line.role !== "tool"
        ? line.role
        : undefined;
      upsertModelRequest(role);
      continue;
    }

    const mission = parseSubagentMissionMessage(line.message);
    if (mission) {
      flushTextBuffers();
      pushSubagentMission(mission);
      continue;
    }

    if (isTaskActivityLine(line)) {
      flushTextBuffers();
      const label = normalizeActivityActionLabel(line.message);
      const subagent = isSubagentRole(line.role)
        ? line.role
        : toolContextSubagent;
      current.details.push({
        kind: "action",
        icon: "agent",
        label,
        ...(subagent && { subagent }),
      });
      continue;
    }

    const progressAction = parseProgressActionLine(line.message);
    if (progressAction) {
      flushTextBuffers();
      pushToolAction(progressAction, line);
      continue;
    }

    if (shouldHideSystemLine(line)) {
      continue;
    }

    if (isEphemeralToolStatusLine(line.message)) {
      continue;
    }

    const tool = parseToolLine(line.message);
    if (tool) {
      flushTextBuffers();
      pushToolAction(tool, line);
      continue;
    }

    if (isThinkingLine(line)) {
      flushNarrative();
      const text = line.stream ? line.message : line.message.trim();
      if (line.stream) {
        thinking = mergeStreamText(thinking, text);
        thinkingStreaming = true;
      } else if (thinking) {
        thinking += `\n\n${text}`;
      } else {
        thinking = text;
      }
      continue;
    }

    if (isNarrativeLine(line)) {
      flushThinking();
      noteNarrativeRole(line);
      const text = line.stream ? line.message : stripSubagentBracketPrefix(line.message);
      if (line.stream) {
        narrative = mergeStreamText(narrative, text);
        narrativeStreaming = true;
      } else if (narrative) {
        narrative += `\n\n${text}`;
      } else {
        narrative = text;
      }
      continue;
    }

    if (line.message.trim().length > 0) {
      flushThinking();
      noteNarrativeRole(line);
      const text = stripSubagentBracketPrefix(line.message);
      if (narrative) {
        narrative += `\n\n${text}`;
      } else {
        narrative = text;
      }
    }
  }

  flushTextBuffers();
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
    (block) =>
      block.kind === "action" ||
      block.kind === "phase" ||
      block.kind === "narrative" ||
      block.kind === "thinking" ||
      block.kind === "subagent-mission",
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

const activityStatusNoisePattern = /^状态已更新\s*/u;

export function stripActivityStatusNoise(text: string): string {
  return text.replace(activityStatusNoisePattern, "").trim();
}

export function isActivityStatusNoise(message: string): boolean {
  const trimmed = message.trim();
  return trimmed === "状态已更新" || activityStatusNoisePattern.test(trimmed);
}

function isNarrativeDuplicateOfThinking(narrative: string, thinking: string): boolean {
  const n = normalizeNarrative(narrative);
  const t = normalizeNarrative(thinking);
  if (!n || !t || n.length < 24) {
    return false;
  }
  if (n === t || t.includes(n) || n.includes(t)) {
    return true;
  }
  const nPrefix = n.slice(0, Math.min(80, n.length));
  return t.startsWith(nPrefix) || n.startsWith(t.slice(0, Math.min(80, t.length)));
}

export function resolveActiveMissionSummary(
  lines: ThreadActivityLine[],
  activeSubagent?: string,
): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const mission = parseSubagentMissionMessage(line.message);
    if (!mission) {
      continue;
    }
    if (activeSubagent && mission.role !== activeSubagent) {
      continue;
    }
    return mission.summary;
  }
  return undefined;
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
        if (roleMatch?.[1] && !isToolElapsedDuration(roleMatch[1])) {
          return roleMatch[1];
        }
      }
    }
  }

  return undefined;
}

/** True when the session is waiting for the first model token (thinking, text, or subagent output). */
export function sessionAwaitingFirstToken(
  children: readonly ActivityDetailBlock[],
  activeSubagent?: string,
): boolean {
  if (children.length === 0) {
    return false;
  }

  const last = children[children.length - 1];
  if (last?.kind === "agent-request" || last?.kind === "model-request") {
    return true;
  }
  if (
    (last?.kind === "thinking" || last?.kind === "narrative") &&
    last.streaming &&
    !last.text.trim()
  ) {
    return true;
  }

  if (!activeSubagent) {
    return false;
  }

  let missionIndex = -1;
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const block = children[index];
    if (block?.kind === "subagent-mission" && block.subagent === activeSubagent) {
      missionIndex = index;
      break;
    }
  }
  if (missionIndex < 0) {
    return false;
  }

  const afterMission = children.slice(missionIndex + 1);
  return !afterMission.some(
    (block) =>
      (block.kind === "thinking" || block.kind === "narrative") && block.text.trim().length > 0,
  );
}

export function isAgentElapsedProgressLine(message: string): boolean {
  return /^Tool:\s*Agent\s+\(\d+(?:\.\d+)?s\)\s*$/i.test(stripSubagentBracketPrefix(message.trim()));
}

export function isModelRequestLine(message: string): boolean {
  return /^Requesting model/i.test(stripSubagentBracketPrefix(message.trim()));
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
  return (
    /^【\d+\/\d+】/.test(trimmed) ||
    /^【自动重试 \d+\/\d+】/.test(trimmed) ||
    /^【连接失败】/.test(trimmed)
  );
}

function isEphemeralToolStatusLine(message: string): boolean {
  return /^Running tool:/i.test(stripSubagentBracketPrefix(message.trim()));
}

function actionDetailFromLabel(label: string): string | undefined {
  const separator = " · ";
  const index = label.indexOf(separator);
  return index >= 0 ? label.slice(index + separator.length) : undefined;
}

/** Progress hints like Read-before-Grep on the same file collapse to one row. */
function replaceOverlappingToolAction(
  prior: Extract<ActivityDetailBlock, { kind: "action" }>,
  tool: ParsedToolAction,
  nextLabel: string,
  subagent?: string,
): Extract<ActivityDetailBlock, { kind: "action" }> | null {
  if (prior.subagent !== subagent) {
    return null;
  }
  const priorDetail = actionDetailFromLabel(prior.label);
  const nextDetail = actionDetailFromLabel(nextLabel) ?? tool.detail;
  if (!priorDetail || !nextDetail || priorDetail !== nextDetail) {
    return null;
  }
  const priorIsRead = prior.label.startsWith("读取 · ");
  const nextIsSearch = tool.tool === "Grep" || tool.tool === "Glob";
  if (priorIsRead && nextIsSearch) {
    return {
      kind: "action",
      icon: iconForToolCategory(tool.category),
      label: nextLabel,
      ...(subagent && { subagent }),
    };
  }
  return null;
}

function shouldHideSystemLine(line: ThreadActivityLine): boolean {
  if (line.role === "tool") {
    return false;
  }
  const trimmed = stripSubagentBracketPrefix(line.message.trim());
  if (!trimmed) {
    return line.role !== "thinking" || !line.stream;
  }
  if (isPhaseLine(trimmed)) {
    return false;
  }
  return systemNoisePatterns.some((pattern) => pattern.test(trimmed));
}

function isThinkingLine(line: ThreadActivityLine): boolean {
  return line.role === "thinking";
}

function isNarrativeLine(line: ThreadActivityLine): boolean {
  if (line.role === "thinking") {
    return false;
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
  return ["planner", "explore", "architect", "coder", "reviewer", "tester", "system"].includes(line.role);
}

const KNOWN_SDK_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "TodoWrite",
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "AskUserQuestion",
  "Skill",
]);

function parseToolLine(message: string): ParsedToolAction | null {
  const match = message
    .trim()
    .match(/^Tool:\s*([A-Za-z_]+)(?:\s*·\s*(.+?)|\s+(\(\d+(?:\.\d+)?s\)))?\s*$/);
  if (!match) {
    return null;
  }

  const tool = match[1] ?? "";
  if (!KNOWN_SDK_TOOLS.has(tool)) {
    return null;
  }
  let detail = match[2]?.trim() ?? match[3]?.trim();
  if (detail && isToolElapsedDuration(detail)) {
    detail = undefined;
  } else if (detail) {
    const withoutDuration = detail.replace(/\s+\(\d+(?:\.\d+)?s\)\s*$/, "").trim();
    detail = withoutDuration || undefined;
  }
  const rawSubagent =
    tool === "Agent" && detail
      ? detail.match(/\(([^)]+)\)\s*$/)?.[1] ?? detail.split(" ")[0]
      : undefined;
  const subagent =
    rawSubagent && !isToolElapsedDuration(rawSubagent) ? rawSubagent : undefined;
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

function isTaskActivityLine(line: ThreadActivityLine): boolean {
  const trimmed = line.message.trim();
  if (trimmed.startsWith("@mission ")) {
    return false;
  }
  if (parseProgressActionLine(trimmed)) {
    return false;
  }
  return (
    trimmed.includes("任务开始:") ||
    trimmed.startsWith("Task started:") ||
    (trimmed.includes("Task ") && /pending|running|completed/i.test(trimmed))
  );
}

function parseProgressActionLine(message: string): ParsedToolAction | null {
  const stripped = stripSubagentBracketPrefix(message.trim());
  if (!stripped) {
    return null;
  }

  const toolLine = parseToolLine(stripped.startsWith("Tool:") ? stripped : `Tool: ${stripped}`);
  if (toolLine) {
    return toolLine;
  }

  const normalized = normalizeActivityActionLabel(stripped);
  const readMatch = normalized.match(/^读取 · (.+)$/);
  if (readMatch) {
    return { tool: "Read", detail: readMatch[1], category: "read" };
  }
  const editMatch = normalized.match(/^编辑 · (.+)$/);
  if (editMatch) {
    return { tool: "Edit", detail: editMatch[1], category: "edit" };
  }

  return null;
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
  AskUserQuestion: "澄清问题",
  Skill: "读取技能",
};

function formatToolActionLabel(tool: ParsedToolAction): string {
  if (tool.tool === "Skill" || (tool.detail && tool.detail.endsWith(" 技能"))) {
    return tool.detail ? `读取 · ${tool.detail}` : "读取技能";
  }
  const verb = TOOL_VERB_LABELS[tool.tool] ?? tool.tool;
  if (tool.tool === "Agent") {
    return "启动子代理";
  }
  if (tool.detail) {
    return `${verb} · ${tool.detail}`;
  }
  return verb;
}

function iconForToolCategory(category: ParsedToolAction["category"]): ActivityActionIcon {
  if (category === "search") {
    return "search";
  }
  if (category === "edit") {
    return "edit";
  }
  if (category === "run") {
    return "terminal";
  }
  if (category === "agent") {
    return "agent";
  }
  return "file";
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
