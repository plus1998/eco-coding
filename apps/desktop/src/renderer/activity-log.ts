import {
  apiErrorDedupeKey,
  isGenericMissionSummary,
  isToolElapsedDuration,
  isWeakAgentToolDetail,
  mergeStreamText,
  missionFromAgentToolDetail,
  parseLegacyApiErrorActivityMessage,
  parseSubagentMissionMessage,
  type SubagentMissionPayload,
  type ThreadApiErrorInfo,
} from "@eco/runtime";

// Legacy adapter for old ThreadActivityLine-based threads. New run-state UI must use
// ThreadRunProjectionSnapshot and should not add new state/ownership inference here.
import {
  activityActionKey,
  formatMcpToolDisplayName,
  formatToolDisplayLabel,
  isMcpToolName,
  isReconnectActivityMessage,
  normalizeActivityActionLabel,
  parseReconnectActivityMessage,
  shouldClearReconnectActivity,
  stripSubagentBracketPrefix,
} from "../shared/activity-display";
import { computeSubagentSessionDurationMs } from "../shared/subagent-session-timing";
import {
  isAgentDisplayRole,
  normalizeAgentDisplayRole,
  resolveSubagentRunDisplayTitle,
} from "../shared/subagent-roles";
import type {
  ThreadActivityLine,
  ThreadActivityRewindTarget,
  ThreadStatus,
  ThreadSubagentSessionTiming,
} from "../shared/ipc";

export { resolveSubagentRunDisplayTitle, normalizeSubagentDisplayRole } from "../shared/subagent-roles";
import { isUsageNoiseMessage } from "../shared/thread-continuation";
import { parseWorktreeMergeMessage, type WorktreeMergeSummary } from "../shared/worktree-merge";

export type { WorktreeMergeSummary };

export { isReconnectActivityMessage };

export function buildSubagentTimingsByAgentId(
  sessions: readonly ThreadSubagentSessionTiming[],
): Record<string, ThreadSubagentSessionTiming> {
  const map: Record<string, ThreadSubagentSessionTiming> = {};
  for (const session of sessions) {
    map[session.agentId] = session;
  }
  return map;
}

export function buildSubagentMetricsByAgentId<T extends { agentId: string }>(
  rows: readonly T[],
): Record<string, T> {
  const map: Record<string, T> = {};
  for (const row of rows) {
    map[row.agentId] = row;
  }
  return map;
}

function resolveSubagentRunDurationMsForItem(
  agentId: string | undefined,
  role: string,
  occurrence: number,
  lines: ThreadActivityLine[],
  timingsByAgentId?: Record<string, ThreadSubagentSessionTiming>,
): number {
  if (agentId && timingsByAgentId?.[agentId]) {
    const timing = timingsByAgentId[agentId];
    return computeSubagentSessionDurationMs(timing);
  }
  if (agentId) {
    return resolveSubagentRunDurationMsByAgentId(lines, agentId);
  }
  return resolveSubagentRunDurationMs(lines, role, occurrence);
}

function resolveSubagentAgentIdFromTimings(
  role: string,
  occurrence: number,
  timingsByAgentId?: Record<string, ThreadSubagentSessionTiming>,
): string | undefined {
  if (!timingsByAgentId) {
    return undefined;
  }
  const normalizedRole = normalizeAgentDisplayRole(role) ?? role;
  const entries = Object.values(timingsByAgentId)
    .filter((entry) => (normalizeAgentDisplayRole(entry.role) ?? entry.role) === normalizedRole)
    .sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
  return entries[occurrence]?.agentId;
}

function resolveSubagentRunAgentId(
  agentId: string | undefined,
  role: string,
  occurrence: number,
  timingsByAgentId?: Record<string, ThreadSubagentSessionTiming>,
): string | undefined {
  return agentId ?? resolveSubagentAgentIdFromTimings(role, occurrence, timingsByAgentId);
}

/** Stable React key for a sub-agent run; does not change when agentId is backfilled. */
export function buildSubagentSessionKey(role: string, occurrence: number): string {
  const normalizedRole = normalizeAgentDisplayRole(role) ?? role;
  return `subagent-${normalizedRole}-${occurrence}`;
}

/** Whether a new activity line should scroll the main feed (planner/user), not sub-agent panels. */
export function shouldScrollMainActivityFeedForLine(line: Pick<ThreadActivityLine, "role"> | undefined): boolean {
  if (!line) {
    return false;
  }
  if (line.role === "user") {
    return true;
  }
  if (line.role === "planner" || line.role === "thinking") {
    return true;
  }
  if (isAgentDisplayRole(line.role)) {
    return false;
  }
  return true;
}

export type ActivityActionIcon = "search" | "file" | "edit" | "terminal" | "agent";

export type ActivityDetailBlock =
  | { kind: "phase"; label: string; reconnecting?: boolean; reconnectDetail?: string }
  | { kind: "subagent-mission"; subagent: string; summary: string; prompt?: string; agentId?: string }
  | { kind: "model-request"; role?: string }
  | { kind: "agent-request"; subagent?: string; agentId?: string }
  | { kind: "thinking"; text: string; streaming?: boolean; subagent?: string; agentId?: string }
  | { kind: "narrative"; text: string; streaming?: boolean; subagent?: string; agentId?: string }
  | { kind: "action"; icon: ActivityActionIcon; label: string; subagent?: string; agentId?: string }
  | { kind: "tool-failed"; tool: string; error?: string; subagent?: string; agentId?: string }
  | {
      kind: "api-error";
      message: string;
      statusCode?: number;
      code?: string;
      subagent?: string;
      agentId?: string;
    }
  | { kind: "worktree-merge"; summary: WorktreeMergeSummary };

export interface SubagentRunItem {
  sessionKey: string;
  agentId?: string;
  role: string;
  title: string;
  statusLine?: string;
  running: boolean;
  runDurationMs?: number;
  children: ActivityDetailBlock[];
}

export type ActivityLogBlock =
  | { kind: "user-prompt"; text: string; lineId: string; rewindTarget?: ThreadActivityRewindTarget }
  | {
      kind: "work-session";
      durationMs: number;
      running: boolean;
      defaultCollapsed: boolean;
      /** @deprecated Replaced by subagent-run-group; kept for planner inline sessions. */
      compactSubagentMode?: boolean;
      subagentRunRole?: string;
      activeSubagents?: string[];
      activeSubagent?: string;
      activeMissionSummary?: string;
      latestSubagentLogLine?: string;
      runDurationMs?: number;
      inlineContent?: boolean;
      sessionKey?: string;
      awaitingFirstToken?: boolean;
      children: ActivityDetailBlock[];
    }
  | { kind: "subagent-run-group"; parallel: boolean; items: SubagentRunItem[] }
  | {
      kind: "assistant-message";
      text: string;
      streaming?: boolean;
      subagent?: string;
    }
  | { kind: "worktree-merge"; summary: WorktreeMergeSummary; threadId?: string }
  | { kind: "surfaced-detail"; block: ActivityDetailBlock };

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

