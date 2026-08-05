import {
  isSubagentMissionEnvelope,
  parseSubagentMissionMessage,
  resolveMissionDisplayText,
} from "@eco/runtime/agent-mission";
import {
  bashApprovalPhaseToLifecycle,
  clampActivityPreviewLine,
  compareToolActionLifecyclePriority,
  formatToolDisplayLabel,
  formatToolStatusPreview,
  isToolProgressStatusText,
  readBashApprovalMetadata,
  resolveBashRunCardDisplay,
  resolveFileChangeCardDisplay,
  type ToolActionLifecycle,
  toolStatusToLifecycle,
} from "../shared/activity-display";
import { parseThreadRunFileChangeMetadata } from "../shared/file-change";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadRunToolMetadata,
} from "../shared/ipc";
import {
  collapsePromptCacheTimelineItems,
  readPromptCacheTimelineMetadata,
} from "../shared/prompt-cache-timeline";
import {
  type PromptImagePreview,
  readPromptImagePreviews,
} from "../shared/prompt-image-metadata";
import { normalizeAgentDisplayRole } from "../shared/subagent-roles";
import {
  isReconnectActivityOrigin,
  isRequestFailureFeedNoiseOrigin,
  isTimelineItemSupersededByRecovery,
  isUpstreamErrorPhaseOrigin,
  resolveReconnectPhaseDisplay,
  resolveThreadActivityOrigin,
} from "../shared/thread-activity-origin";
import { i18n } from "./i18n";
import {
  isRecordedUserPromptLiveEvent,
  isThreadFollowUpActivityMessage,
  isThreadFollowUpLiveEvent,
} from "../shared/thread-follow-up-events";
import {
  formatThreadRunToolDetailLabel,
  parseThreadRunGrepToolTarget,
  parseThreadRunReadToolTarget,
  resolveGrepToolTargetDisplayFromToolMetadata,
  resolveReadToolTargetDisplayFromToolMetadata,
} from "../shared/tool-target";
import { type ActivityDetailBlock, iconForToolName, resolveSubagentRunDisplayTitle } from "./activity-log";
import type { RuntimeAgentDisplayNames } from "./runtime-agent-display";

export interface ThreadRunProjectionViewModel {
  showThreadPrompt: boolean;
  mainFeedEntries: ThreadRunProjectionMainFeedEntry[];
  mainItemIds: string[];
  subagentCards: ThreadRunProjectionSubagentCard[];
}

export type ThreadRunProjectionTimelineFeedEntry = {
  kind: "timeline";
  key: string;
  item: ThreadRunProjectionTimelineItem;
  at: string;
  sequence: number;
};

export type ThreadRunProjectionAgentEchoFeedEntry = {
  kind: "agent-echo";
  key: string;
  item: ThreadRunProjectionTimelineItem;
  agent: ThreadRunProjectionAgent;
  agentLabel: string;
  at: string;
  sequence: number;
};

export type ThreadRunProjectionToolGroupFeedEntry = {
  kind: "tool-group";
  key: string;
  entries: Array<ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionAgentEchoFeedEntry>;
  at: string;
  sequence: number;
};

export type ThreadRunProjectionMainFeedEntry =
  | ThreadRunProjectionTimelineFeedEntry
  | ThreadRunProjectionAgentEchoFeedEntry
  | ThreadRunProjectionToolGroupFeedEntry
  | {
      kind: "agent-card";
      key: string;
      card: ThreadRunProjectionSubagentCard;
      at: string;
      sequence: number;
    };

export interface ThreadRunProjectionSubagentCard {
  key: string;
  agent: ThreadRunProjectionAgent;
  timelineIds: string[];
  running: boolean;
  statusText?: string;
  /** Resolved from the full agent timeline before display filtering. */
  missionText: string;
  /** Images submitted with the user prompt that started a vision subagent. */
  promptImages?: PromptImagePreview[];
}

export function buildThreadRunProjectionViewModel(
  projection: ThreadRunProjectionSnapshot,
  thread?: { id: string; prompt: string },
  options: {
    agentDisplayNames?: RuntimeAgentDisplayNames | undefined;
  } = {},
): ThreadRunProjectionViewModel {
  void options;
  const hasProjectedUserPrompt = projection.timeline.some(isProjectionUserPromptItem);
  const showThreadPrompt = Boolean(thread?.prompt.trim() && !hasProjectedUserPrompt);
  const requestSpansById = buildDisplayRequestSpansById(projection);
  const subagentCards = projection.agents
    .filter((agent) => agent.kind === "subagent")
    .map((agent) => {
      const displayTimeline = filterProjectionTimelineForDetailFeed(agent.timeline, requestSpansById);
      const displayAgent: ThreadRunProjectionAgent = { ...agent, timeline: displayTimeline };
      const statusText = resolveProjectionAgentStatusText(displayAgent);
      const missionText = resolveSubagentCardMissionText(agent, {
        mainTimeline: projection.timeline,
      });
      return {
        key: agent.agentId,
        agent: displayAgent,
        timelineIds: displayTimeline.map((item) => item.id),
        running: agent.status === "active" || agent.status === "launching",
        missionText,
        promptImages: resolveSubagentPromptImages(agent, projection.timeline),
        ...(statusText && { statusText }),
      };
    });
  const mainFeedEntries = buildProjectionMainFeedEntries(
    projection.timeline,
    subagentCards,
    requestSpansById,
  );
  return {
    showThreadPrompt,
    mainFeedEntries,
    mainItemIds: mainFeedEntries.map((entry) => {
      if (entry.kind === "timeline" || entry.kind === "agent-echo") {
        return entry.item.id;
      }
      if (entry.kind === "tool-group") {
        return entry.entries.map((child) => child.item.id).join(",");
      }
      return entry.key;
    }),
    subagentCards,
  };
}

function resolveSubagentPromptImages(
  agent: ThreadRunProjectionAgent,
  mainTimeline: readonly ThreadRunProjectionTimelineItem[],
): PromptImagePreview[] {
  if (normalizeAgentDisplayRole(agent.role) !== "vision") {
    return [];
  }
  for (let index = mainTimeline.length - 1; index >= 0; index -= 1) {
    const item = mainTimeline[index];
    if (!item || !isProjectionUserPromptItem(item)) {
      continue;
    }
    if (agent.startedAt && item.at && item.at > agent.startedAt) {
      continue;
    }
    return readPromptImagePreviews(item.metadata);
  }
  return [];
}

function buildDisplayRequestSpansById(
  projection: ThreadRunProjectionSnapshot,
): Map<string, ThreadRunProjectionSnapshot["requestSpans"][number]> {
  const terminalStatus = resolveTerminalDisplayRequestStatus(projection.thread.status);
  const endedAt = projection.thread.generatedAt;
  return new Map(
    projection.requestSpans.map((span) => {
      if (!terminalStatus || !isProjectionRequestActive(span)) {
        return [span.requestId, span];
      }
      return [
        span.requestId,
        {
          ...span,
          status: terminalStatus,
          endedAt: span.endedAt ?? endedAt,
        },
      ];
    }),
  );
}

function resolveTerminalDisplayRequestStatus(
  threadStatus: string,
): ThreadRunProjectionSnapshot["requestSpans"][number]["status"] | undefined {
  switch (threadStatus) {
    case "completed":
      return "completed";
    case "failed":
    case "blocked":
      return "failed";
    case "idle":
    case "awaiting_plan":
    case "cancelled":
      return "cancelled";
    default:
      return undefined;
  }
}

