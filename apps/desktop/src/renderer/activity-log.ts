import {
  isGenericMissionSummary,
  isSubagentRole,
  isToolElapsedDuration,
  isWeakAgentToolDetail,
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
import type { ThreadActivityLine, ThreadStatus } from "../shared/ipc";
import { isUsageNoiseMessage } from "../shared/thread-continuation";

export { isReconnectActivityMessage };

export type ActivityActionIcon = "search" | "file" | "edit" | "terminal" | "agent";

export type ActivityDetailBlock =
  | { kind: "phase"; label: string; reconnecting?: boolean }
  | { kind: "subagent-mission"; subagent: string; summary: string; prompt?: string }
  | { kind: "model-request"; role?: string }
  | { kind: "agent-request"; subagent?: string }
  | { kind: "thinking"; text: string; streaming?: boolean }
  | { kind: "narrative"; text: string; streaming?: boolean; subagent?: string }
  | { kind: "action"; icon: ActivityActionIcon; label: string; subagent?: string }
  | { kind: "tool-failed"; tool: string; error?: string; subagent?: string };

export type ActivityLogBlock =
  | { kind: "user-prompt"; text: string; lineId: string }
  | {
      kind: "work-session";
      durationMs: number;
      running: boolean;
      defaultCollapsed: boolean;
      compactSubagentMode?: boolean;
      /** Isolated sub-agent run when compactSubagentMode (one card per delegation). */
      subagentRunRole?: string;
      activeSubagents?: string[];
      activeSubagent?: string;
      activeMissionSummary?: string;
      latestSubagentLogLine?: string;
      /** Elapsed time for this sub-agent run (from Agent tool duration lines). */
      runDurationMs?: number;
      /** Hide misleading thread-level duration on planner separators when sub-agent cards exist. */
      hideProcessedDuration?: boolean;
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
    const isLastSegment = segment === segments[segments.length - 1];
    const segmentRunning = isRunning && isLastSegment;

    pushWorkSessionsFromRuns(output, partitionDetailsIntoRuns(processBlocks), {
      durationMs,
      segmentRunning,
      lines,
      status: options.status,
      activeSubagent,
      activeMissionSummary,
    });

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
  const missionByRole = new Map<string, SubagentMissionPayload>();
  const recentNarratives: string[] = [];

  const removePendingRequestBlocks = () => {
    for (let index = current.details.length - 1; index >= 0; index -= 1) {
      const kind = current.details[index]?.kind;
      if (kind === "agent-request" || kind === "model-request") {
        current.details.splice(index, 1);
      }
    }
  };

  const repositionPendingRequestBlocksToEnd = () => {
    const pending: ActivityDetailBlock[] = [];
    for (let index = current.details.length - 1; index >= 0; index -= 1) {
      const block = current.details[index];
      if (block?.kind === "agent-request" || block?.kind === "model-request") {
        pending.unshift(block);
        current.details.splice(index, 1);
      }
    }
    if (pending.length > 0) {
      current.details.push(...pending);
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
      repositionPendingRequestBlocksToEnd();
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
      repositionPendingRequestBlocksToEnd();
      return;
    }
    removePendingRequestBlocks();
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
    removePendingRequestBlocks();
    toolContextSubagent = mission.role;
    const stored = missionByRole.get(mission.role);
    const merged: SubagentMissionPayload = {
      role: mission.role,
      summary:
        stored && !isGenericMissionSummary(stored.summary) && isGenericMissionSummary(mission.summary)
          ? stored.summary
          : mission.summary,
      prompt: mission.prompt?.trim() || stored?.prompt?.trim() || "",
    };
    missionByRole.set(merged.role, merged);

    const last = current.details[current.details.length - 1];
    if (last?.kind === "subagent-mission" && last.subagent === merged.role) {
      const sameSummary = last.summary === merged.summary;
      const upgradeInPlace =
        sameSummary ||
        isGenericMissionSummary(last.summary) ||
        (!last.prompt?.trim() && Boolean(merged.prompt?.trim()));
      if (upgradeInPlace) {
        const upgraded = {
          kind: "subagent-mission" as const,
          subagent: merged.role,
          summary:
            isGenericMissionSummary(last.summary) && !isGenericMissionSummary(merged.summary)
              ? merged.summary
              : last.summary,
          ...((merged.prompt || last.prompt) && { prompt: merged.prompt || last.prompt }),
        };
        if (
          upgraded.summary === last.summary &&
          upgraded.prompt === last.prompt
        ) {
          return;
        }
        current.details[current.details.length - 1] = upgraded;
        return;
      }
    }
    current.details.push({
      kind: "subagent-mission",
      subagent: merged.role,
      summary: merged.summary,
      ...(merged.prompt && { prompt: merged.prompt }),
    });
  };

  const pushToolAction = (tool: ParsedToolAction, line: ThreadActivityLine) => {
    removePendingRequestBlocks();
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
        if (!isWeakAgentToolDetail(tool.detail)) {
          pushSubagentMission({
            role: legacy.role,
            summary: legacy.summary,
            prompt: tool.detail ?? "",
          });
        } else {
          const stored = missionByRole.get(legacy.role);
          if (stored) {
            pushSubagentMission(stored);
          } else {
            pushSubagentMission({
              role: legacy.role,
              summary: legacy.summary,
              prompt: "",
            });
          }
        }
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
        removePendingRequestBlocks();
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
      missionByRole.set(mission.role, mission);
      pushSubagentMission(mission);
      continue;
    }

    const toolFailed = parseToolFailedLine(line.message);
    if (toolFailed) {
      flushTextBuffers();
      removePendingRequestBlocks();
      noteToolContext(line);
      current.details.push({
        kind: "tool-failed",
        tool: toolFailed.tool,
        ...(toolFailed.error && { error: toolFailed.error }),
        ...(toolContextSubagent && { subagent: toolContextSubagent }),
      });
      continue;
    }

    if (isTaskActivityLine(line)) {
      flushTextBuffers();
      removePendingRequestBlocks();
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

type DetailRun =
  | { kind: "planner"; blocks: ActivityDetailBlock[] }
  | { kind: "subagent"; role: string; occurrence: number; blocks: ActivityDetailBlock[] };

function getBlockSubagentRole(block: ActivityDetailBlock): string | undefined {
  if (block.kind === "subagent-mission") {
    return block.subagent;
  }
  if (block.kind === "model-request" && block.role && isSubagentRole(block.role)) {
    return block.role;
  }
  if (
    (block.kind === "action" ||
      block.kind === "narrative" ||
      block.kind === "agent-request" ||
      block.kind === "tool-failed") &&
    block.subagent &&
    isSubagentRole(block.subagent)
  ) {
    return block.subagent;
  }
  return undefined;
}

/** Split session details into planner (main window) vs isolated sub-agent runs. */
export function partitionDetailsIntoRuns(details: readonly ActivityDetailBlock[]): DetailRun[] {
  const runs: DetailRun[] = [];
  let plannerBlocks: ActivityDetailBlock[] = [];
  let currentRole: string | undefined;
  let subagentBlocks: ActivityDetailBlock[] = [];
  const roleOccurrences = new Map<string, number>();

  const flushPlanner = () => {
    if (plannerBlocks.length > 0) {
      runs.push({ kind: "planner", blocks: plannerBlocks });
      plannerBlocks = [];
    }
  };

  const flushSubagent = () => {
    if (currentRole && subagentBlocks.length > 0) {
      const occurrence = roleOccurrences.get(currentRole) ?? 0;
      runs.push({ kind: "subagent", role: currentRole, occurrence, blocks: subagentBlocks });
      roleOccurrences.set(currentRole, occurrence + 1);
    }
    subagentBlocks = [];
    currentRole = undefined;
  };

  for (const block of details) {
    if (block.kind === "subagent-mission") {
      if (currentRole && block.subagent === currentRole) {
        flushSubagent();
      } else if (currentRole && block.subagent !== currentRole) {
        flushSubagent();
      } else if (!currentRole) {
        flushPlanner();
      }
      currentRole = block.subagent;
      subagentBlocks.push(block);
      continue;
    }

    const role = getBlockSubagentRole(block);
    if (role) {
      if (currentRole && role !== currentRole) {
        flushSubagent();
      } else if (!currentRole) {
        flushPlanner();
      }
      currentRole = role;
      subagentBlocks.push(block);
      continue;
    }

    flushSubagent();
    plannerBlocks.push(block);
  }

  flushSubagent();
  flushPlanner();
  return runs;
}

function pushWorkSessionsFromRuns(
  output: ActivityLogBlock[],
  runs: DetailRun[],
  options: {
    durationMs: number;
    segmentRunning: boolean;
    lines: ThreadActivityLine[];
    status?: ThreadStatus;
    activeSubagent?: string;
    activeMissionSummary?: string;
  },
): void {
  const liveSubagents = options.segmentRunning
    ? resolveActiveSubagents(options.lines, options.status)
    : [];
  const hasSubagentRuns = runs.some((run) => run.kind === "subagent");

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (!run) {
      continue;
    }
    const isLastRun = index === runs.length - 1;
    const running = options.segmentRunning && isLastRun;

    if (run.kind === "planner") {
      if (run.blocks.length === 0) {
        continue;
      }
      const awaitingFirstToken = running && sessionAwaitingFirstToken(run.blocks, undefined);
      output.push({
        kind: "work-session",
        durationMs: options.durationMs,
        running,
        defaultCollapsed: !running,
        ...(hasSubagentRuns && { hideProcessedDuration: true }),
        ...(awaitingFirstToken && { awaitingFirstToken }),
        children: run.blocks,
      });
      continue;
    }

    const role = run.role;
    const roleActive = liveSubagents.filter((entry) => entry === role);
    const isActiveRole = running && options.activeSubagent === role;
    const awaitingFirstToken =
      running && sessionAwaitingFirstToken(run.blocks, isActiveRole ? role : undefined);
    const latestSubagentLogLine = resolveLatestSubagentLogLine(
      run.blocks,
      isActiveRole ? options.activeMissionSummary : undefined,
    );
    const runDurationMs = resolveSubagentRunDurationMs(options.lines, role, run.occurrence);
    output.push({
      kind: "work-session",
      durationMs: options.durationMs,
      running,
      defaultCollapsed: true,
      compactSubagentMode: true,
      subagentRunRole: role,
      activeSubagents: running && roleActive.length > 0 ? roleActive : [role],
      ...(isActiveRole && { activeSubagent: role }),
      ...(isActiveRole &&
        options.activeMissionSummary && { activeMissionSummary: options.activeMissionSummary }),
      ...(awaitingFirstToken && { awaitingFirstToken }),
      ...(latestSubagentLogLine && { latestSubagentLogLine }),
      ...(runDurationMs > 0 && { runDurationMs }),
      children: run.blocks,
    });
  }
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

function clampSubagentLogLine(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) {
    return oneLine;
  }
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Latest subagent step text for compact card (role shown on card chips, not repeated here). */
export function resolveLatestSubagentLogLine(
  children: readonly ActivityDetailBlock[],
  missionSummary?: string,
): string | undefined {
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const block = children[index];
    if (!block) {
      continue;
    }

    if (block.kind === "action" && block.subagent) {
      return clampSubagentLogLine(block.label);
    }
    if (block.kind === "tool-failed" && block.subagent) {
      const detail = block.error?.trim();
      return clampSubagentLogLine(
        detail ? `${block.tool} 失败：${detail}` : `${block.tool} 失败`,
      );
    }
    if (block.kind === "narrative" && block.subagent) {
      const text = block.text.trim();
      if (text) {
        const firstLine = text.split("\n").find((line) => line.trim())?.trim() ?? text;
        return clampSubagentLogLine(firstLine);
      }
    }
    if (block.kind === "agent-request" && block.subagent) {
      return "处理中…";
    }
    if (block.kind === "subagent-mission") {
      const summary = block.summary.trim();
      if (summary) {
        return clampSubagentLogLine(summary);
      }
    }
  }

  const trimmedMission = missionSummary?.trim();
  if (trimmedMission) {
    return clampSubagentLogLine(trimmedMission);
  }
  return undefined;
}

export function sessionHasSubagentWork(children: readonly ActivityDetailBlock[]): boolean {
  return children.some((block) => {
    if (block.kind === "subagent-mission" || block.kind === "agent-request") {
      return true;
    }
    if (
      block.kind === "action" ||
      block.kind === "narrative" ||
      block.kind === "tool-failed"
    ) {
      return Boolean(block.subagent);
    }
    return false;
  });
}

export function countOpenAgentDelegations(lines: ThreadActivityLine[], role: string): number {
  return resolveActiveSubagents(lines, "running").filter((entry) => entry === role).length;
}

export function resolveActiveSubagents(
  lines: ThreadActivityLine[],
  status?: ThreadStatus,
): string[] {
  if (status !== "running" && status !== "queued") {
    return [];
  }

  const openByRole = new Map<string, number>();
  let contextSubagent: string | undefined;

  for (const line of lines) {
    if (isSubagentRole(line.role) && line.stream) {
      openByRole.set(line.role, Math.max(openByRole.get(line.role) ?? 0, 1));
    }

    const tool = parseToolLine(line.message);
    if (tool?.tool !== "Agent") {
      continue;
    }

    if (isAgentElapsedProgressLine(line.message)) {
      const role =
        tool.subagent ??
        (isSubagentRole(line.role) ? line.role : contextSubagent);
      if (role && isSubagentRole(role)) {
        const next = Math.max(0, (openByRole.get(role) ?? 1) - 1);
        if (next === 0) {
          openByRole.delete(role);
        } else {
          openByRole.set(role, next);
        }
      }
      continue;
    }

    const legacy = missionFromAgentToolDetail(tool.detail);
    const role =
      tool.subagent ??
      legacy?.role ??
      (isSubagentRole(line.role) ? line.role : contextSubagent);
    if (role && isSubagentRole(role)) {
      openByRole.set(role, (openByRole.get(role) ?? 0) + 1);
      contextSubagent = role;
    }
  }

  const result: string[] = [];
  for (const [role, count] of openByRole) {
    for (let index = 0; index < count; index += 1) {
      result.push(role);
    }
  }

  if (result.length === 0) {
    const single = resolveActiveSubagent(lines, status);
    if (single) {
      result.push(single);
    }
  }

  return result;
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

export function parseAgentElapsedMs(message: string): number {
  const match = stripSubagentBracketPrefix(message.trim()).match(
    /^Tool:\s*Agent\s+\((\d+(?:\.\d+)?)s\)\s*$/i,
  );
  if (!match?.[1]) {
    return 0;
  }
  return Math.round(parseFloat(match[1]) * 1000);
}

function lineStartsSubagentMission(line: ThreadActivityLine): { role: string } | null {
  const mission = parseSubagentMissionMessage(line.message);
  if (mission?.role && isSubagentRole(mission.role)) {
    return { role: mission.role };
  }
  return null;
}

function lineStartsSubagentDelegation(line: ThreadActivityLine): { role: string } | null {
  const mission = lineStartsSubagentMission(line);
  if (mission) {
    return mission;
  }

  const tool = parseToolLine(line.message);
  if (tool?.tool !== "Agent" || isAgentElapsedProgressLine(line.message)) {
    return null;
  }

  const role =
    tool.subagent ??
    missionFromAgentToolDetail(tool.detail)?.role ??
    (isSubagentRole(line.role) ? line.role : undefined);
  return role && isSubagentRole(role) ? { role } : null;
}

/** Line index bounds for one isolated sub-agent delegation (Nth run for that role). */
export function findSubagentRunLineBounds(
  lines: ThreadActivityLine[],
  role: string,
  occurrence = 0,
): { start: number; end: number } | undefined {
  const missionStarts: Array<{ index: number; role: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const run = lineStartsSubagentMission(lines[index]!);
    if (run) {
      missionStarts.push({ index, role: run.role });
    }
  }

  const missionMatches = missionStarts.filter((entry) => entry.role === role);
  if (missionMatches.length > 0) {
    const hit = missionMatches[occurrence];
    if (!hit) {
      return undefined;
    }
    const nextStart = missionStarts.find((entry) => entry.index > hit.index);
    return { start: hit.index, end: nextStart?.index ?? lines.length };
  }

  const delegationStarts: Array<{ index: number; role: string }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const run = lineStartsSubagentDelegation(lines[index]!);
    if (run) {
      delegationStarts.push({ index, role: run.role });
    }
  }

  const matching = delegationStarts.filter((entry) => entry.role === role);
  const hit = matching[occurrence];
  if (!hit) {
    return undefined;
  }

  const nextStart = delegationStarts.find((entry) => entry.index > hit.index);
  return { start: hit.index, end: nextStart?.index ?? lines.length };
}

/** Sum Agent elapsed seconds for one isolated sub-agent run window in the activity log. */
export function resolveSubagentRunDurationMs(
  lines: ThreadActivityLine[],
  role: string,
  occurrence = 0,
): number {
  const bounds = findSubagentRunLineBounds(lines, role, occurrence);
  if (!bounds) {
    return 0;
  }

  let contextRole: string | undefined = role;
  let totalMs = 0;

  for (let index = bounds.start; index < bounds.end; index += 1) {
    const line = lines[index]!;
    const mission = parseSubagentMissionMessage(line.message);
    if (mission?.role && isSubagentRole(mission.role)) {
      contextRole = mission.role;
      continue;
    }

    const tool = parseToolLine(line.message);
    if (!tool) {
      continue;
    }

    if (tool.tool === "Agent" && isAgentElapsedProgressLine(line.message)) {
      const elapsedRole =
        tool.subagent ?? (isSubagentRole(line.role) ? line.role : contextRole);
      if (elapsedRole === role) {
        totalMs += parseAgentElapsedMs(line.message);
      }
      continue;
    }

    if (tool.tool === "Agent") {
      const startRole =
        tool.subagent ??
        missionFromAgentToolDetail(tool.detail)?.role ??
        (isSubagentRole(line.role) ? line.role : contextRole);
      if (startRole && isSubagentRole(startRole)) {
        contextRole = startRole;
      }
    }
  }

  return totalMs;
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

function parseToolFailedLine(message: string): { tool: string; error?: string } | null {
  const match = stripSubagentBracketPrefix(message.trim()).match(
    /^Tool failed:\s*([A-Za-z_]+)(?:\s*·\s*(.+))?$/i,
  );
  if (!match?.[1]) {
    return null;
  }
  const error = match[2]?.trim();
  return {
    tool: match[1],
    ...(error && { error }),
  };
}

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