/** Remove trailing ephemeral request placeholders when a run has finished. */
export function stripTrailingPendingRequestBlocks(
  details: readonly ActivityDetailBlock[],
): ActivityDetailBlock[] {
  const result = [...details];
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last?.kind === "model-request" || last?.kind === "agent-request") {
      result.pop();
    } else {
      break;
    }
  }
  return result;
}

export function buildActivityLogBlocks(
  lines: ThreadActivityLine[],
  options: {
    status?: ThreadStatus;
    createdAt?: string;
    subagentTimingsByAgentId?: Record<string, ThreadSubagentSessionTiming>;
  },
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
  let plannerRunIndex = 0;

  for (const segment of segments) {
    for (const userLine of segment.userLines) {
      const text = userLine.message.trim();
      if (text) {
        output.push({
          kind: "user-prompt",
          text: userLine.message,
          lineId: userLine.id,
          ...(userLine.rewindTarget && { rewindTarget: userLine.rewindTarget }),
        });
      }
    }

    if (segment.details.length === 0) {
      if (isRunning && segment === segments[segments.length - 1]) {
        output.push({
          kind: "work-session",
          durationMs,
          running: true,
          defaultCollapsed: false,
          inlineContent: true,
          awaitingFirstToken: true,
          children: [{ kind: "model-request" }],
        });
      }
      continue;
    }

    const segmentDetails =
      isTerminal && !isRunning
        ? stripTrailingPendingRequestBlocks(segment.details)
        : segment.details;
    const { processBlocks, summaryBlock } = partitionSessionBlocks(
      segmentDetails,
      isTerminal && !isRunning,
    );
    const isLastSegment = segment === segments[segments.length - 1];
    const segmentRunning = isRunning && isLastSegment;

    plannerRunIndex = pushWorkSessionsFromRuns(
      output,
      partitionDetailsIntoRuns(processBlocks, {
        ...(options.subagentTimingsByAgentId && {
          subagentTimingsByAgentId: options.subagentTimingsByAgentId,
        }),
      }),
      {
        durationMs,
        segmentRunning,
        lines,
        plannerRunIndex,
        ...(options.status && { status: options.status }),
        ...(activeSubagent && { activeSubagent }),
        ...(activeMissionSummary && { activeMissionSummary }),
        ...(options.subagentTimingsByAgentId && {
          subagentTimingsByAgentId: options.subagentTimingsByAgentId,
        }),
      },
    );

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

    if (segment.worktreeMerge) {
      output.push({ kind: "worktree-merge", summary: segment.worktreeMerge });
    }
  }

  return output;
}

interface ActivitySegment {
  userLines: ThreadActivityLine[];
  details: ActivityDetailBlock[];
  worktreeMerge?: WorktreeMergeSummary;
}