function buildProjectionMainFeedEntries(
  mainTimeline: readonly ThreadRunProjectionTimelineItem[],
  subagentCards: readonly ThreadRunProjectionSubagentCard[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionMainFeedEntry[] {
  const displayMainTimeline = filterAbsorbedSubagentDelegations(
    filterMainTimelineForFeed(mainTimeline, requestSpansById),
    subagentCards,
    requestSpansById,
  );
  const toolSortAnchors = buildToolLifecycleSortAnchors([
    ...mainTimeline,
    ...subagentCards.flatMap((card) => card.agent.timeline),
  ]);
  const entries: Array<Exclude<ThreadRunProjectionMainFeedEntry, ThreadRunProjectionToolGroupFeedEntry>> =
    displayMainTimeline.map((item) => {
      const sortAnchor = resolveFeedEntrySortAnchor(item, toolSortAnchors);
      return {
        kind: "timeline",
        key: projectionMainFeedEntryKey(item, { requestSpansById, timeline: mainTimeline }),
        item,
        at: sortAnchor.at,
        sequence: sortAnchor.sequence,
      };
    });

  for (const card of subagentCards) {
    const cardSortAnchor = { at: card.agent.startedAt, sequence: card.agent.timeline[0]?.sequence ?? 0 };
    entries.push({
      kind: "agent-card",
      key: `agent-card:${card.agent.agentId}`,
      card,
      at: cardSortAnchor.at,
      sequence: cardSortAnchor.sequence,
    });
  }

  return groupProjectionToolFeedEntries(
    entries.sort((left, right) => compareMainFeedEntries(left, right, requestSpansById)),
  );
}

function groupProjectionToolFeedEntries(
  entries: readonly Exclude<ThreadRunProjectionMainFeedEntry, ThreadRunProjectionToolGroupFeedEntry>[],
): ThreadRunProjectionMainFeedEntry[] {
  const grouped: ThreadRunProjectionMainFeedEntry[] = [];
  let pending: Array<ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionAgentEchoFeedEntry> = [];

  const flush = () => {
    const first = pending[0];
    if (!first) {
      pending = [];
      return;
    }
    grouped.push({
      kind: "tool-group",
      // Keep the group mounted while adjacent tool events are appended so its
      // user-controlled expanded state is not reset by a changing React key.
      key: `tool-group:${first.key}`,
      entries: pending,
      at: first.at,
      sequence: first.sequence,
    });
    pending = [];
  };

  for (const entry of entries) {
    if (isGroupableToolFeedEntry(entry)) {
      pending.push(entry);
      continue;
    }
    flush();
    grouped.push(entry);
  }
  flush();
  return grouped;
}

function isGroupableToolFeedEntry(
  entry: Exclude<ThreadRunProjectionMainFeedEntry, ThreadRunProjectionToolGroupFeedEntry>,
): entry is ThreadRunProjectionTimelineFeedEntry | ThreadRunProjectionAgentEchoFeedEntry {
  if (entry.kind !== "timeline" && entry.kind !== "agent-echo") {
    return false;
  }
  const block = projectionItemToDetailBlock(entry.item);
  return block?.kind === "action" || block?.kind === "tool-failed";
}

function filterMainTimelineForFeed(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem[] {
  const displayTimeline = filterProjectionTimelineForDetailFeed(timeline, requestSpansById);
  const requestFiltered = displayTimeline.filter((item) => !isMainTimelineNoiseItem(item, displayTimeline));
  return filterCompactionTimelineForFeed(normalizePlanDismissalTimeline(requestFiltered));
}

function normalizePlanDismissalTimeline(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const normalized: ThreadRunProjectionTimelineItem[] = [];
  for (const item of timeline) {
    if (!isPlanDismissalText(item.text)) {
      normalized.push(item);
      continue;
    }
    if (normalized.at(-1)?.text === i18n.t("projection.planDismissed")) {
      continue;
    }
    normalized.push({ ...item, text: i18n.t("projection.planDismissed") });
  }
  return normalized;
}

function isPlanDismissalText(text: string): boolean {
  const trimmed = text.trim();
  // Compatibility literals from persisted runtime history; do not localize matching.
  return (
    trimmed === "计划忽略" ||
    trimmed === "已忽略计划。" ||
    trimmed.startsWith("已忽略计划。可在下方继续对话说明修改意见")
  );
}

function filterAbsorbedSubagentDelegations(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  subagentCards: readonly ThreadRunProjectionSubagentCard[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem[] {
  const absorbedToolUseIds = collectAgentTimelineToolUseIds(subagentCards, requestSpansById);
  const subagentAgentIds = new Set(subagentCards.map((card) => card.agent.agentId));
  for (const card of subagentCards) {
    const parentToolUseId = card.agent.parentToolUseId?.trim();
    if (parentToolUseId) {
      absorbedToolUseIds.add(parentToolUseId);
    }
  }
  if (absorbedToolUseIds.size === 0 && subagentAgentIds.size === 0) {
    return [...timeline];
  }
  return timeline.filter((item) => {
    if (isSubagentMissionEnvelope(item.text)) {
      const mission = parseSubagentMissionMessage(item.text);
      if (mission) {
        const missionAgentId = mission.agentId?.trim();
        if (missionAgentId && subagentAgentIds.has(missionAgentId)) {
          return false;
        }
      }
      const itemAgentId = item.agentId?.trim();
      if (itemAgentId && subagentAgentIds.has(itemAgentId)) {
        return false;
      }
      const toolUseId =
        readProjectionToolMetadata(item)?.toolUseId?.trim() ??
        readProjectionBashApprovalMetadata(item)?.toolUseId?.trim();
      if (toolUseId && absorbedToolUseIds.has(toolUseId)) {
        return false;
      }
    }
    const bashApproval = readProjectionBashApprovalMetadata(item);
    if (bashApproval?.toolUseId?.trim() && absorbedToolUseIds.has(bashApproval.toolUseId.trim())) {
      return false;
    }
    if (item.eventType !== "tool.started" && item.eventType !== "tool.completed") {
      return true;
    }
    const toolUseId = readProjectionToolMetadata(item)?.toolUseId?.trim();
    return !toolUseId || !absorbedToolUseIds.has(toolUseId);
  });
}

function collectAgentTimelineToolUseIds(
  subagentCards: readonly ThreadRunProjectionSubagentCard[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): Set<string> {
  const ids = new Set<string>();
  for (const card of subagentCards) {
    const displayTimeline = filterProjectionTimelineForDetailFeed(card.agent.timeline, requestSpansById);
    for (const item of displayTimeline) {
      const toolUseId =
        readProjectionToolMetadata(item)?.toolUseId?.trim() ??
        readProjectionBashApprovalMetadata(item)?.toolUseId?.trim();
      if (toolUseId) {
        ids.add(toolUseId);
      }
    }
  }
  return ids;
}

function filterToolFailureDuplicateTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const failedTools = new Set(
    timeline
      .filter((item) => item.eventType === "tool.failed")
      .map((item) => resolveProjectionToolName(item).toLowerCase()),
  );
  if (failedTools.size === 0) {
    return [...timeline];
  }
  return timeline.filter((item) => !isProjectionToolFailureDuplicateMessage(item, failedTools));
}

function isProjectionToolFailureDuplicateMessage(
  item: ThreadRunProjectionTimelineItem,
  failedTools: ReadonlySet<string>,
): boolean {
  if (item.eventType === "tool.failed") {
    return false;
  }
  const text = item.text.trim();
  if (!text) {
    return false;
  }
  // Compatibility literal emitted by older runtimes.
  if (text === "工具调用被拒绝") {
    return true;
  }
  const shortMatch = text.match(/^Permission denied for ([A-Za-z0-9_]+)$/i);
  if (shortMatch?.[1] && failedTools.has(shortMatch[1].toLowerCase())) {
    return true;
  }
  const fullMatch = text.match(/^Permission denied for ([A-Za-z0-9_]+):/i);
  if (fullMatch?.[1] && failedTools.has(fullMatch[1].toLowerCase())) {
    return true;
  }
  return false;
}

function filterProjectionTimelineForDetailFeed(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem[] {
  const displayTimeline = collapsePromptCacheTimelineItems(
    buildProjectionDisplayTimelineItems(timeline, requestSpansById).filter(
      (item) => !isEmptyTerminalThinkingItem(item),
    ),
  );
  const requestsWithStreamRows = new Set(
    displayTimeline
      .filter(isStreamingRequestDisplayItem)
      .map(projectionRequestKey)
      .filter((key): key is string => Boolean(key)),
  );
  const latestActiveRequestStartedByOwner = buildLatestActiveRequestStartedByOwner(
    displayTimeline,
    requestSpansById,
  );

  return filterToolFailureDuplicateTimelineItems(
    filterProjectionToolProgressNoiseItems(
      displayTimeline.filter((item) => {
        if (isProjectionRequestTerminalItem(item)) {
          return false;
        }
        if (item.eventType !== "request.started") {
          return true;
        }
        const requestSpan = projectionRequestSpan(item, requestSpansById);
        if (requestSpan && !isProjectionRequestActive(requestSpan)) {
          const requestId = item.requestId?.trim();
          if (requestId && requestsWithStreamRows.has(`request:${requestId}`)) {
            return (
              !requestHasThinkingStream(requestId, displayTimeline) &&
              !requestHasMessageStream(requestId, displayTimeline)
            );
          }
          return false;
        }
        const requestKey = projectionRequestKey(item);
        if (requestKey && requestsWithStreamRows.has(requestKey)) {
          return false;
        }
        const ownerKey = projectionOwnerKey(item);
        if (ownerKey) {
          const latest = latestActiveRequestStartedByOwner.get(ownerKey);
          if (latest && latest.id !== item.id) {
            return false;
          }
        }
        if (
          displayTimeline.some((streamItem) =>
            isStreamRowSuppressingRequestStarted(streamItem, item, requestSpansById),
          )
        ) {
          const requestId = item.requestId?.trim();
          if (
            requestSpan &&
            !isProjectionRequestActive(requestSpan) &&
            requestId &&
            !requestHasThinkingStream(requestId, displayTimeline) &&
            !requestHasMessageStream(requestId, displayTimeline)
          ) {
            return true;
          }
          return false;
        }
        return true;
      }),
    ),
  );
}

/**
 * Full-history detail payloads contain both live deltas and their terminal row.
 * Collapse only explicit streams that actually contain a delta; final-only rows
 * are separate conversation entries and must remain visible.
 */
export function collapseProjectionTimelineStreamsForDetail(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const latestByStream = new Map<string, { latest: ThreadRunProjectionTimelineItem; hasDelta: boolean }>();
  for (const item of timeline) {
    const key = explicitProjectionDetailStreamKey(item);
    if (!key) {
      continue;
    }
    const current = latestByStream.get(key);
    const isDelta = item.eventType === "message.delta" || item.eventType === "thinking.delta";
    if (!current) {
      latestByStream.set(key, { latest: item, hasDelta: isDelta });
      continue;
    }
    latestByStream.set(key, {
      latest:
        compareTimelineItems(current.latest, item) <= 0
          ? mergeStreamDisplayTimelineItem(current.latest, item, timeline)
          : current.latest,
      hasDelta: current.hasDelta || isDelta,
    });
  }

  return timeline.flatMap((item) => {
    const key = explicitProjectionDetailStreamKey(item);
    if (!key) {
      return [item];
    }
    const stream = latestByStream.get(key);
    if (!stream?.hasDelta) {
      return [item];
    }
    return stream.latest.id === item.id ? [stream.latest] : [];
  });
}

function explicitProjectionDetailStreamKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (!isStreamingRequestDisplayItem(item)) {
    return undefined;
  }
  const streamKey = item.streamKey?.trim();
  if (!streamKey) {
    return undefined;
  }
  const channel =
    item.eventType === "thinking.delta" || item.eventType === "thinking.final" ? "thinking" : "message";
  return [channel, item.agentId ?? "", item.requestId ?? "", streamKey].join(":");
}

function isEmptyTerminalThinkingItem(item: ThreadRunProjectionTimelineItem): boolean {
  return item.eventType === "thinking.final" && item.text.trim().length === 0;
}

function filterProjectionToolProgressNoiseItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  return timeline.filter((item) => !isProjectionToolProgressNoiseItem(item, timeline));
}

function isStructuredFilesystemToolItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (item.eventType !== "tool.started" && item.eventType !== "tool.completed") {
    return false;
  }
  const metadataTool = readProjectionToolMetadata(item);
  if (!metadataTool) {
    return false;
  }
  return Boolean(
    resolveReadToolTargetDisplayFromToolMetadata(metadataTool) ||
      resolveGrepToolTargetDisplayFromToolMetadata(metadataTool),
  );
}

function isFilesystemToolEvent(item: ThreadRunProjectionTimelineItem): boolean {
  if (item.eventType !== "tool.started" && item.eventType !== "tool.completed") {
    return false;
  }
  const metadataTool = readProjectionToolMetadata(item);
  if (!metadataTool) {
    return false;
  }
  return metadataTool.name === "Read" || metadataTool.name === "NotebookRead" || metadataTool.name === "Grep";
}

function isProjectionToolProgressNoiseItem(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  const metadataTool = readProjectionToolMetadata(item);
  const text = item.text.trim();
  const detail = metadataTool?.detail?.trim() ?? "";

  if (item.eventType === "thread.status" && isToolProgressStatusText(text)) {
    return true;
  }

  if (item.eventType === "message.delta" || item.eventType === "message.final") {
    if (!isToolProgressStatusText(text)) {
      return false;
    }
    return timeline.some(
      (other) =>
        other.id !== item.id && (isStructuredFilesystemToolItem(other) || isFilesystemToolEvent(other)),
    );
  }

  if (item.eventType !== "tool.started" && item.eventType !== "tool.completed") {
    return false;
  }

  if (isStructuredFilesystemToolItem(item)) {
    return false;
  }

  if (!metadataTool) {
    return isToolProgressStatusText(text);
  }

  const isFilesystemTool =
    metadataTool.name === "Read" || metadataTool.name === "NotebookRead" || metadataTool.name === "Grep";

  if (!isFilesystemTool) {
    return false;
  }

  const isNoise = isToolProgressStatusText(text) || isToolProgressStatusText(detail);
  return isNoise;
}

function buildLatestActiveRequestStartedByOwner(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): Map<string, ThreadRunProjectionTimelineItem> {
  const latestByOwner = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of timeline) {
    if (item.eventType !== "request.started") {
      continue;
    }
    const requestSpan = projectionRequestSpan(item, requestSpansById);
    if (requestSpan && !isProjectionRequestActive(requestSpan)) {
      continue;
    }
    const ownerKey = projectionOwnerKey(item);
    if (!ownerKey) {
      continue;
    }
    const current = latestByOwner.get(ownerKey);
    if (!current || compareTimelineItems(current, item) <= 0) {
      latestByOwner.set(ownerKey, item);
    }
  }
  return latestByOwner;
}

function isMainTimelineNoiseItem(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  if (isProjectionUserPromptItem(item)) {
    return false;
  }
  if (isSupersededClarificationWaitingItem(item, timeline)) {
    return true;
  }
  if (isRequestFailureFeedNoiseItem(item)) {
    return true;
  }
  if (isProjectionInternalMessageText(item.text) || isThreadFollowUpActivityMessage(item.text)) {
    return true;
  }
  const liveType = projectionLiveType(item);
  if (
    liveType === "plan.ready" ||
    liveType === "thread.awaiting_plan" ||
    liveType === "thread.plan_cleared" ||
    liveType === "clarification.requested"
  ) {
    return true;
  }
  if (liveType === "codex.item.unprojected") {
    return false;
  }
  if (liveType && isThreadFollowUpLiveEvent(liveType)) {
    return true;
  }
  if (
    item.eventType === "agent.started" ||
    item.eventType === "agent.stopped" ||
    item.eventType === "agent.abandoned" ||
    item.eventType === "diagnostic"
  ) {
    return true;
  }
  if (item.eventType === "run.attempt.started" || item.eventType === "run.attempt.completed") {
    return true;
  }
  if (item.eventType !== "thread.status") {
    return false;
  }
  if (projectionLiveType(item) === "codex.item.unprojected") {
    return false;
  }
  const text = item.text.trim();
  return (
    !text || text === "状态已更新" || isProjectionLifecycleText(text) || isProjectionUsageNoiseText(text)
  );
}

function isSupersededClarificationWaitingItem(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  if (item.eventType !== "thread.status" || item.text.trim() !== "等待你的回答…") {
    return false;
  }
  return timeline.some(
    (candidate) =>
      projectionLiveType(candidate) === "clarification.answered" && compareTimelineItems(item, candidate) < 0,
  );
}

function isProjectionUsageNoiseText(text: string): boolean {
  return /^[↑↓⊙][↑↓⊙\d\s.,kKmM$%·+()-]*$/u.test(text);
}

function isRequestFailureFeedNoiseItem(item: ThreadRunProjectionTimelineItem): boolean {
  const origin = resolveThreadActivityOrigin(item);
  if (isRequestFailureFeedNoiseOrigin(origin)) {
    return true;
  }
  if (item.eventType === "message.delta" && isUpstreamErrorPhaseOrigin(origin)) {
    return true;
  }
  return false;
}

function isProjectionInternalMessageText(text: string): boolean {
  const trimmed = text.trim();
  // Protocol/history strings are matched verbatim across app versions.
  return (
    trimmed.startsWith("__eco_worktree_merge__") ||
    trimmed === "回答完成。" ||
    trimmed === "执行完成。" ||
    trimmed === "执行完成，变更已写入项目目录。" ||
    trimmed === "执行完成，工作树内无相对基线的文件变更。" ||
    trimmed === "执行已结束，但无法确认文件变更。" ||
    trimmed === "计划已生成，等待确认。" ||
    trimmed === "计划已生成，请确认是否执行。" ||
    trimmed === "计划已进入执行阶段。" ||
    trimmed === "计划已进入执行阶段" ||
    /^正在启动 Claude Agent SDK/u.test(trimmed) ||
    /^正在启动 Codex/u.test(trimmed) ||
    trimmed === "正在继续 Codex 会话…" ||
    trimmed === "正在继续处理…" ||
    /^Codex 已连接(?:\s*·|$)/u.test(trimmed) ||
    /^Working in project directory:/u.test(trimmed) ||
    /^Local model router ready:/u.test(trimmed) ||
    isProjectionApprovalTransitionStatus(trimmed)
  );
}

function isProjectionApprovalTransitionStatus(text: string): boolean {
  // Protocol/history strings are matched verbatim across app versions.
  return (
    text === "等待工具权限确认…" ||
    text === "等待工具读取确认…" ||
    text === "等待 Bash 执行确认…" ||
    text === "读取已确认，继续执行…" ||
    text === "读取已拒绝，等待 Agent 调整…" ||
    text === "Bash 已确认，继续执行…" ||
    text === "Bash 已拒绝，等待 Agent 调整…"
  );
}

export function buildProjectionDisplayTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem[] {
  const latestStreamDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  const latestToolDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  const latestLifecycleDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  const latestReconnectDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  const reconnectCollapseByKey = new Map<string, ReconnectCollapseMetadata>();
  const latestOriginalApiErrorDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of timeline) {
    const reconnectKey = projectionReconnectDisplayKey(item);
    if (reconnectKey) {
      const reconnect = resolveReconnectPhaseDisplay({
        text: item.text.trim(),
        metadata: item.metadata,
        apiError: readProjectionApiError(item),
      });
      const currentStats = reconnectCollapseByKey.get(reconnectKey) ?? { count: 0, failedCount: 0 };
      reconnectCollapseByKey.set(reconnectKey, {
        count: currentStats.count + 1,
        failedCount: currentStats.failedCount + (reconnect?.failed ? 1 : 0),
      });
      const current = latestReconnectDisplayByKey.get(reconnectKey);
      if (!current || compareTimelineItems(current, item) <= 0) {
        latestReconnectDisplayByKey.set(reconnectKey, item);
      }
    }

    const upstreamErrorKey = projectionUpstreamErrorDisplayKey(item);
    if (upstreamErrorKey && !isRequestFailureFeedNoiseItem(item)) {
      const current = latestOriginalApiErrorDisplayByKey.get(upstreamErrorKey);
      if (!current || compareTimelineItems(current, item) <= 0) {
        latestOriginalApiErrorDisplayByKey.set(upstreamErrorKey, item);
      }
    }

    const lifecycleKey = projectionToolLifecycleKey(item);
    if (lifecycleKey) {
      const current = latestLifecycleDisplayByKey.get(lifecycleKey);
      if (!current || compareProjectionLifecycleDisplayItems(item, current) > 0) {
        latestLifecycleDisplayByKey.set(lifecycleKey, mergeToolDisplayTimelineItem(current, item));
      }
    }

    const streamKey = projectionStreamDisplayKey(item, requestSpansById, timeline);
    if (streamKey) {
      const current = latestStreamDisplayByKey.get(streamKey);
      if (!current || compareTimelineItems(current, item) <= 0) {
        latestStreamDisplayByKey.set(streamKey, mergeStreamDisplayTimelineItem(current, item, timeline));
      }
    }

    const toolKey = projectionToolDisplayKey(item);
    if (toolKey) {
      const current = latestToolDisplayByKey.get(toolKey);
      if (!current || compareProjectionToolDisplayItems(current, item) <= 0) {
        latestToolDisplayByKey.set(toolKey, mergeToolDisplayTimelineItem(current, item));
      }
    }
  }

  const displayItems: ThreadRunProjectionTimelineItem[] = [];
  for (const item of timeline) {
    if (isRequestFailureFeedNoiseItem(item)) {
      continue;
    }
    let displayItem = item;
    const reconnectKey = projectionReconnectDisplayKey(item);
    if (reconnectKey) {
      if (latestReconnectDisplayByKey.get(reconnectKey)?.id !== item.id) {
        continue;
      }
      if (isTimelineItemSupersededByRecovery(timeline, item, compareTimelineOrder)) {
        continue;
      }
      displayItem = withReconnectCollapseMetadata(displayItem, reconnectCollapseByKey.get(reconnectKey));
    }
    const upstreamErrorKey = projectionUpstreamErrorDisplayKey(item);
    if (upstreamErrorKey) {
      if (latestOriginalApiErrorDisplayByKey.get(upstreamErrorKey)?.id !== item.id) {
        continue;
      }
      if (isTimelineItemSupersededByRecovery(timeline, item, compareTimelineOrder)) {
        continue;
      }
    }
    const lifecycleKey = projectionToolLifecycleKey(item);
    if (lifecycleKey) {
      const latestLifecycle = latestLifecycleDisplayByKey.get(lifecycleKey);
      if (!latestLifecycle || latestLifecycle.id !== item.id) {
        continue;
      }
      displayItem = latestLifecycle;
    }
    const streamKey = projectionStreamDisplayKey(item, requestSpansById, timeline);
    if (streamKey) {
      const latestStream = latestStreamDisplayByKey.get(streamKey);
      if (!latestStream || latestStream.id !== item.id) {
        continue;
      }
      displayItem = latestStream;
    }
    const toolKey = projectionToolDisplayKey(item);
    if (toolKey && latestToolDisplayByKey.get(toolKey)?.id !== item.id) {
      continue;
    }
    if (isDuplicateStreamBlockFinalEcho(displayItem, timeline)) {
      continue;
    }
    if (isDuplicateLegacyStreamFinalEcho(displayItem, timeline)) {
      continue;
    }
    const settled = settleTerminalStreamDisplayItem(displayItem, requestSpansById);
    if (settled) {
      displayItems.push(settled);
    }
  }
  return displayItems;
}

interface ReconnectCollapseMetadata {
  count: number;
  failedCount: number;
}

function withReconnectCollapseMetadata(
  item: ThreadRunProjectionTimelineItem,
  collapse: ReconnectCollapseMetadata | undefined,
): ThreadRunProjectionTimelineItem {
  if (!collapse || collapse.count <= 1) {
    return item;
  }
  return {
    ...item,
    metadata: {
      ...(item.metadata ?? {}),
      reconnectCollapse: collapse,
    },
  };
}

function readReconnectCollapseMetadata(
  metadata: Record<string, unknown> | undefined,
): ReconnectCollapseMetadata | undefined {
  const raw = metadata?.reconnectCollapse;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const count = typeof record.count === "number" && Number.isFinite(record.count) ? record.count : 0;
  const failedCount =
    typeof record.failedCount === "number" && Number.isFinite(record.failedCount) ? record.failedCount : 0;
  if (count <= 1 && failedCount <= 1) {
    return undefined;
  }
  return { count, failedCount };
}

function readFiniteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readThinkingStartedAt(metadata: Record<string, unknown> | undefined): string | undefined {
  const value = metadata?.thinkingStartedAt;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isDuplicateStreamBlockFinalEcho(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  if (item.eventType !== "message.final" && item.eventType !== "thinking.final") {
    return false;
  }
  if (!isExplicitStreamBlockItem(item) || item.requestId?.trim()) {
    return false;
  }
  const streamKey = item.streamKey?.trim();
  const text = item.text.trim();
  if (!streamKey || !text) {
    return false;
  }
  const channel = streamDisplayChannel(item);
  return timeline.some((other) => {
    if (other.id === item.id || other.streamKey?.trim() !== streamKey) {
      return false;
    }
    if (!other.requestId?.trim() || streamDisplayChannel(other) !== channel) {
      return false;
    }
    if (!isStreamDisplayTimelineItem(other) || other.text.trim() !== text) {
      return false;
    }
    return !hasUserPromptBetweenTimelineItems(timeline, item, other);
  });
}

function isDuplicateLegacyStreamFinalEcho(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  if (item.eventType !== "message.final" && item.eventType !== "thinking.final") {
    return false;
  }
  if (isExplicitStreamBlockItem(item)) {
    return false;
  }
  const text = item.text.trim();
  if (!text) {
    return false;
  }
  const channel = streamDisplayChannel(item);
  return timeline.some((other) => {
    if (other.id === item.id || !isExplicitStreamBlockItem(other)) {
      return false;
    }
    if (other.eventType !== item.eventType || streamDisplayChannel(other) !== channel) {
      return false;
    }
    if (other.text.trim() !== text) {
      return false;
    }
    return !hasUserPromptBetweenTimelineItems(timeline, item, other);
  });
}

function isExplicitStreamBlockItem(item: ThreadRunProjectionTimelineItem): boolean {
  return Boolean(item.streamKey?.includes(":block:"));
}

function isStreamDisplayTimelineItem(item: ThreadRunProjectionTimelineItem): boolean {
  return (
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final" ||
    item.eventType === "message.delta" ||
    item.eventType === "message.final"
  );
}

function streamDisplayChannel(item: ThreadRunProjectionTimelineItem): "thinking" | "message" {
  return item.eventType === "thinking.delta" || item.eventType === "thinking.final" ? "thinking" : "message";
}

function hasUserPromptBetweenTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): boolean {
  const [earlier, later] = compareTimelineItems(left, right) <= 0 ? [left, right] : [right, left];
  return hasUserPromptBetween(timeline, earlier, later);
}

function appendStreamScopeSuffix(
  key: string,
  item: ThreadRunProjectionTimelineItem,
  effectiveRequestId?: string,
): string {
  const isStream =
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final" ||
    item.eventType === "message.delta" ||
    item.eventType === "message.final";
  if (!isStream) {
    return key;
  }
  const requestId = effectiveRequestId?.trim() || item.requestId?.trim();
  return requestId ? `${key}:req:${requestId}` : key;
}

function hasUserPromptBetween(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  current: ThreadRunProjectionTimelineItem,
  item: ThreadRunProjectionTimelineItem,
): boolean {
  const currentIndex = timeline.findIndex((entry) => entry.id === current.id);
  const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
  if (currentIndex < 0 || itemIndex < 0 || itemIndex <= currentIndex) {
    return false;
  }
  for (let index = currentIndex + 1; index < itemIndex; index += 1) {
    const entry = timeline[index];
    if (entry && isProjectionUserPromptItem(entry)) {
      return true;
    }
  }
  return false;
}

/** Same thinking block grows by prefix extension; a new block is not a continuation. */
export function isThinkingTextContinuation(previous: string, next: string): boolean {
  const prev = previous.trim();
  const nextTrim = next.trim();
  if (!nextTrim) {
    return true;
  }
  if (!prev) {
    return true;
  }
  return nextTrim.startsWith(prev) || prev.startsWith(nextTrim);
}

function hasThinkingStreamBoundaryBetween(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  current: ThreadRunProjectionTimelineItem,
  item: ThreadRunProjectionTimelineItem,
): boolean {
  const currentIndex = timeline.findIndex((entry) => entry.id === current.id);
  const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
  if (currentIndex < 0 || itemIndex < 0 || itemIndex <= currentIndex) {
    return false;
  }
  for (let index = currentIndex + 1; index < itemIndex; index += 1) {
    const entry = timeline[index];
    if (!entry) {
      continue;
    }
    if (isProjectionUserPromptItem(entry)) {
      return true;
    }
    if (entry.eventType === "thinking.final" || entry.eventType === "message.final") {
      return true;
    }
    if (
      entry.eventType === "tool.started" ||
      entry.eventType === "tool.completed" ||
      entry.eventType === "tool.failed"
    ) {
      return true;
    }
  }
  return false;
}

function hasOnlyEmptyThinkingBefore(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  item: ThreadRunProjectionTimelineItem,
): boolean {
  const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
  if (itemIndex <= 0) {
    return false;
  }
  let sawEmptyThinking = false;
  for (let index = itemIndex - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (!entry) {
      continue;
    }
    const isThinking = entry.eventType === "thinking.delta" || entry.eventType === "thinking.final";
    if (!isThinking) {
      return false;
    }
    if (entry.text.trim()) {
      return sawEmptyThinking;
    }
    sawEmptyThinking = true;
  }
  return false;
}

function shouldResetThinkingStreamMerge(
  current: ThreadRunProjectionTimelineItem,
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  const currentRequestId = current.requestId?.trim();
  const itemRequestId = item.requestId?.trim();
  if (currentRequestId && itemRequestId && currentRequestId !== itemRequestId) {
    return true;
  }
  if (current.eventType === "thinking.final") {
    return true;
  }
  if (hasUserPromptBetween(timeline, current, item)) {
    return true;
  }
  if (
    current.id !== item.id &&
    !item.text.trim() &&
    current.text.trim() &&
    hasThinkingStreamBoundaryBetween(timeline, current, item)
  ) {
    return true;
  }
  if (current.id !== item.id && !isThinkingTextContinuation(current.text, item.text)) {
    if (hasThinkingStreamBoundaryBetween(timeline, current, item)) {
      return true;
    }
    if (
      item.text.trim() &&
      item.text.length < current.text.length &&
      hasOnlyEmptyThinkingBefore(timeline, item)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function mergeStreamDisplayTimelineItem(
  current: ThreadRunProjectionTimelineItem | undefined,
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem {
  if (!current || compareTimelineItems(current, item) > 0) {
    return item;
  }
  const isThinkingStream = item.eventType === "thinking.delta" || item.eventType === "thinking.final";
  if (!isThinkingStream) {
    return item;
  }
  const shouldReset = shouldResetThinkingStreamMerge(current, item, timeline);
  if (shouldReset) {
    return item;
  }
  const preservedText = !item.text.trim()
    ? current.text
    : !current.text.trim()
      ? item.text
      : item.text.length >= current.text.length
        ? item.text
        : current.text;
  return {
    ...item,
    text: preservedText,
    metadata: mergeThinkingTimingMetadata(current.metadata, item.metadata),
  };
}

function mergeThinkingTimingMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!existing && !incoming) {
    return undefined;
  }
  const merged: Record<string, unknown> = {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
  const existingStarted =
    typeof existing?.thinkingStartedAt === "string" ? existing.thinkingStartedAt.trim() : "";
  const incomingStarted =
    typeof incoming?.thinkingStartedAt === "string" ? incoming.thinkingStartedAt.trim() : "";
  const thinkingStartedAt = existingStarted || incomingStarted;
  if (thinkingStartedAt) {
    merged.thinkingStartedAt = thinkingStartedAt;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeToolDisplayTimelineItem(
  current: ThreadRunProjectionTimelineItem | undefined,
  item: ThreadRunProjectionTimelineItem,
): ThreadRunProjectionTimelineItem {
  if (!current) {
    return item;
  }
  if (compareProjectionToolDisplayItems(item, current) >= 0) {
    return mergeFilesystemToolTimelineMetadata(current, item);
  }
  return mergeFilesystemToolTimelineMetadata(item, current);
}

function mergeFilesystemToolTimelineMetadata(
  placeholder: ThreadRunProjectionTimelineItem,
  richer: ThreadRunProjectionTimelineItem,
): ThreadRunProjectionTimelineItem {
  const placeholderTool = readProjectionToolMetadata(placeholder);
  const richerTool = readProjectionToolMetadata(richer);
  if (!richerTool) {
    return richer;
  }
  const preserveStartedBashDetail =
    richer.eventType === "tool.failed" && richerTool.name.trim().toLowerCase() === "bash";
  const detail = preserveStartedBashDetail
    ? (placeholderTool?.detail ?? richerTool.detail)
    : (richerTool.detail ?? placeholderTool?.detail);
  const readTarget = richerTool.readTarget ?? placeholderTool?.readTarget;
  const grepTarget = richerTool.grepTarget ?? placeholderTool?.grepTarget;
  const mergedTool: ThreadRunToolMetadata = {
    ...placeholderTool,
    ...richerTool,
    ...(readTarget !== undefined ? { readTarget } : {}),
    ...(grepTarget !== undefined ? { grepTarget } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
  return {
    ...richer,
    text: richer.text.trim() || placeholder.text,
    metadata: {
      ...(placeholder.metadata ?? {}),
      ...(richer.metadata ?? {}),
      tool: mergedTool,
    },
  };
}

function shouldSuppressFilesystemToolPlaceholder(
  block: ActivityDetailBlock,
  metadataTool: ThreadRunToolMetadata | undefined,
): boolean {
  if (block.kind !== "action" || !metadataTool) {
    return false;
  }
  if (metadataTool.name === "Read" || metadataTool.name === "NotebookRead") {
    return !block.readTarget;
  }
  if (metadataTool.name === "Grep") {
    return !block.grepTarget;
  }
  return false;
}

function settleTerminalStreamDisplayItem(
  item: ThreadRunProjectionTimelineItem,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem | undefined {
  if (item.eventType !== "message.delta" && item.eventType !== "thinking.delta") {
    return item;
  }
  if (!item.text.trim()) {
    return undefined;
  }
  const span = projectionRequestSpan(item, requestSpansById);
  if (!span || isProjectionRequestActive(span)) {
    return item;
  }
  return {
    ...item,
    eventType: item.eventType === "thinking.delta" ? "thinking.final" : "message.final",
  };
}

function filterCompactionTimelineForFeed(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  return timeline.filter((item, index) => {
    if (item.eventType !== "context.compaction.started") {
      return true;
    }
    return !timeline.slice(index + 1).some((later) => isProjectionContextCompactionItem(later));
  });
}

function isProjectionContextCompactionItem(item: ThreadRunProjectionTimelineItem): boolean {
  return (
    item.eventType === "context.compaction.started" ||
    item.eventType === "context.compaction.completed" ||
    item.eventType === "context.compaction.failed" ||
    item.eventType === "context.compaction.suspended"
  );
}

/** Auto compaction circuit breaker tripped until a successful manual/auto compact completes. */
export function isThreadAutoCompactSuspended(projection: ThreadRunProjectionSnapshot | undefined): boolean {
  if (!projection?.timeline.length) {
    return false;
  }
  let suspended = false;
  for (const item of projection.timeline) {
    if (item.eventType === "context.compaction.completed") {
      suspended = false;
      continue;
    }
    if (item.eventType === "context.compaction.suspended") {
      suspended = true;
    }
  }
  return suspended;
}

/** Prompt cache was invalidated at least once in this thread projection. */
export function isThreadPromptCacheInvalidated(projection: ThreadRunProjectionSnapshot | undefined): boolean {
  return projection?.timeline.some((item) => item.eventType === "context.cache_invalidated") ?? false;
}

/** Orphaned compaction.started without a terminal event stops blocking the UI after this long. */
const COMPACTION_IN_FLIGHT_STALE_MS = 4 * 60 * 1000;

export function isThreadContextCompactionInFlight(
  projection: ThreadRunProjectionSnapshot | undefined,
  nowMs = Date.now(),
): boolean {
  if (!projection?.timeline.length) {
    return false;
  }
  let lastStage: "started" | "completed" | "failed" | undefined;
  let lastStartedAt: string | undefined;
  for (const item of projection.timeline) {
    if (item.eventType === "context.compaction.started") {
      lastStage = "started";
      lastStartedAt = item.at;
      continue;
    }
    if (item.eventType === "context.compaction.completed") {
      lastStage = "completed";
      continue;
    }
    if (item.eventType === "context.compaction.failed") {
      lastStage = "failed";
    }
  }
  if (lastStage !== "started") {
    return false;
  }
  if (lastStartedAt) {
    const startedAtMs = Date.parse(lastStartedAt);
    if (Number.isFinite(startedAtMs) && nowMs - startedAtMs > COMPACTION_IN_FLIGHT_STALE_MS) {
      return false;
    }
  }
  return true;
}

function requestHasThinkingStream(
  requestId: string,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  return timeline.some(
    (streamItem) =>
      streamItem.requestId === requestId &&
      (streamItem.eventType === "thinking.delta" || streamItem.eventType === "thinking.final"),
  );
}

function requestHasMessageStream(
  requestId: string,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): boolean {
  return timeline.some(
    (streamItem) =>
      streamItem.requestId === requestId &&
      (streamItem.eventType === "message.delta" || streamItem.eventType === "message.final"),
  );
}

function isStreamRowSuppressingRequestStarted(
  streamItem: ThreadRunProjectionTimelineItem,
  requestStarted: ThreadRunProjectionTimelineItem,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): boolean {
  if (!isStreamingRequestDisplayItem(streamItem)) {
    return false;
  }
  const startedOwner = projectionOwnerKey(requestStarted);
  const streamOwner = projectionOwnerKey(streamItem);
  if (!startedOwner || startedOwner !== streamOwner) {
    return false;
  }
  const startedRequestId = requestStarted.requestId?.trim();
  const streamRequestId = streamItem.requestId?.trim();
  if (startedRequestId && streamRequestId) {
    return streamRequestId === startedRequestId;
  }
  const span = projectionRequestSpan(requestStarted, requestSpansById);
  return (
    Boolean(span && isProjectionRequestActive(span)) && compareTimelineItems(streamItem, requestStarted) > 0
  );
}

function isStreamingRequestDisplayItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (isProjectionTodoStatusItem(item)) {
    return false;
  }
  return (
    item.eventType === "message.delta" ||
    item.eventType === "message.final" ||
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final"
  );
}

function isProjectionRequestTerminalItem(item: ThreadRunProjectionTimelineItem): boolean {
  return (
    item.eventType === "request.completed" ||
    item.eventType === "request.failed" ||
    item.eventType === "request.cancelled"
  );
}

function projectionRequestKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (item.requestId) {
    return `request:${item.requestId}`;
  }
  return undefined;
}

function projectionRequestSpan(
  item: ThreadRunProjectionTimelineItem,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionSnapshot["requestSpans"][number] | undefined {
  const spanId = projectionRequestSpanId(item);
  return spanId ? requestSpansById.get(spanId) : undefined;
}

function projectionRequestSpanId(item: ThreadRunProjectionTimelineItem): string | undefined {
  return item.requestId?.trim() || undefined;
}

function projectionReconnectDisplayKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  return isReconnectActivityOrigin(resolveThreadActivityOrigin(item)) ? "reconnect" : undefined;
}

function projectionUpstreamErrorDisplayKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (item.eventType !== "message.final") {
    return undefined;
  }
  return isUpstreamErrorPhaseOrigin(resolveThreadActivityOrigin(item)) ? "upstream-api-error" : undefined;
}

export function projectionMainFeedEntryKey(
  item: ThreadRunProjectionTimelineItem,
  options?: {
    agentId?: string;
    requestSpansById?: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>;
    timeline?: readonly ThreadRunProjectionTimelineItem[];
  },
): string {
  const scope = options?.agentId ? `agent:${options.agentId}` : "main";
  const streamKey = projectionStreamDisplayKey(item, options?.requestSpansById, options?.timeline);
  if (streamKey) {
    return `${scope}:stream:${streamKey}`;
  }
  const lifecycleKey = projectionToolLifecycleKey(item);
  if (lifecycleKey) {
    return `${scope}:${lifecycleKey}`;
  }
  const toolKey = projectionToolDisplayKey(item);
  if (toolKey) {
    return `${scope}:${toolKey}`;
  }
  return `${scope}:${item.id}`;
}

function resolveTurnBoundaryIndex(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  itemIndex: number,
): number {
  for (let index = itemIndex - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (!entry) {
      continue;
    }
    if (isProjectionUserPromptItem(entry)) {
      return index;
    }
    if (entry.eventType === "message.final" && entry.role === "planner") {
      return index;
    }
    if (entry.eventType === "thinking.final") {
      return index;
    }
  }
  return -1;
}

function resolveTurnSegmentEndIndex(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  itemIndex: number,
): number {
  for (let index = itemIndex + 1; index < timeline.length; index += 1) {
    const entry = timeline[index];
    if (entry && isProjectionUserPromptItem(entry)) {
      return index;
    }
  }
  return timeline.length;
}

function resolveUserPromptBoundaryIndex(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  itemIndex: number,
): number {
  for (let index = itemIndex - 1; index >= 0; index -= 1) {
    const entry = timeline[index];
    if (entry && isProjectionUserPromptItem(entry)) {
      return index;
    }
  }
  return -1;
}

function resolveExpectedStreamRequestRole(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (
    item.role === "thinking" ||
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final"
  ) {
    return "planner";
  }
  const role = item.role?.trim();
  if (!role || role === "tool" || role === "system" || role === "user") {
    return undefined;
  }
  return role;
}

function streamRequestCandidateMatchesItem(
  candidate: ThreadRunProjectionTimelineItem,
  item: ThreadRunProjectionTimelineItem,
  requestSpansById?: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): boolean {
  const requestId = candidate.requestId?.trim();
  if (!requestId) {
    return false;
  }
  const span = requestSpansById?.get(requestId);
  const itemAgentId = item.agentId?.trim();
  if (itemAgentId && span?.ownerAgentId && span.ownerAgentId !== itemAgentId) {
    return false;
  }
  const expectedRole = resolveExpectedStreamRequestRole(item);
  const candidateRole = span?.role ?? candidate.role;
  if (expectedRole && candidateRole && candidateRole !== expectedRole) {
    return false;
  }
  return true;
}

function resolveNearestStreamRequestIdInUserTurn(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById?: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): string | undefined {
  const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
  if (itemIndex < 0) {
    return undefined;
  }
  const userBoundaryIndex = resolveUserPromptBoundaryIndex(timeline, itemIndex);
  const searchStart = userBoundaryIndex >= 0 ? userBoundaryIndex + 1 : 0;
  const searchEnd = resolveTurnSegmentEndIndex(timeline, itemIndex);
  let fallbackRequestId: string | undefined;

  for (let index = itemIndex; index >= searchStart; index -= 1) {
    const entry = timeline[index];
    if (!entry || !streamRequestCandidateMatchesItem(entry, item, requestSpansById)) {
      continue;
    }
    const requestId = entry.requestId?.trim();
    if (entry.eventType === "request.started") {
      return requestId;
    }
    fallbackRequestId ??= requestId;
  }
  if (fallbackRequestId) {
    return fallbackRequestId;
  }

  for (let index = itemIndex + 1; index < searchEnd; index += 1) {
    const entry = timeline[index];
    if (!entry || !streamRequestCandidateMatchesItem(entry, item, requestSpansById)) {
      continue;
    }
    const requestId = entry.requestId?.trim();
    if (entry.eventType === "request.started") {
      return requestId;
    }
    fallbackRequestId ??= requestId;
  }
  return fallbackRequestId;
}

function resolveNearestPlannerRequestId(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById?: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): string | undefined {
  const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
  if (itemIndex < 0) {
    return undefined;
  }
  const turnBoundaryIndex = resolveTurnBoundaryIndex(timeline, itemIndex);
  const searchStart = turnBoundaryIndex >= 0 ? turnBoundaryIndex + 1 : 0;
  const searchEnd = resolveTurnSegmentEndIndex(timeline, itemIndex);
  for (let index = itemIndex; index >= searchStart; index -= 1) {
    const entry = timeline[index];
    if (!entry) {
      continue;
    }
    const requestId = entry.requestId?.trim();
    if (!requestId) {
      continue;
    }
    if (entry.eventType === "request.started" && entry.role === "planner") {
      return requestId;
    }
    if (entry.role === "planner" && requestSpansById?.has(requestId)) {
      return requestId;
    }
  }
  for (let index = itemIndex + 1; index < searchEnd; index += 1) {
    const entry = timeline[index];
    if (!entry) {
      continue;
    }
    const requestId = entry.requestId?.trim();
    if (!requestId) {
      continue;
    }
    if (entry.eventType === "request.started" && entry.role === "planner") {
      return requestId;
    }
    if (entry.role === "planner" && requestSpansById?.has(requestId)) {
      return requestId;
    }
  }
  return undefined;
}

function resolveEffectiveStreamRequestId(
  item: ThreadRunProjectionTimelineItem,
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById?: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): string | undefined {
  const isThinkingStream =
    item.role === "thinking" || item.eventType === "thinking.delta" || item.eventType === "thinking.final";
  const itemRequestId = item.requestId?.trim();
  const hasExplicitStreamBlockKey = Boolean(item.streamKey?.includes(":block:"));
  if (!isThinkingStream) {
    if (itemRequestId) {
      return itemRequestId;
    }
    if (hasExplicitStreamBlockKey) {
      return resolveNearestStreamRequestIdInUserTurn(item, timeline, requestSpansById);
    }
    return undefined;
  }
  if (hasExplicitStreamBlockKey && !itemRequestId) {
    const inferredRequestId = resolveNearestStreamRequestIdInUserTurn(item, timeline, requestSpansById);
    if (inferredRequestId) {
      return inferredRequestId;
    }
  }
  const plannerRequestId = resolveNearestPlannerRequestId(item, timeline, requestSpansById);
  if (plannerRequestId) {
    return plannerRequestId;
  }
  const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
  const turnBoundaryIndex = itemIndex >= 0 ? resolveTurnBoundaryIndex(timeline, itemIndex) : -1;
  const boundaryItem = turnBoundaryIndex >= 0 ? timeline[turnBoundaryIndex] : undefined;
  const hasUserPromptInTurn = Boolean(boundaryItem && isProjectionUserPromptItem(boundaryItem));
  if (!hasUserPromptInTurn) {
    if (itemRequestId && requestSpansById?.has(itemRequestId)) {
      return itemRequestId;
    }
  }
  return undefined;
}

function projectionStreamDisplayKey(
  item: ThreadRunProjectionTimelineItem,
  requestSpansById?: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
  timeline: readonly ThreadRunProjectionTimelineItem[] = [],
): string | undefined {
  if (!isStreamingRequestDisplayItem(item)) {
    return undefined;
  }
  const origin = resolveThreadActivityOrigin(item);
  if (isRequestFailureFeedNoiseOrigin(origin) || isUpstreamErrorPhaseOrigin(origin)) {
    return undefined;
  }
  const channel =
    item.eventType === "thinking.delta" || item.eventType === "thinking.final" ? "thinking" : "message";
  const requestId = resolveEffectiveStreamRequestId(item, timeline, requestSpansById);
  const streamKey = item.streamKey?.trim();
  const hasExplicitStreamBlockKey = Boolean(streamKey?.includes(":block:"));
  const hasExplicitLogicalItemKey = Boolean(
    streamKey && (item.metadata?.logicalEntityId === streamKey || item.metadata?.itemId === streamKey),
  );
  if (streamKey && (hasExplicitStreamBlockKey || hasExplicitLogicalItemKey)) {
    return appendStreamScopeSuffix(`${channel}:sk:${streamKey}`, item, requestId);
  }
  if (requestId && requestSpansById) {
    const span = requestSpansById.get(requestId);
    if (span && !isProjectionRequestActive(span)) {
      return `${channel}:request:${requestId}`;
    }
  }
  if (streamKey) {
    return appendStreamScopeSuffix(`${channel}:sk:${streamKey}`, item, requestId);
  }
  const ownerKey = projectionOwnerKey(item);
  if (ownerKey) {
    return appendStreamScopeSuffix(`${channel}:${ownerKey}`, item, requestId);
  }
  const requestKey = projectionRequestKey(item);
  if (requestKey) {
    return appendStreamScopeSuffix(`${channel}:${requestKey}`, item, requestId);
  }
  return `${channel}:${item.id}`;
}

const FEED_SORT_LANE_NORMAL = 0;
const FEED_SORT_LANE_STREAM_MESSAGE = 1;

function buildToolLifecycleSortAnchors(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): Map<string, { at: string; sequence: number }> {
  const anchors = new Map<string, { at: string; sequence: number }>();
  for (const item of timeline) {
    const toolUseId =
      readProjectionToolMetadata(item)?.toolUseId?.trim() ??
      readProjectionBashApprovalMetadata(item)?.toolUseId?.trim();
    if (!toolUseId) {
      continue;
    }
    const candidate = { at: item.at, sequence: item.sequence };
    const existing = anchors.get(toolUseId);
    if (!existing || candidate.sequence < existing.sequence) {
      anchors.set(toolUseId, candidate);
    }
  }
  return anchors;
}

function resolveFeedEntrySortAnchor(
  item: ThreadRunProjectionTimelineItem,
  toolAnchors: ReadonlyMap<string, { at: string; sequence: number }>,
): { at: string; sequence: number } {
  const toolUseId =
    readProjectionToolMetadata(item)?.toolUseId?.trim() ??
    readProjectionBashApprovalMetadata(item)?.toolUseId?.trim();
  if (toolUseId) {
    const anchored = toolAnchors.get(toolUseId);
    if (anchored) {
      return anchored;
    }
  }
  return { at: item.at, sequence: item.sequence };
}

function resolveFeedEntrySortLane(
  item: ThreadRunProjectionTimelineItem,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): number {
  if (item.eventType === "message.delta") {
    const span = projectionRequestSpan(item, requestSpansById);
    if (!span || isProjectionRequestActive(span)) {
      return FEED_SORT_LANE_STREAM_MESSAGE;
    }
  }
  return FEED_SORT_LANE_NORMAL;
}

function resolveMainFeedEntrySortLane(
  entry: ThreadRunProjectionMainFeedEntry,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): number {
  if (entry.kind === "timeline" || entry.kind === "agent-echo") {
    return resolveFeedEntrySortLane(entry.item, requestSpansById);
  }
  return FEED_SORT_LANE_NORMAL;
}

function projectionToolDisplayKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (item.eventType !== "tool.started" && item.eventType !== "tool.completed") {
    return undefined;
  }
  const metadataTool = readProjectionToolMetadata(item);
  if (!metadataTool?.toolUseId) {
    return undefined;
  }
  return `tool:${metadataTool.toolUseId}`;
}

function projectionToolLifecycleKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  const bashApproval = readProjectionBashApprovalMetadata(item);
  if (bashApproval?.toolUseId) {
    return `lifecycle:${bashApproval.toolUseId}`;
  }
  const metadataTool = readProjectionToolMetadata(item);
  if (
    metadataTool?.toolUseId &&
    (item.eventType === "tool.started" ||
      item.eventType === "tool.completed" ||
      item.eventType === "tool.failed")
  ) {
    return `lifecycle:${metadataTool.toolUseId}`;
  }
  return undefined;
}

function resolveProjectionToolLifecycle(
  item: ThreadRunProjectionTimelineItem,
): ToolActionLifecycle | undefined {
  const bashApproval = readProjectionBashApprovalMetadata(item);
  if (bashApproval) {
    return bashApprovalPhaseToLifecycle(bashApproval.phase);
  }
  const metadataTool = readProjectionToolMetadata(item);
  return toolStatusToLifecycle(metadataTool?.status, item.eventType);
}

function compareProjectionLifecycleDisplayItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): number {
  const leftLifecycle = resolveProjectionToolLifecycle(left);
  const rightLifecycle = resolveProjectionToolLifecycle(right);
  if (leftLifecycle && rightLifecycle && leftLifecycle !== rightLifecycle) {
    return compareToolActionLifecyclePriority(leftLifecycle, rightLifecycle);
  }
  const richnessDiff = projectionToolDisplayRichness(left) - projectionToolDisplayRichness(right);
  if (richnessDiff !== 0) {
    return richnessDiff;
  }
  return compareTimelineItems(left, right);
}

function compareProjectionToolDisplayItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): number {
  const richnessDiff = projectionToolDisplayRichness(left) - projectionToolDisplayRichness(right);
  if (richnessDiff !== 0) {
    return richnessDiff;
  }
  return compareTimelineItems(left, right);
}

export function collapseProjectionToolLifecycleItemsForDetail(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const latestByLifecycleKey = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of timeline) {
    const key = projectionToolLifecycleKey(item);
    if (!key) {
      continue;
    }
    const current = latestByLifecycleKey.get(key);
    if (!current || compareProjectionLifecycleDisplayItems(item, current) > 0) {
      latestByLifecycleKey.set(key, item);
    }
  }
  return timeline.filter((item) => {
    const key = projectionToolLifecycleKey(item);
    return !key || latestByLifecycleKey.get(key)?.id === item.id;
  });
}

function projectionToolDisplayRichness(item: ThreadRunProjectionTimelineItem): number {
  const metadataTool = readProjectionToolMetadata(item);
  if (!metadataTool) {
    return 0;
  }
  return (
    (metadataTool.readTarget ? 6 : 0) +
    (metadataTool.grepTarget ? 6 : 0) +
    (metadataTool.detail ? 4 : 0) +
    (metadataTool.fileChange ? 8 : 0) +
    (metadataTool.durationMs !== undefined ? 2 : 0) +
    (item.eventType === "tool.completed" ? 1 : 0)
  );
}

function projectionOwnerKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (item.agentId) {
    return `agent:${item.agentId}`;
  }
  if (item.role) {
    return `role:${item.role}`;
  }
  return item.scope ? `scope:${item.scope}` : undefined;
}