function splitLinesIntoSegments(lines: ThreadActivityLine[]): ActivitySegment[] {
  const segments: ActivitySegment[] = [];
  let current: ActivitySegment = { userLines: [], details: [] };

  const pushSegment = () => {
    if (
      current.userLines.length > 0 ||
      current.details.length > 0 ||
      current.worktreeMerge
    ) {
      segments.push(current);
    }
    current = { userLines: [], details: [] };
  };

  let narrative = "";
  let narrativeStreaming = false;
  let narrativeSubagent: string | undefined;
  let narrativeAgentId: string | undefined;
  let thinking = "";
  let thinkingStreaming = false;
  let toolContextSubagent: string | undefined;
  let toolContextAgentId: string | undefined;
  const missionByRole = new Map<string, SubagentMissionPayload>();
  const recentNarratives: string[] = [];
  let lastApiErrorKey: string | undefined;

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

  const clearReconnectPhase = () => {
    for (let index = current.details.length - 1; index >= 0; index -= 1) {
      const block = current.details[index];
      if (block?.kind === "phase" && block.reconnecting) {
        current.details.splice(index, 1);
      }
    }
  };

  const upsertReconnectPhase = (label: string) => {
    const parsed = parseReconnectActivityMessage(label);
    const block: ActivityDetailBlock = {
      kind: "phase",
      label: parsed?.summary ?? label,
      reconnecting: true,
      ...(parsed?.detail && { reconnectDetail: parsed.detail }),
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
    const normalizedSubagent = subagent ? normalizeAgentDisplayRole(subagent) ?? subagent : undefined;
    const last = current.details[current.details.length - 1];
    if (last?.kind === "agent-request" && last.subagent === normalizedSubagent) {
      repositionPendingRequestBlocksToEnd();
      return;
    }
    removePendingRequestBlocks();
    current.details.push({
      kind: "agent-request",
      ...(normalizedSubagent && { subagent: normalizedSubagent }),
      ...(toolContextAgentId && { agentId: toolContextAgentId }),
    });
  };

  const flushThinking = ({ atEnd = false }: { atEnd?: boolean } = {}) => {
    const text = stripActivityStatusNoise(thinking.trim());
    const stillStreaming = thinkingStreaming && atEnd;
    if (!text && !stillStreaming) {
      thinking = "";
      thinkingStreaming = false;
      return;
    }
    if (text) {
      removePendingRequestBlocks();
    }
    const last = current.details[current.details.length - 1];
    const thinkingContext = {
      ...(toolContextSubagent && { subagent: toolContextSubagent }),
      ...(toolContextAgentId && { agentId: toolContextAgentId }),
    };
    if (text && last?.kind === "thinking" && shouldMergeThinkingBlocks(last.text, text)) {
      current.details[current.details.length - 1] = {
        kind: "thinking",
        text: mergeThinkingBlocks(last.text, text),
        ...(stillStreaming ? { streaming: true } : {}),
        ...thinkingContext,
      };
    } else {
      current.details.push({
        kind: "thinking",
        text,
        ...(stillStreaming ? { streaming: true } : {}),
        ...thinkingContext,
      });
    }
    thinking = "";
    thinkingStreaming = false;
  };

  const flushTextBuffers = (atEnd = false) => {
    flushThinking({ atEnd });
    flushNarrative({ atEnd });
  };

  const flushNarrative = ({ atEnd = false }: { atEnd?: boolean } = {}) => {
    let text = narrative.trim();
    if (!text) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      narrativeAgentId = undefined;
      return;
    }
    removePendingRequestBlocks();
    text = stripActivityStatusNoise(text);
    if (!text) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      narrativeAgentId = undefined;
      return;
    }
    const lastThinking = [...current.details]
      .reverse()
      .find((block): block is ActivityDetailBlock & { kind: "thinking" } => block.kind === "thinking");
    if (lastThinking && isNarrativeDuplicateOfThinking(text, lastThinking.text)) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      narrativeAgentId = undefined;
      return;
    }
    if (isRepeatedNarrative(text, recentNarratives)) {
      narrative = "";
      narrativeStreaming = false;
      narrativeSubagent = undefined;
      narrativeAgentId = undefined;
      return;
    }
    recentNarratives.push(normalizeNarrative(text));
    if (recentNarratives.length > 6) {
      recentNarratives.shift();
    }
    const stillStreaming = narrativeStreaming && atEnd;
    current.details.push({
      kind: "narrative",
      text,
      ...(stillStreaming ? { streaming: true } : {}),
      ...(narrativeSubagent && { subagent: narrativeSubagent }),
      ...(narrativeAgentId && { agentId: narrativeAgentId }),
    });
    narrative = "";
    narrativeStreaming = false;
    narrativeSubagent = undefined;
    narrativeAgentId = undefined;
  };

  const noteNarrativeRole = (line: ThreadActivityLine) => {
    const normalized = normalizeAgentDisplayRole(line.role);
    if (normalized) {
      narrativeSubagent = normalized;
    }
    if (line.agentId?.trim()) {
      narrativeAgentId = line.agentId.trim();
    }
  };

  const noteToolContext = (line: ThreadActivityLine) => {
    const normalized = normalizeAgentDisplayRole(line.role);
    if (normalized) {
      toolContextSubagent = normalized;
    }
    if (line.agentId?.trim()) {
      toolContextAgentId = line.agentId.trim();
    }
  };

  const pushSubagentMission = (mission: SubagentMissionPayload) => {
    removePendingRequestBlocks();
    const normalizedRole = normalizeAgentDisplayRole(mission.role) ?? mission.role;
    toolContextSubagent = normalizedRole;
    const stored = missionByRole.get(normalizedRole);
    const merged: SubagentMissionPayload = {
      role: normalizedRole,
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
          ...(toolContextAgentId && { agentId: toolContextAgentId }),
        };
        if (
          upgraded.summary === last.summary &&
          upgraded.prompt === last.prompt &&
          upgraded.agentId === last.agentId
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
      ...(toolContextAgentId && { agentId: toolContextAgentId }),
    });
  };

  const pushToolAction = (tool: ParsedToolAction, line: ThreadActivityLine) => {
    removePendingRequestBlocks();
    noteToolContext(line);
    const subagentRaw =
      tool.subagent ?? normalizeAgentDisplayRole(line.role) ?? toolContextSubagent;
    const subagent = subagentRaw ? normalizeAgentDisplayRole(subagentRaw) ?? subagentRaw : undefined;
    if (tool.tool === "Agent") {
      if (subagent) {
        toolContextSubagent = subagent;
      }
      if (isAgentElapsedProgressLine(line.message)) {
        const elapsedRole = subagent ?? toolContextSubagent;
        const hasPriorMission = current.details.some(
          (entry) =>
            entry.kind === "subagent-mission" &&
            entry.subagent === elapsedRole,
        );
        if (hasPriorMission) {
          removePendingRequestBlocks();
          current.details.push({
            kind: "phase",
            label: "子代理委派完成",
          });
        }
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
    const label = formatToolActionLabel(tool);
    const last = current.details[current.details.length - 1];
    const icon = iconForToolCategory(tool.category);
    const actionKey = activityActionKey(subagent, label, icon);
    if (
      last?.kind === "action" &&
      activityActionKey(last.subagent, last.label, last.icon) === actionKey &&
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
      icon,
      label,
      ...(subagent && { subagent }),
      ...((line.agentId?.trim() || toolContextAgentId) && {
        agentId: (line.agentId?.trim() || toolContextAgentId)!,
      }),
    });
  };

  for (const line of lines) {
    if (line.role === "user") {
      flushTextBuffers();
      if (current.details.length > 0 || current.worktreeMerge) {
        pushSegment();
      }
      current.userLines.push(line);
      continue;
    }

    if (shouldClearReconnectActivity(line)) {
      clearReconnectPhase();
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
        ...(toolContextAgentId && { agentId: toolContextAgentId }),
      });
      continue;
    }

    const apiError = resolveActivityLineApiError(line);
    if (apiError) {
      flushTextBuffers();
      removePendingRequestBlocks();
      noteToolContext(line);
      const dedupeKey = apiErrorDedupeKey(apiError);
      if (dedupeKey === lastApiErrorKey) {
        continue;
      }
      lastApiErrorKey = dedupeKey;
      const subagent = normalizeAgentDisplayRole(line.role) ?? toolContextSubagent;
      current.details.push({
        kind: "api-error",
        message: apiError.message,
        ...(apiError.statusCode !== undefined && { statusCode: apiError.statusCode }),
        ...(apiError.code && { code: apiError.code }),
        ...(subagent && { subagent }),
        ...((line.agentId?.trim() || toolContextAgentId) && {
          agentId: (line.agentId?.trim() || toolContextAgentId)!,
        }),
      });
      continue;
    }

    if (isTaskActivityLine(line)) {
      flushTextBuffers();
      removePendingRequestBlocks();
      const label = normalizeActivityActionLabel(line.message);
      const subagent = normalizeAgentDisplayRole(line.role) ?? toolContextSubagent;
      current.details.push({
        kind: "action",
        icon: "agent",
        label,
        ...(subagent && { subagent }),
        ...((line.agentId?.trim() || toolContextAgentId) && {
          agentId: (line.agentId?.trim() || toolContextAgentId)!,
        }),
      });
      continue;
    }

    if (isRedundantMcpToolProgressLine(line.message)) {
      continue;
    }

    const progressAction = parseProgressActionLine(line.message);
    if (progressAction) {
      flushNarrative();
      pushToolAction(progressAction, line);
      continue;
    }

    if (shouldHideSystemLine(line)) {
      continue;
    }

    const worktreeMerge = parseWorktreeMergeMessage(line.message);
    if (worktreeMerge) {
      flushTextBuffers();
      current.worktreeMerge = worktreeMerge;
      continue;
    }

    if (isEphemeralToolStatusLine(line.message)) {
      continue;
    }

    const tool = parseToolLine(line.message);
    if (tool) {
      flushNarrative();
      pushToolAction(tool, line);
      continue;
    }

    if (isThinkingLine(line)) {
      flushNarrative();
      const text = line.stream ? line.message : line.message.trim();
      if (line.stream) {
        thinking = mergeStreamText(thinking, text);
        thinkingStreaming = true;
      } else {
        thinking = thinking ? mergeStreamText(thinking, text) : text;
        thinkingStreaming = false;
      }
      continue;
    }

    if (isNarrativeLine(line)) {
      flushThinking();
      const mergeInLine = parseWorktreeMergeMessage(line.message);
      if (mergeInLine) {
        flushNarrative();
        current.worktreeMerge = mergeInLine;
        continue;
      }
      noteNarrativeRole(line);
      const text = line.stream ? line.message : stripSubagentBracketPrefix(line.message);
      if (line.stream) {
        narrative = mergeStreamText(narrative, text);
        narrativeStreaming = true;
      } else {
        flushNarrative();
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

  flushTextBuffers(true);
  pushSegment();
  return segments;
}

type DetailRun =
  | { kind: "planner"; blocks: ActivityDetailBlock[] }
  | { kind: "subagent"; role: string; agentId?: string; occurrence: number; blocks: ActivityDetailBlock[] };

function getBlockAgentId(block: ActivityDetailBlock): string | undefined {
  if ("agentId" in block && typeof block.agentId === "string" && block.agentId.trim()) {
    return block.agentId.trim();
  }
  return undefined;
}

function isEphemeralPlannerBlock(block: ActivityDetailBlock): boolean {
  return block.kind === "model-request" || block.kind === "agent-request";
}

function hasSubstantivePlannerContent(blocks: readonly ActivityDetailBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === "action" ||
      block.kind === "narrative" ||
      block.kind === "thinking" ||
      block.kind === "tool-failed" ||
      block.kind === "api-error" ||
      block.kind === "phase",
  );
}

/** Request failures hidden inside collapsed subagent cards — hoist to main feed. */
export function isRequestFailureDetailBlock(block: ActivityDetailBlock): boolean {
  if (block.kind === "api-error") {
    return true;
  }
  return block.kind === "phase" && Boolean(block.reconnecting);
}

export function extractSurfacedRequestFailureBlocks(
  children: readonly ActivityDetailBlock[],
): { remaining: ActivityDetailBlock[]; surfaced: ActivityDetailBlock[] } {
  const surfaced: ActivityDetailBlock[] = [];
  const remaining: ActivityDetailBlock[] = [];
  for (const block of children) {
    if (isRequestFailureDetailBlock(block)) {
      surfaced.push(block);
    } else {
      remaining.push(block);
    }
  }
  return { remaining, surfaced };
}

function getBlockSubagentRole(block: ActivityDetailBlock): string | undefined {
  let raw: string | undefined;
  if (block.kind === "subagent-mission") {
    raw = block.subagent;
  } else if (block.kind === "model-request" && block.role) {
    raw = block.role;
  } else if (
    (block.kind === "thinking" ||
      block.kind === "action" ||
      block.kind === "narrative" ||
      block.kind === "agent-request" ||
      block.kind === "tool-failed" ||
      block.kind === "api-error") &&
    block.subagent
  ) {
    raw = block.subagent;
  }
  if (!raw) {
    return undefined;
  }
  return normalizeAgentDisplayRole(raw);
}

export function partitionDetailsIntoRuns(
  details: readonly ActivityDetailBlock[],
  options?: {
    subagentTimingsByAgentId?: Record<string, ThreadSubagentSessionTiming>;
  },
): DetailRun[] {
  const runs: DetailRun[] = [];
  let plannerBlocks: ActivityDetailBlock[] = [];
  let currentRole: string | undefined;
  let currentAgentId: string | undefined;
  let subagentBlocks: ActivityDetailBlock[] = [];
  const roleOccurrences = new Map<string, number>();
  const runsByAgentId = new Map<string, Extract<DetailRun, { kind: "subagent" }>>();

  const flushPlanner = () => {
    if (plannerBlocks.length > 0) {
      runs.push({ kind: "planner", blocks: plannerBlocks });
      plannerBlocks = [];
    }
  };

  const flushLegacySubagent = () => {
    if (currentRole && subagentBlocks.length > 0) {
      const normalizedRole = normalizeAgentDisplayRole(currentRole) ?? currentRole;
      const occurrence = roleOccurrences.get(normalizedRole) ?? 0;
      runs.push({
        kind: "subagent",
        role: normalizedRole,
        ...(currentAgentId && { agentId: currentAgentId }),
        occurrence,
        blocks: subagentBlocks,
      });
      roleOccurrences.set(normalizedRole, occurrence + 1);
    }
    subagentBlocks = [];
    currentRole = undefined;
    currentAgentId = undefined;
  };

  const takeMissionOnlyPrefix = (): ActivityDetailBlock[] => {
    if (
      !currentRole ||
      subagentBlocks.length === 0 ||
      !subagentBlocks.every((entry) => entry.kind === "subagent-mission")
    ) {
      return [];
    }
    const prefix = [...subagentBlocks];
    subagentBlocks = [];
    currentRole = undefined;
    currentAgentId = undefined;
    return prefix;
  };

  const pushAgentBlock = (agentId: string, role: string, block: ActivityDetailBlock) => {
    flushPlanner();
    const normalizedRole = normalizeAgentDisplayRole(role) ?? role;
    const missionPrefix = takeMissionOnlyPrefix();
    let legacyPrefix: ActivityDetailBlock[] = [];
    if (missionPrefix.length === 0) {
      if (currentRole === normalizedRole && subagentBlocks.length > 0) {
        legacyPrefix = [...subagentBlocks];
        subagentBlocks = [];
        currentRole = undefined;
        currentAgentId = undefined;
      } else {
        flushLegacySubagent();
      }
    }
    let run = runsByAgentId.get(agentId);
    if (!run) {
      run = {
        kind: "subagent",
        role: normalizedRole,
        agentId,
        occurrence: roleOccurrences.get(normalizedRole) ?? 0,
        blocks: [...missionPrefix, ...legacyPrefix],
      };
      roleOccurrences.set(normalizedRole, (roleOccurrences.get(normalizedRole) ?? 0) + 1);
      runsByAgentId.set(agentId, run);
      runs.push(run);
    } else if (missionPrefix.length > 0 || legacyPrefix.length > 0) {
      run.blocks = [...missionPrefix, ...legacyPrefix, ...run.blocks];
    }
    run.blocks.push(block);
  };

  for (const block of details) {
    const blockAgentId = getBlockAgentId(block);
    const role = getBlockSubagentRole(block);

    if (blockAgentId && role) {
      pushAgentBlock(blockAgentId, role, block);
      continue;
    }

    if (blockAgentId) {
      const inferredRole = normalizeAgentDisplayRole(options?.subagentTimingsByAgentId?.[blockAgentId]?.role);
      if (inferredRole) {
        pushAgentBlock(blockAgentId, inferredRole, block);
        continue;
      }
      if (currentAgentId === blockAgentId && currentRole) {
        subagentBlocks.push(block);
        continue;
      }
      flushPlanner();
      flushLegacySubagent();
      continue;
    }

    if (block.kind === "subagent-mission") {
      if (currentAgentId) {
        flushLegacySubagent();
      } else if (currentRole && block.subagent === currentRole) {
        const hasPriorMission = subagentBlocks.some((entry) => entry.kind === "subagent-mission");
        const missionOnly =
          subagentBlocks.length > 0 &&
          subagentBlocks.every((entry) => entry.kind === "subagent-mission");
        if (hasPriorMission && !missionOnly) {
          flushLegacySubagent();
        }
      } else if (currentRole && block.subagent !== currentRole) {
        flushLegacySubagent();
      } else if (!currentRole) {
        flushPlanner();
      }
      currentRole = block.subagent;
      subagentBlocks.push(block);
      continue;
    }

    if (role) {
      if (currentAgentId) {
        flushLegacySubagent();
      } else if (currentRole && role !== currentRole) {
        flushLegacySubagent();
      } else if (!currentRole) {
        flushPlanner();
      }
      currentRole = role;
      subagentBlocks.push(block);
      continue;
    }

    if (currentRole && block.kind === "phase") {
      subagentBlocks.push(block);
      continue;
    }

    if (currentRole && isEphemeralPlannerBlock(block)) {
      continue;
    }

    flushLegacySubagent();
    plannerBlocks.push(block);
  }

  flushLegacySubagent();
  flushPlanner();
  return runs;
}