function compareTimelineOrder(
  left: { at: string; sequence: number; id: string },
  right: { at: string; sequence: number; id: string },
): number {
  const atDiff = left.at.localeCompare(right.at);
  if (atDiff !== 0) {
    return atDiff;
  }
  const sequenceDiff = left.sequence - right.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }
  return left.id.localeCompare(right.id);
}

function compareTimelineItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): number {
  return compareTimelineOrder(left, right);
}

function compareMainFeedEntries(
  left: ThreadRunProjectionMainFeedEntry,
  right: ThreadRunProjectionMainFeedEntry,
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): number {
  const laneDiff =
    resolveMainFeedEntrySortLane(left, requestSpansById) -
    resolveMainFeedEntrySortLane(right, requestSpansById);
  if (laneDiff !== 0) {
    return laneDiff;
  }
  const atDiff = left.at.localeCompare(right.at);
  if (atDiff !== 0) {
    return atDiff;
  }
  const sequenceDiff = left.sequence - right.sequence;
  if (sequenceDiff !== 0) {
    return sequenceDiff;
  }
  return left.key.localeCompare(right.key);
}

function resolveProjectionSubagent(item: ThreadRunProjectionTimelineItem): string | undefined {
  const role = normalizeAgentDisplayRole(item.role);
  if (!role || role === "tool") {
    return undefined;
  }
  return role;
}