/** Mission / task summary for expanded details (not the card primary title). */
export function resolveSubagentRunTitle(
  children: readonly ActivityDetailBlock[],
  role: string,
): string {
  for (const block of children) {
    if (block.kind === "subagent-mission") {
      const summary = block.summary.trim();
      if (summary) {
        return summary;
      }
    }
  }
  return isAgentDisplayRole(role) ? resolveSubagentRunDisplayTitle(role) : "子代理任务";
}

/** Subtitle for compact sub-agent cards; avoids repeating the mission summary. */
export function resolveSubagentRunStatusLine(
  children: readonly ActivityDetailBlock[],
  role: string,
  missionSummary?: string,
): string | undefined {
  const missionText =
    missionSummary?.trim() ||
    children
      .filter((block): block is Extract<ActivityDetailBlock, { kind: "subagent-mission" }> => block.kind === "subagent-mission")
      .map((block) => block.summary.trim())
      .find(Boolean);

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const block = children[index];
    if (block?.kind === "action" && block.subagent === role) {
      const line = clampSubagentLogLine(block.label);
      if (line && line !== missionText) {
        return line;
      }
    }
    if (block?.kind === "tool-failed" && block.subagent === role) {
      const detail = block.error?.trim();
      const line = clampSubagentLogLine(
        detail ? `${block.tool} 失败：${detail}` : `${block.tool} 失败`,
      );
      if (line) {
        return line;
      }
    }
    if (block?.kind === "api-error" && block.subagent === role) {
      const line = clampSubagentLogLine(block.message);
      if (line) {
        return line;
      }
    }
    if (block?.kind === "narrative" && block.subagent === role) {
      const text = block.text.trim();
      if (text) {
        const firstLine = text.split("\n").find((entry) => entry.trim())?.trim() ?? text;
        const line = clampSubagentLogLine(firstLine);
        if (line && line !== missionText) {
          return line;
        }
      }
    }
    if (block?.kind === "agent-request" && block.subagent === role) {
      return "处理中…";
    }
  }

  const fallback = resolveLatestSubagentLogLine(children, missionSummary);
  if (!fallback || fallback === missionText || fallback === resolveSubagentRunDisplayTitle(role)) {
    return missionText ? clampSubagentLogLine(missionText) : undefined;
  }
  return fallback;
}

export function findSubagentRunLineBoundsByAgentId(
  lines: ThreadActivityLine[],
  agentId: string,
): { start: number; end: number } | undefined {
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.agentId === agentId) {
      if (start < 0) {
        start = index;
      }
    }
  }
  if (start < 0) {
    return undefined;
  }
  return { start, end: lines.length };
}

export function resolveSubagentRunOpen(
  lines: ThreadActivityLine[],
  input: { role: string; occurrence?: number; agentId?: string },
  segmentRunning: boolean,
): boolean {
  if (!segmentRunning) {
    return false;
  }

  if (input.agentId) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line?.agentId === input.agentId && line.stream) {
        return true;
      }
    }
    const bounds = findSubagentRunLineBoundsByAgentId(lines, input.agentId);
    if (!bounds) {
      return false;
    }
    const openRoles = resolveActiveSubagents(lines, "running");
    return openRoles.includes(input.role);
  }

  const bounds = findSubagentRunLineBounds(lines, input.role, input.occurrence ?? 0);
  if (!bounds) {
    const last = lines[lines.length - 1];
    return segmentRunning && last?.role === input.role && Boolean(last.stream);
  }
  for (let index = bounds.end - 1; index >= bounds.start; index -= 1) {
    const line = lines[index];
    if (line?.stream && line.role === input.role) {
      return true;
    }
  }
  const openRoles = resolveActiveSubagents(lines, "running");
  const openCount = openRoles.filter((entry) => entry === input.role).length;
  if (openCount <= 0) {
    return false;
  }
  const completedBeforeEnd = lines
    .slice(bounds.start, lines.length)
    .filter((line) => isAgentElapsedProgressLine(line.message)).length;
  const startedBeforeEnd = lines
    .slice(bounds.start, lines.length)
    .filter((line) => lineStartsSubagentDelegation(line)?.role === input.role).length;
  return completedBeforeEnd < startedBeforeEnd;
}

export function runsOverlapAtSegmentEnd(
  a: SubagentRunItem,
  b: SubagentRunItem,
  segmentRunning: boolean,
): boolean {
  if (!segmentRunning) {
    return false;
  }
  return a.running && b.running;
}