function readProjectionBashApprovalMetadata(
  item: ThreadRunProjectionTimelineItem,
): ReturnType<typeof readBashApprovalMetadata> {
  return readBashApprovalMetadata(item.metadata);
}

function buildProjectionToolActionBlock(
  item: ThreadRunProjectionTimelineItem,
  input: {
    toolName: string;
    label: string;
    lifecycle?: ToolActionLifecycle;
    description?: string;
  },
): ActivityDetailBlock {
  const subagent = resolveProjectionSubagent(item);
  const metadataTool = readProjectionToolMetadata(item);
  const bashApproval = readProjectionBashApprovalMetadata(item);
  const description = input.description ?? metadataTool?.description ?? bashApproval?.description;
  const command = metadataTool?.detail?.trim() || bashApproval?.detail?.trim();
  const bashRun = resolveBashRunCardDisplay({
    toolName: input.toolName,
    ...(command && { command }),
    ...(metadataTool?.outputPreview && { output: metadataTool.outputPreview }),
    ...(metadataTool?.durationMs !== undefined && { durationMs: metadataTool.durationMs }),
    ...(description && { description }),
  });
  const fileChange = resolveFileChangeCardDisplay(metadataTool?.fileChange);
  const readTarget = metadataTool ? resolveReadToolTargetDisplayFromToolMetadata(metadataTool) : undefined;
  const grepTarget = metadataTool ? resolveGrepToolTargetDisplayFromToolMetadata(metadataTool) : undefined;
  return {
    kind: "action",
    icon: iconForToolName(input.toolName),
    label: input.label,
    toolName: input.toolName,
    ...(input.lifecycle && { lifecycle: input.lifecycle }),
    ...(bashRun && { bashRun }),
    ...(fileChange && { fileChange }),
    ...(readTarget && { readTarget }),
    ...(grepTarget && { grepTarget }),
    ...(subagent && { subagent }),
    ...(item.agentId && { agentId: item.agentId }),
  };
}

export function projectionItemToDetailBlock(
  item: ThreadRunProjectionTimelineItem,
): ActivityDetailBlock | undefined {
  const text = item.text.trim();
  const reconnect = resolveReconnectPhaseDisplay({
    text,
    metadata: item.metadata,
    apiError: readProjectionApiError(item),
  });
  if (reconnect) {
    return {
      kind: "phase",
      label: formatReconnectPhaseSummary(reconnect.summary, reconnect, item.metadata),
      reconnecting: true,
      ...(reconnect.failed && { reconnectFailed: true }),
      ...(reconnect.detail && { reconnectDetail: reconnect.detail }),
    };
  }

  const unprojected = readUnprojectedCodexItem(item);
  if (unprojected) {
    const subagent = resolveProjectionSubagent(item);
    return {
      kind: "unknown-item",
      itemType: unprojected.itemType,
      ...(unprojected.phase && { phase: unprojected.phase }),
      ...(unprojected.payload && { payload: unprojected.payload }),
      streaming: unprojected.phase === "started",
      ...(subagent && { subagent }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "agent.started") {
    const delegation = readProjectionDelegationMetadata(item);
    if (delegation) {
      const subagent = resolveProjectionSubagent(item) ?? delegation.subagent;
      return {
        kind: "subagent-mission",
        subagent,
        summary: delegation.summary,
        ...(delegation.prompt && { prompt: delegation.prompt }),
        ...(item.agentId && { agentId: item.agentId }),
      };
    }
  }

  if (isProjectionTodoToolActionItem(item)) {
    return buildProjectionToolActionBlock(item, {
      toolName: resolveProjectionToolName(item),
      label: resolveProjectionToolActionLabel(item),
    });
  }

  if (isProjectionSubagentPromptItem(item)) {
    const subagent = resolveProjectionSubagent(item);
    return {
      kind: "subagent-prompt",
      text: item.text,
      ...(subagent && { subagent }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  const bashApproval = readProjectionBashApprovalMetadata(item);
  if (bashApproval) {
    return buildProjectionToolActionBlock(item, {
      toolName: bashApproval.toolName,
      label: formatToolDisplayLabel(bashApproval.toolName, bashApproval.detail),
      lifecycle: bashApprovalPhaseToLifecycle(bashApproval.phase),
      ...(bashApproval.description && { description: bashApproval.description }),
    });
  }

  if (item.eventType === "message.delta" || item.eventType === "message.final") {
    if (!text && item.eventType !== "message.delta") {
      return undefined;
    }
    const origin = resolveThreadActivityOrigin(item);
    if (isRequestFailureFeedNoiseOrigin(origin)) {
      return undefined;
    }
    if (isUpstreamErrorPhaseOrigin(origin) && item.eventType === "message.final") {
      return { kind: "phase", label: text };
    }
    const subagent = resolveProjectionSubagent(item);
    return {
      kind: "narrative",
      text: item.text,
      streaming: item.eventType === "message.delta",
      ...(subagent && { subagent }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "thinking.delta" || item.eventType === "thinking.final") {
    if (!text && item.eventType === "thinking.final") {
      return undefined;
    }
    const streaming = item.eventType === "thinking.delta";
    const thinkingStartedAt = readThinkingStartedAt(item.metadata);
    const thinkingDurationMs = readFiniteNonNegativeNumber(item.metadata?.thinkingDurationMs);
    return {
      kind: "thinking",
      text: item.text,
      streaming,
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
      ...(thinkingStartedAt && { startedAt: thinkingStartedAt }),
      ...(!streaming && { endedAt: item.at }),
      ...(!streaming && thinkingDurationMs !== undefined && { durationMs: thinkingDurationMs }),
    };
  }

  if (item.eventType === "request.started") {
    if (item.scope === "agent" || item.agentId) {
      const subagent = resolveProjectionSubagent(item);
      return {
        kind: "agent-request",
        ...(subagent && { subagent }),
        ...(item.agentId && { agentId: item.agentId }),
      };
    }
    return {
      kind: "model-request",
      ...(item.role && { role: item.role }),
    };
  }

  if (item.eventType === "api.error") {
    const apiError = readProjectionApiError(item);
    const subagent = resolveProjectionSubagent(item);
    return {
      kind: "api-error",
      message: apiError?.message ?? text,
      ...(apiError?.statusCode !== undefined && { statusCode: apiError.statusCode }),
      ...(apiError?.code && { code: apiError.code }),
      ...(subagent && { subagent }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.failed") {
    const subagent = resolveProjectionSubagent(item);
    const tool = resolveProjectionToolName(item);
    const metadataTool = readProjectionToolMetadata(item);
    const command = tool === "Bash" ? metadataTool?.detail?.trim() : undefined;
    const output = metadataTool?.outputPreview?.trim();
    const recoveredResult = resolvePatchAppliedNegativeSearchResult({
      ...(command && { command }),
      ...(output && { output }),
      ...(metadataTool?.exitCode !== undefined && { exitCode: metadataTool.exitCode }),
    });
    const commandMessage = command ? i18n.t("projection.bashCommand", { command }) : undefined;
    const failureMessage = stripProjectionToolFailurePrefix(text, tool);
    const error = recoveredResult ? "" : output || (text !== commandMessage ? failureMessage : "");
    return {
      kind: "tool-failed",
      tool,
      ...(command && { command }),
      ...(error && { error }),
      ...(recoveredResult && { recoveredResult }),
      ...(subagent && { subagent }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.started" || item.eventType === "tool.completed") {
    const metadataTool = readProjectionToolMetadata(item);
    const lifecycle = toolStatusToLifecycle(metadataTool?.status, item.eventType);
    const block = buildProjectionToolActionBlock(item, {
      toolName: resolveProjectionToolName(item),
      label: resolveProjectionToolActionLabel(item),
      ...(lifecycle && { lifecycle }),
    });
    if (shouldSuppressFilesystemToolPlaceholder(block, metadataTool)) {
      return undefined;
    }
    return block;
  }

  if (isProjectionThreadFailure(item)) {
    return {
      kind: "api-error",
      message: text || i18n.t("activity.executionFailed"),
      title: i18n.t("activity.executionFailed"),
    };
  }

  const phaseLabel = resolveProjectionPhaseLabel(item);
  if (phaseLabel) {
    const timeline = readPromptCacheTimelineMetadata(item.metadata);
    if (timeline) {
      return {
        kind: "prompt-cache-timeline",
        narrative: timeline.narrative,
        steps: timeline.steps,
      };
    }
    return { kind: "phase", label: phaseLabel };
  }
  return undefined;
}

function isProjectionThreadFailure(item: ThreadRunProjectionTimelineItem): boolean {
  if (item.eventType !== "thread.status") {
    return false;
  }
  const liveType = projectionLiveType(item);
  return (
    liveType === "thread.blocked" ||
    liveType === "thread.execution_failed" ||
    liveType === "thread.failed"
  );
}

function stripProjectionToolFailurePrefix(message: string, toolName: string): string {
  const prefix = `Tool failed: ${toolName}:`;
  return message.startsWith(prefix) ? message.slice(prefix.length).trim() : message;
}

function resolvePatchAppliedNegativeSearchResult(input: {
  command?: string;
  output?: string;
  exitCode?: number;
}):
  | {
      kind: "patch-applied-verification-empty";
      files: Array<{ status: string; path: string }>;
    }
  | undefined {
  if (input.exitCode !== 1 || !input.command || !input.output) {
    return undefined;
  }
  const heredoc = input.command.match(/apply_patch\s+<<\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/u);
  const delimiter = heredoc?.[1];
  if (!delimiter) {
    return undefined;
  }
  const delimiterOffset = input.command.lastIndexOf(`\n${delimiter}\n`);
  if (delimiterOffset < 0) {
    return undefined;
  }
  const trailingCommand = input.command
    .slice(delimiterOffset + delimiter.length + 2)
    .replace(/["']\s*$/u, "")
    .trim();
  if (!/^rg(?:\s|$)/u.test(trailingCommand)) {
    return undefined;
  }

  const lines = input.output.split(/\r?\n/u).filter(Boolean);
  if (lines[0] !== "Success. Updated the following files:") {
    return undefined;
  }
  const files = lines.slice(1).map((line) => {
    const match = line.match(/^([AMDR])\s+(.+)$/u);
    return match?.[1] && match[2] ? { status: match[1], path: match[2] } : undefined;
  });
  if (files.length === 0 || files.some((file) => !file)) {
    return undefined;
  }
  return {
    kind: "patch-applied-verification-empty",
    files: files.filter((file): file is { status: string; path: string } => Boolean(file)),
  };
}

function formatReconnectPhaseSummary(
  summary: string,
  reconnect: NonNullable<ReturnType<typeof resolveReconnectPhaseDisplay>>,
  metadata: Record<string, unknown> | undefined,
): string {
  const collapse = readReconnectCollapseMetadata(metadata);
  if (!collapse) {
    return summary;
  }
  if (reconnect.failed) {
    const failedCount = collapse.failedCount || collapse.count;
    return failedCount > 1 ? `${summary} ×${failedCount}` : summary;
  }
  if (collapse.failedCount > 1) {
    return i18n.t("projection.reconnectFailures", {
      summary,
      count: collapse.failedCount,
    });
  }
  return summary;
}

export function isProjectionRequestActive(
  span: ThreadRunProjectionSnapshot["requestSpans"][number] | undefined,
): boolean {
  return span?.status === "waiting_first_token" || span?.status === "streaming";
}

export function isProjectionUserPromptItem(item: ThreadRunProjectionTimelineItem): boolean {
  const liveType = projectionLiveType(item);
  if (!isRecordedUserPromptLiveEvent(liveType)) {
    return false;
  }
  return item.text.trim().length > 0 && !isThreadFollowUpActivityMessage(item.text);
}

export function isProjectionSubagentPromptItem(item: ThreadRunProjectionTimelineItem): boolean {
  return item.scope === "agent" && projectionLiveType(item) === "message.user" && item.text.trim().length > 0;
}

export function resolveProjectionAgentStatusText(agent: ThreadRunProjectionAgent): string | undefined {
  const speech = findLatestAgentSpeechSummary(agent.timeline);
  if (speech) {
    return speech;
  }
  const latest = agent.latestActivity?.trim();
  if (!latest || isProjectionLifecycleText(latest) || latest === "状态已更新") {
    const action = findLatestAgentToolAction(agent.timeline);
    return action ? resolveProjectionToolStatusPreview(action) : undefined;
  }
  return clampActivityPreviewLine(latest);
}

function findLatestAgentSpeechSummary(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): string | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (!item) {
      continue;
    }
    const text = firstReadableLine(item.text);
    if (!text) {
      continue;
    }
    if (isProjectionTodoStatusItem(item)) {
      continue;
    }
    if (isSubagentMissionEnvelope(item.text)) {
      continue;
    }
    if (item.eventType === "message.delta" || item.eventType === "message.final") {
      return text;
    }
    if (item.eventType === "thinking.delta" || item.eventType === "thinking.final") {
      return i18n.t("projection.thinking", { text });
    }
  }
  return undefined;
}

function findLatestAgentToolAction(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem | undefined {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index];
    if (!item) {
      continue;
    }
    if (
      item.eventType === "tool.started" ||
      item.eventType === "tool.completed" ||
      item.eventType === "tool.failed" ||
      isProjectionTodoToolActionItem(item)
    ) {
      return item;
    }
  }
  return undefined;
}

function firstReadableLine(text: string): string {
  return clampActivityPreviewLine(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? "",
  );
}

function projectionLiveType(item: ThreadRunProjectionTimelineItem): string | undefined {
  const liveType = item.metadata?.liveType;
  return typeof liveType === "string" ? liveType : undefined;
}

function readUnprojectedCodexItem(item: ThreadRunProjectionTimelineItem): {
  itemType: string;
  phase?: "started" | "completed";
  payload?: string;
} | undefined {
  if (projectionLiveType(item) !== "codex.item.unprojected") {
    return undefined;
  }
  const itemTypeRaw = item.metadata?.itemType;
  const itemType =
    typeof itemTypeRaw === "string" && itemTypeRaw.trim()
      ? itemTypeRaw.trim()
      : item.text.replace(/^未知类型\s*·\s*/u, "").trim() || "unknown";
  const phaseRaw = item.metadata?.unprojectedPhase;
  const phase: "started" | "completed" =
    phaseRaw === "started" || phaseRaw === "completed" ? phaseRaw : "completed";
  const payloadRaw = item.metadata?.payloadJson;
  const payload = typeof payloadRaw === "string" && payloadRaw.trim() ? payloadRaw : undefined;
  return {
    itemType,
    phase,
    ...(payload ? { payload } : {}),
  };
}

function isProjectionTodoStatusItem(item: ThreadRunProjectionTimelineItem): boolean {
  return projectionLiveType(item) === "todo.updated";
}

function isProjectionTodoToolActionItem(item: ThreadRunProjectionTimelineItem): boolean {
  return isProjectionTodoStatusItem(item) && Boolean(readProjectionToolMetadata(item));
}

function readProjectionApiError(
  item: ThreadRunProjectionTimelineItem,
): { message: string; statusCode?: number; code?: string } | undefined {
  const raw = item.metadata?.apiError;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (!message) {
    return undefined;
  }
  return {
    message,
    ...(typeof record.statusCode === "number" && { statusCode: record.statusCode }),
    ...(typeof record.code === "string" && record.code.trim() && { code: record.code.trim() }),
  };
}

function readProjectionToolMetadata(
  item: ThreadRunProjectionTimelineItem,
): ThreadRunToolMetadata | undefined {
  const raw = item.metadata?.tool;
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!name) {
    return undefined;
  }
  const fileChange = parseThreadRunFileChangeMetadata(record.fileChange);
  const readTarget = parseThreadRunReadToolTarget(record.readTarget);
  const grepTarget = parseThreadRunGrepToolTarget(record.grepTarget);
  return {
    name,
    ...(typeof record.detail === "string" && record.detail.trim() && { detail: record.detail.trim() }),
    ...(typeof record.outputPreview === "string" &&
      record.outputPreview.trim() && { outputPreview: record.outputPreview.trim() }),
    ...(record.outputPreviewTruncated === true && { outputPreviewTruncated: true }),
    ...(typeof record.toolUseId === "string" &&
      record.toolUseId.trim() && { toolUseId: record.toolUseId.trim() }),
    ...(typeof record.durationMs === "number" &&
      Number.isFinite(record.durationMs) && { durationMs: record.durationMs }),
    ...(typeof record.exitCode === "number" &&
      Number.isFinite(record.exitCode) && { exitCode: record.exitCode }),
    ...(isProjectionToolStatus(record.status) && { status: record.status }),
    ...(typeof record.description === "string" &&
      record.description.trim() && { description: record.description.trim() }),
    ...(fileChange && { fileChange }),
    ...(readTarget && { readTarget }),
    ...(grepTarget && { grepTarget }),
  };
}

function isProjectionToolStatus(value: unknown): value is NonNullable<ThreadRunToolMetadata["status"]> {
  return value === "started" || value === "completed" || value === "failed";
}

function isProjectionLifecycleText(text: string): boolean {
  return /^Subagent\s+\S+\s+(started|stopped|abandoned)$/i.test(text);
}

function resolveProjectionPhaseLabel(item: ThreadRunProjectionTimelineItem): string | undefined {
  const text = item.text.trim();
  if (item.eventType === "context.compaction.started") {
    return text || i18n.t("projection.compactionStarted");
  }
  if (item.eventType === "context.compaction.completed") {
    return text || i18n.t("projection.compactionCompleted");
  }
  if (item.eventType === "context.compaction.failed") {
    return text || i18n.t("projection.compactionFailed");
  }
  if (item.eventType === "context.compaction.suspended") {
    return text || i18n.t("projection.compactionSuspended");
  }
  if (item.eventType === "context.cache_config_drift") {
    return text || i18n.t("projection.configChanged");
  }
  if (item.eventType === "context.cache_invalidated") {
    return text || i18n.t("projection.cacheInvalidated");
  }
  if (item.eventType === "billing.cache_hit_dropped") {
    return text || i18n.t("projection.cacheHitDropped");
  }
  if (item.eventType === "agent.started") {
    return i18n.t("projection.agentStarted", {
      agent: resolveSubagentRunDisplayTitle(item.role ?? i18n.t("projection.subagent")),
    });
  }
  if (item.eventType === "agent.stopped") {
    return i18n.t("projection.agentCompleted", {
      agent: resolveSubagentRunDisplayTitle(item.role ?? i18n.t("projection.subagent")),
    });
  }
  if (item.eventType === "agent.abandoned") {
    return i18n.t("projection.agentAbandoned", {
      agent: resolveSubagentRunDisplayTitle(item.role ?? i18n.t("projection.subagent")),
    });
  }
  if (item.eventType === "request.retry_scheduled") {
    return text || i18n.t("projection.retrying");
  }
  if (
    item.eventType === "request.completed" ||
    item.eventType === "request.failed" ||
    item.eventType === "request.cancelled"
  ) {
    return undefined;
  }
  if (item.eventType === "diagnostic") {
    return text || i18n.t("projection.diagnostic");
  }
  if (item.eventType === "thread.status") {
    if (!text || text === "状态已更新" || isProjectionLifecycleText(text)) {
      return undefined;
    }
    return text;
  }
  return undefined;
}

function resolveProjectionToolName(item: ThreadRunProjectionTimelineItem): string {
  const metadataTool = readProjectionToolMetadata(item);
  if (metadataTool?.name.trim()) {
    return metadataTool.name;
  }
  return i18n.t("projection.tool");
}

function resolveProjectionToolActionLabel(item: ThreadRunProjectionTimelineItem): string {
  const metadataTool = readProjectionToolMetadata(item);
  if (metadataTool) {
    return formatProjectionToolActionLabel(metadataTool);
  }
  return item.eventType === "tool.completed"
    ? i18n.t("projection.toolCompleted")
    : i18n.t("projection.toolCall");
}

function formatProjectionToolActionLabel(tool: ThreadRunToolMetadata): string {
  const base = formatProjectionToolBaseLabel(tool);
  if (tool.durationMs === undefined) {
    return base;
  }
  return `${base} (${(tool.durationMs / 1000).toFixed(1)}s)`;
}

function resolveProjectionToolStatusPreview(item: ThreadRunProjectionTimelineItem): string {
  const metadataTool = readProjectionToolMetadata(item);
  if (metadataTool) {
    const base = formatToolStatusPreview(metadataTool.name, formatThreadRunToolDetailLabel(metadataTool));
    if (metadataTool.durationMs === undefined) {
      return base;
    }
    return `${base} (${(metadataTool.durationMs / 1000).toFixed(1)}s)`;
  }
  const label = resolveProjectionToolActionLabel(item);
  return clampActivityPreviewLine(
    label
      .replace(/^Tool:\s*/iu, "")
      .replace(/\s+\(\d+(?:\.\d+)?s\)$/iu, "")
      .trim(),
  );
}

function formatProjectionToolBaseLabel(tool: ThreadRunToolMetadata): string {
  const structuredDetail = formatThreadRunToolDetailLabel(tool);
  return formatToolDisplayLabel(tool.name, structuredDetail);
}

function readProjectionDelegationMetadata(
  item: ThreadRunProjectionTimelineItem,
): { subagent: string; summary: string; prompt?: string } | undefined {
  const metadata = item.metadata;
  const summary = typeof metadata?.delegationSummary === "string" ? metadata.delegationSummary.trim() : "";
  const prompt = typeof metadata?.delegationPrompt === "string" ? metadata.delegationPrompt.trim() : "";
  const role = normalizeAgentDisplayRole(item.role) ?? item.role?.trim();
  if (!summary && !prompt) {
    return undefined;
  }
  return {
    subagent: role || i18n.t("projection.subagent"),
    summary: summary || prompt.slice(0, 200),
    ...(prompt && { prompt }),
  };
}

export function readProjectionAgentDelegation(
  agent: Pick<ThreadRunProjectionAgent, "role" | "delegationSummary" | "delegationPrompt">,
): { subagent: string; summary: string; prompt?: string } | undefined {
  const summary = agent.delegationSummary?.trim() ?? "";
  const prompt = agent.delegationPrompt?.trim() ?? "";
  if (!summary && !prompt) {
    return undefined;
  }
  const subagent = normalizeAgentDisplayRole(agent.role) ?? agent.role;
  return {
    subagent,
    summary: summary || prompt.slice(0, 200),
    ...(prompt && { prompt }),
  };
}

/** Mission body for subagent cards — structured attribution only (delegation / parentToolUseId). */
export function resolveSubagentCardMissionText(
  agent: ThreadRunProjectionAgent,
  context: {
    mainTimeline?: readonly ThreadRunProjectionTimelineItem[];
  } = {},
): string {
  const delegation = readProjectionAgentDelegation(agent);
  if (delegation) {
    const text = resolveMissionDisplayText(delegation.prompt?.trim() || delegation.summary);
    if (text) {
      return text;
    }
  }
  for (const item of agent.timeline) {
    if (item.eventType === "agent.started") {
      const timelineDelegation = readProjectionDelegationMetadata(item);
      if (timelineDelegation) {
        const text = resolveMissionDisplayText(
          timelineDelegation.prompt?.trim() || timelineDelegation.summary,
        );
        if (text) {
          return text;
        }
      }
    }
    const mission = parseSubagentMissionMessage(item.text);
    if (mission) {
      if (mission.agentId?.trim() && mission.agentId.trim() !== agent.agentId) {
        continue;
      }
      if (item.agentId?.trim() && item.agentId.trim() !== agent.agentId) {
        continue;
      }
      const text = resolveMissionDisplayText(mission.prompt || mission.summary);
      if (text) {
        return text;
      }
    }
  }

  const parentToolUseId = agent.parentToolUseId?.trim();
  if (parentToolUseId && context.mainTimeline) {
    for (const item of context.mainTimeline) {
      const toolUseId =
        readProjectionToolMetadata(item)?.toolUseId?.trim() ??
        readProjectionBashApprovalMetadata(item)?.toolUseId?.trim();
      if (toolUseId !== parentToolUseId) {
        continue;
      }
      const mission = parseSubagentMissionMessage(item.text);
      if (!mission) {
        break;
      }
      if (mission.agentId?.trim() && mission.agentId.trim() !== agent.agentId) {
        break;
      }
      const text = resolveMissionDisplayText(mission.prompt || mission.summary);
      if (text) {
        return text;
      }
      break;
    }
  }

  return "";
}