export function groupSubagentRunItems(
  items: readonly SubagentRunItem[],
  segmentRunning: boolean,
): Array<{ parallel: boolean; items: SubagentRunItem[] }> {
  if (items.length === 0) {
    return [];
  }

  const groups: Array<{ parallel: boolean; items: SubagentRunItem[] }> = [];
  let batch: SubagentRunItem[] = [];

  for (const item of items) {
    if (batch.length === 0) {
      batch.push(item);
      continue;
    }
    const overlaps = batch.some((existing) => runsOverlapAtSegmentEnd(existing, item, segmentRunning));
    if (overlaps) {
      batch.push(item);
      continue;
    }
    groups.push({
      parallel: batch.length > 1 && batch.every((entry) => entry.running),
      items: batch,
    });
    batch = [item];
  }

  if (batch.length > 0) {
    groups.push({
      parallel: batch.length > 1 && batch.every((entry) => entry.running),
      items: batch,
    });
  }

  return groups;
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
    subagentTimingsByAgentId?: Record<string, ThreadSubagentSessionTiming>;
    plannerRunIndex: number;
  },
): number {
  const hasSubagentRuns = runs.some((run) => run.kind === "subagent");
  let plannerRunIndex = options.plannerRunIndex;
  const pendingSubagentItems: SubagentRunItem[] = [];
  const pendingMissionRuns: Extract<DetailRun, { kind: "subagent" }>[] = [];

  const flushSubagentGroups = () => {
    if (pendingSubagentItems.length === 0) {
      return;
    }
    for (const group of groupSubagentRunItems(pendingSubagentItems, options.segmentRunning)) {
      const surfacedBlocks: ActivityDetailBlock[] = [];
      const items = group.items.map((item) => {
        const extracted = extractSurfacedRequestFailureBlocks(item.children);
        surfacedBlocks.push(...extracted.surfaced);
        const remaining = extracted.remaining;
        const statusLine = resolveSubagentRunStatusLine(remaining, item.role) ?? item.statusLine;
        return {
          ...item,
          children: remaining,
          ...(statusLine && { statusLine }),
        };
      });
      for (const surfaced of surfacedBlocks) {
        output.push({ kind: "surfaced-detail", block: surfaced });
      }
      output.push({
        kind: "subagent-run-group",
        parallel: group.parallel,
        items,
      });
    }
    pendingSubagentItems.length = 0;
    pendingMissionRuns.length = 0;
  };

  const isMissionOnlyRun = (run: Extract<DetailRun, { kind: "subagent" }>): boolean =>
    !run.agentId &&
    run.blocks.length > 0 &&
    run.blocks.every((block) => block.kind === "subagent-mission");

  const takeMissionPrecursor = (
    run: Extract<DetailRun, { kind: "subagent" }>,
  ): Extract<DetailRun, { kind: "subagent" }> | undefined => {
    const index = pendingMissionRuns.findIndex((precursor) =>
      run.agentId
        ? precursor.agentId === run.agentId
        : precursor.role === run.role && !precursor.agentId,
    );
    if (index < 0) {
      return undefined;
    }
    return pendingMissionRuns.splice(index, 1)[0];
  };

  const mergeMissionPrecursor = (
    run: Extract<DetailRun, { kind: "subagent" }>,
  ): Extract<DetailRun, { kind: "subagent" }> => {
    const precursor = takeMissionPrecursor(run);
    if (!precursor) {
      return run;
    }
    return {
      ...run,
      ...(precursor.agentId && !run.agentId && { agentId: precursor.agentId }),
      blocks: [...precursor.blocks, ...run.blocks],
    };
  };

  const upsertSubagentItem = (item: SubagentRunItem): void => {
    const mergeInto = (existingIndex: number): void => {
      const existing = pendingSubagentItems[existingIndex]!;
      const mergedChildren = [...existing.children, ...item.children];
      const mergedDuration = Math.max(existing.runDurationMs ?? 0, item.runDurationMs ?? 0);
      const agentId = item.agentId ?? existing.agentId;
      const statusLine =
        resolveSubagentRunStatusLine(mergedChildren, existing.role) ??
        item.statusLine ??
        existing.statusLine;
      pendingSubagentItems[existingIndex] = {
        ...existing,
        ...item,
        sessionKey: existing.sessionKey,
        running: existing.running || item.running,
        children: mergedChildren,
        ...(agentId && { agentId }),
        ...(statusLine && { statusLine }),
        ...(mergedDuration > 0 && { runDurationMs: mergedDuration }),
      };
    };

    const bySessionKey = pendingSubagentItems.findIndex((entry) => entry.sessionKey === item.sessionKey);
    if (bySessionKey >= 0) {
      mergeInto(bySessionKey);
      return;
    }

    if (item.agentId) {
      const byAgentId = pendingSubagentItems.findIndex((entry) => entry.agentId === item.agentId);
      if (byAgentId >= 0) {
        mergeInto(byAgentId);
        return;
      }
    }

    pendingSubagentItems.push(item);
  };

  const mergeMissionOnlyRunIntoItems = (
    missionRun: Extract<DetailRun, { kind: "subagent" }>,
  ): boolean => {
    if (!isMissionOnlyRun(missionRun)) {
      return false;
    }
    const role = missionRun.role;
    for (let index = pendingSubagentItems.length - 1; index >= 0; index -= 1) {
      const entry = pendingSubagentItems[index];
      if (!entry || entry.role !== role) {
        continue;
      }
      if (
        missionRun.agentId &&
        entry.agentId &&
        missionRun.agentId !== entry.agentId
      ) {
        continue;
      }
      const mergedChildren = [...entry.children, ...missionRun.blocks];
      const statusLine = resolveSubagentRunStatusLine(mergedChildren, role) ?? entry.statusLine;
      pendingSubagentItems[index] = {
        ...entry,
        ...(missionRun.agentId && !entry.agentId && { agentId: missionRun.agentId }),
        children: mergedChildren,
        ...(statusLine && { statusLine }),
      };
      return true;
    }
    return false;
  };

  const buildItemFromRun = (
    run: Extract<DetailRun, { kind: "subagent" }>,
    segmentRunning: boolean,
  ): SubagentRunItem | undefined => {
    if (isMissionOnlyRun(run)) {
      if (mergeMissionOnlyRunIntoItems(run)) {
        return undefined;
      }
      const agentId = resolveSubagentRunAgentId(
        run.agentId,
        run.role,
        run.occurrence,
        options.subagentTimingsByAgentId,
      );
      const completedDurationMs = resolveSubagentRunDurationMsForItem(
        agentId,
        run.role,
        run.occurrence,
        options.lines,
        options.subagentTimingsByAgentId,
      );
      if (completedDurationMs > 0 && agentId) {
        const role = run.role;
        const title = resolveSubagentRunDisplayTitle(role);
        const statusLine = resolveSubagentRunStatusLine(run.blocks, role);
        return {
          sessionKey: buildSubagentSessionKey(role, run.occurrence),
          role,
          title,
          running: false,
          agentId,
          ...(statusLine && { statusLine }),
          runDurationMs: completedDurationMs,
          children: run.blocks,
        };
      }
      pendingMissionRuns.push(
        agentId && !run.agentId ? { ...run, agentId } : run,
      );
      return undefined;
    }

    const mergedRun = mergeMissionPrecursor(run);
    const role = mergedRun.role;
    const agentId = resolveSubagentRunAgentId(
      mergedRun.agentId,
      role,
      mergedRun.occurrence,
      options.subagentTimingsByAgentId,
    );
    const running = resolveSubagentRunOpen(
      options.lines,
      { role, occurrence: mergedRun.occurrence, ...(agentId && { agentId }) },
      segmentRunning,
    );
    const title = resolveSubagentRunDisplayTitle(role);
    const statusLine = resolveSubagentRunStatusLine(
      mergedRun.blocks,
      role,
      options.activeSubagent === role ? options.activeMissionSummary : undefined,
    );
    const runDurationMs = resolveSubagentRunDurationMsForItem(
      agentId,
      role,
      mergedRun.occurrence,
      options.lines,
      options.subagentTimingsByAgentId,
    );
    const sessionKey = buildSubagentSessionKey(role, mergedRun.occurrence);

    return {
      sessionKey,
      role,
      title,
      running,
      ...(agentId && { agentId }),
      ...(statusLine && { statusLine }),
      ...(runDurationMs > 0 && { runDurationMs }),
      children: mergedRun.blocks,
    };
  };

  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (!run) {
      continue;
    }
    const isLastRun = index === runs.length - 1;
    const segmentActive = options.segmentRunning && isLastRun;

    if (run.kind === "planner") {
      flushSubagentGroups();
      if (run.blocks.length === 0) {
        continue;
      }
      if (hasSubagentRuns && !hasSubstantivePlannerContent(run.blocks)) {
        continue;
      }
      const running = segmentActive;
      const awaitingFirstToken = running && sessionAwaitingFirstToken(run.blocks, undefined);
      output.push({
        kind: "work-session",
        durationMs: options.durationMs,
        running,
        defaultCollapsed: false,
        inlineContent: true,
        sessionKey: `planner-${plannerRunIndex}`,
        ...(awaitingFirstToken && { awaitingFirstToken }),
        children: run.blocks,
      });
      plannerRunIndex += 1;
      continue;
    }

    const item = buildItemFromRun(run, options.segmentRunning);
    if (item) {
      upsertSubagentItem(item);
    }
  }

  while (pendingMissionRuns.length > 0) {
    const missionRun = pendingMissionRuns.shift();
    if (!missionRun) {
      continue;
    }
    if (mergeMissionOnlyRunIntoItems(missionRun)) {
      continue;
    }
    if (
      isMissionOnlyRun(missionRun) &&
      !missionRun.agentId &&
      pendingSubagentItems.some((entry) => entry.role === missionRun.role)
    ) {
      continue;
    }
    const role = missionRun.role;
    const agentId = resolveSubagentRunAgentId(
      missionRun.agentId,
      role,
      missionRun.occurrence,
      options.subagentTimingsByAgentId,
    );
    const title = resolveSubagentRunDisplayTitle(role);
    const statusLine = resolveSubagentRunStatusLine(missionRun.blocks, role);
    const runDurationMs = resolveSubagentRunDurationMsForItem(
      agentId,
      role,
      missionRun.occurrence,
      options.lines,
      options.subagentTimingsByAgentId,
    );
    upsertSubagentItem({
      sessionKey: buildSubagentSessionKey(role, missionRun.occurrence),
      role,
      title,
      ...(agentId && { agentId }),
      running: resolveSubagentRunOpen(
        options.lines,
        {
          role,
          occurrence: missionRun.occurrence,
          ...(agentId && { agentId }),
        },
        options.segmentRunning,
      ),
      ...(statusLine && { statusLine }),
      ...(runDurationMs > 0 && { runDurationMs }),
      children: missionRun.blocks,
    });
  }

  flushSubagentGroups();
  return plannerRunIndex;
}

function resolveSubagentRunDurationMsByAgentId(lines: ThreadActivityLine[], agentId: string): number {
  const bounds = findSubagentRunLineBoundsByAgentId(lines, agentId);
  if (!bounds) {
    return 0;
  }

  let totalMs = 0;
  for (let index = bounds.start; index < bounds.end; index += 1) {
    const line = lines[index];
    if (!line || line.agentId !== agentId) {
      continue;
    }
    if (isAgentElapsedProgressLine(line.message)) {
      totalMs += parseAgentElapsedMs(line.message);
    }
  }
  return totalMs;
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

export function shouldMergeThinkingBlocks(previous: string, next: string): boolean {
  const prev = previous.trim();
  const nextTrim = next.trim();
  if (!prev || !nextTrim) {
    return false;
  }
  return nextTrim.startsWith(prev) || prev.startsWith(nextTrim);
}

export function mergeThinkingBlocks(previous: string, next: string): string {
  const prev = previous.trim();
  const nextTrim = next.trim();
  if (nextTrim.startsWith(prev)) {
    return nextTrim;
  }
  if (prev.startsWith(nextTrim)) {
    return prev;
  }
  return `${prev}\n\n${nextTrim}`;
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

/** Single-line preview for collapsed thinking blocks. */
export function thinkingPreviewLine(text: string, max = 120): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return clampSubagentLogLine(plain, max);
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
    if (block.kind === "api-error" && block.subagent) {
      return clampSubagentLogLine(block.message);
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
      block.kind === "tool-failed" ||
      block.kind === "api-error"
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
    const lineAgentRole = normalizeAgentDisplayRole(line.role);
    if (lineAgentRole && line.stream) {
      openByRole.set(lineAgentRole, Math.max(openByRole.get(lineAgentRole) ?? 0, 1));
    }

    const tool = parseToolLine(line.message);
    if (tool?.tool !== "Agent") {
      continue;
    }

    if (isAgentElapsedProgressLine(line.message)) {
      const role = normalizeAgentDisplayRole(tool.subagent) ?? lineAgentRole ?? contextSubagent;
      if (role) {
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
      normalizeAgentDisplayRole(tool.subagent) ??
      normalizeAgentDisplayRole(legacy?.role) ??
      lineAgentRole ??
      contextSubagent;
    if (role) {
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
    const lineAgentRole = normalizeAgentDisplayRole(line.role);
    if (lineAgentRole) {
      return lineAgentRole;
    }
    const tool = parseToolLine(line.message);
    if (tool?.category === "agent" && tool.subagent) {
      return normalizeAgentDisplayRole(tool.subagent) ?? tool.subagent;
    }
    if (line.message.includes("【") && line.message.includes("】")) {
      const match = line.message.match(/【([^】]+)】/);
      if (match?.[1]) {
        const inner = match[1];
        const roleMatch = inner.match(/\(([^)]+)\)\s*$/);
        if (roleMatch?.[1] && !isToolElapsedDuration(roleMatch[1])) {
          return normalizeAgentDisplayRole(roleMatch[1]) ?? roleMatch[1];
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
  const role = normalizeAgentDisplayRole(mission?.role);
  if (role) {
    return { role };
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
    normalizeAgentDisplayRole(tool.subagent) ??
    normalizeAgentDisplayRole(missionFromAgentToolDetail(tool.detail)?.role) ??
    normalizeAgentDisplayRole(line.role);
  return role ? { role } : null;
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
  const normalizedTargetRole = normalizeAgentDisplayRole(role) ?? role;
  let totalMs = 0;

  for (let index = bounds.start; index < bounds.end; index += 1) {
    const line = lines[index]!;
    const mission = parseSubagentMissionMessage(line.message);
    const missionRole = normalizeAgentDisplayRole(mission?.role);
    if (missionRole) {
      contextRole = missionRole;
      continue;
    }

    const tool = parseToolLine(line.message);
    if (!tool) {
      continue;
    }

    if (tool.tool === "Agent" && isAgentElapsedProgressLine(line.message)) {
      const elapsedRole =
        normalizeAgentDisplayRole(tool.subagent) ?? normalizeAgentDisplayRole(line.role) ?? contextRole;
      if (elapsedRole === normalizedTargetRole) {
        totalMs += parseAgentElapsedMs(line.message);
      }
      continue;
    }

    if (tool.tool === "Agent") {
      const startRole: string | undefined =
        normalizeAgentDisplayRole(tool.subagent) ??
        normalizeAgentDisplayRole(missionFromAgentToolDetail(tool.detail)?.role) ??
        normalizeAgentDisplayRole(line.role) ??
        contextRole;
      if (startRole) {
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

function isRedundantMcpToolProgressLine(message: string): boolean {
  const stripped = stripSubagentBracketPrefix(message.trim());
  return /^Tool:\s*mcp_tool\s+\(\d+(?:\.\d+)?s\)\s*$/i.test(stripped);
}

function actionTargetFromLabel(label: string): string {
  return label.trim();
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
  const priorTarget = actionTargetFromLabel(prior.label);
  const nextTarget = tool.detail?.trim() ?? actionTargetFromLabel(nextLabel);
  const priorGenericLabel = formatToolActionLabel({ tool: tool.tool, category: tool.category });
  if (prior.label === priorGenericLabel && nextTarget && prior.label !== nextLabel) {
    return {
      kind: "action",
      icon: iconForToolCategory(tool.category),
      label: nextLabel,
      ...(subagent && { subagent }),
      ...(prior.agentId && { agentId: prior.agentId }),
    };
  }
  if (!priorTarget || !nextTarget || priorTarget !== nextTarget) {
    return null;
  }
  const priorIsRead = prior.icon === "file";
  const nextIsSearch = tool.tool === "Grep" || tool.tool === "Glob";
  if (priorIsRead && nextIsSearch) {
    return {
      kind: "action",
      icon: iconForToolCategory(tool.category),
      label: nextLabel,
      ...(subagent && { subagent }),
      ...(prior.agentId && { agentId: prior.agentId }),
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

const TOOL_LINE_PATTERN =
  /^Tool:\s*([A-Za-z0-9_]+)(?:\s*·\s*(.+?)|\s+(\(\d+(?:\.\d+)?s\)))?\s*$/;

function resolveActivityLineApiError(line: ThreadActivityLine): ThreadApiErrorInfo | null {
  if (line.apiError?.message?.trim()) {
    return line.apiError;
  }
  return parseLegacyApiErrorActivityMessage(line.message);
}

function parseToolFailedLine(message: string): { tool: string; error?: string } | null {
  const match = stripSubagentBracketPrefix(message.trim()).match(
    /^Tool failed:\s*([A-Za-z0-9_]+)(?:\s*·\s*(.+))?$/i,
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
  const match = message.trim().match(TOOL_LINE_PATTERN);
  if (!match) {
    return null;
  }

  const tool = match[1] ?? "";
  if (!tool) {
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
  const subagentRaw =
    rawSubagent && !isToolElapsedDuration(rawSubagent) ? rawSubagent : undefined;
  const subagent = subagentRaw ? normalizeAgentDisplayRole(subagentRaw) ?? subagentRaw : undefined;
  return {
    tool,
    ...(detail && { detail }),
    ...(subagent && { subagent }),
    category: categorizeTool(tool),
  };
}

function categorizeTool(tool: string): ParsedToolAction["category"] {
  if (tool === "Agent" || tool.startsWith("Task") || tool === "TodoWrite") {
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

const PROGRESS_ACTION_PATTERNS: Array<{
  pattern: RegExp;
  tool: string;
  category: ParsedToolAction["category"];
}> = [
  { pattern: /^Reading\s+(.+?)(?:\s*·\s*Read)?\s*$/i, tool: "Read", category: "read" },
  { pattern: /^Writing\s+(.+?)(?:\s*·\s*Write)?\s*$/i, tool: "Write", category: "edit" },
  { pattern: /^Editing\s+(.+?)(?:\s*·\s*Edit)?\s*$/i, tool: "Edit", category: "edit" },
  { pattern: /^Searching\s+(.+?)(?:\s*·\s*Grep)?\s*$/i, tool: "Grep", category: "search" },
  { pattern: /^Running\s+(.+?)(?:\s*·\s*Bash)?\s*$/i, tool: "Bash", category: "run" },
];

function parseProgressActionLine(message: string): ParsedToolAction | null {
  const stripped = stripSubagentBracketPrefix(message.trim());
  if (!stripped) {
    return null;
  }

  if (stripped.startsWith("Tool:")) {
    const toolLine = parseToolLine(stripped);
    if (toolLine) {
      return toolLine;
    }
  }

  for (const { pattern, tool, category } of PROGRESS_ACTION_PATTERNS) {
    const match = stripped.match(pattern);
    if (match?.[1]) {
      return { tool, detail: match[1].trim(), category };
    }
  }

  return null;
}

function formatToolActionLabel(tool: ParsedToolAction): string {
  return formatToolDisplayLabel(tool.tool, tool.detail);
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

export function iconForToolName(toolName: string): ActivityActionIcon {
  return iconForToolCategory(categorizeTool(toolName));
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
