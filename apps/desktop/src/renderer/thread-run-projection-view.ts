import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadRunToolMetadata,
} from "../shared/ipc";
import {
  bashApprovalPhaseToLifecycle,
  clampActivityPreviewLine,
  compareToolActionLifecyclePriority,
  formatToolDisplayLabel,
  formatToolStatusPreview,
  parseReconnectActivityMessage,
  resolveBashRunCardDisplay,
  resolveFileChangeCardDisplay,
  readBashApprovalMetadata,
  toolStatusToLifecycle,
  type ToolActionLifecycle,
} from "../shared/activity-display";
import {
  isSubagentMissionEnvelope,
  parseSubagentMissionMessage,
  resolveMissionDisplayText,
} from "@eco/runtime";
import {
  iconForToolName,
  resolveSubagentRunDisplayTitle,
  type ActivityDetailBlock,
} from "./activity-log";
import { parseThreadRunFileChangeMetadata } from "../shared/file-change";
import { normalizeAgentDisplayRole } from "../shared/subagent-roles";
import {
  isRecordedUserPromptLiveEvent,
  isThreadFollowUpActivityMessage,
  isThreadFollowUpLiveEvent,
} from "../shared/thread-follow-up-events";
import { type RuntimeAgentDisplayNames, resolveRuntimeAgentName } from "./runtime-agent-display";
import {
  collapsePromptCacheTimelineItems,
  readPromptCacheTimelineMetadata,
} from "../shared/prompt-cache-timeline";

export interface ThreadRunProjectionViewModel {
  showThreadPrompt: boolean;
  mainFeedEntries: ThreadRunProjectionMainFeedEntry[];
  mainItemIds: string[];
  subagentCards: ThreadRunProjectionSubagentCard[];
}

export type ThreadRunProjectionMainFeedEntry =
  | {
      kind: "timeline";
      key: string;
      item: ThreadRunProjectionTimelineItem;
      at: string;
      sequence: number;
    }
  | {
      kind: "agent-echo";
      key: string;
      item: ThreadRunProjectionTimelineItem;
      agent: ThreadRunProjectionAgent;
      agentLabel: string;
      shortAgentId: string;
      at: string;
      sequence: number;
    }
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
}

export function buildThreadRunProjectionViewModel(
  projection: ThreadRunProjectionSnapshot,
  thread?: { id: string; prompt: string },
  options: {
    agentDisplayNames?: RuntimeAgentDisplayNames | undefined;
  } = {},
): ThreadRunProjectionViewModel {
  const hasProjectedUserPrompt = projection.timeline.some(isProjectionUserPromptItem);
  const showThreadPrompt = Boolean(thread?.prompt.trim() && !hasProjectedUserPrompt);
  const requestSpansById = new Map(projection.requestSpans.map((span) => [span.requestId, span]));
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
        ...(statusText && { statusText }),
      };
    });
  const mainFeedEntries = buildProjectionMainFeedEntries(
    projection.timeline,
    subagentCards,
    requestSpansById,
    options.agentDisplayNames,
  );
  return {
    showThreadPrompt,
    mainFeedEntries,
    mainItemIds: mainFeedEntries.map((entry) =>
      entry.kind === "timeline" || entry.kind === "agent-echo" ? entry.item.id : entry.key,
    ),
    subagentCards,
  };
}

function buildProjectionMainFeedEntries(
  mainTimeline: readonly ThreadRunProjectionTimelineItem[],
  subagentCards: readonly ThreadRunProjectionSubagentCard[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
  agentDisplayNames?: RuntimeAgentDisplayNames | undefined,
): ThreadRunProjectionMainFeedEntry[] {
  const displayMainTimeline = filterAbsorbedSubagentDelegations(
    filterMainTimelineForFeed(mainTimeline, requestSpansById),
    subagentCards,
    requestSpansById,
  );
  const entries: ThreadRunProjectionMainFeedEntry[] = displayMainTimeline.map((item) => ({
    kind: "timeline",
    key: `main:${item.id}`,
    item,
    at: item.at,
    sequence: item.sequence,
  }));

  for (const card of subagentCards) {
    entries.push({
      kind: "agent-card",
      key: `agent-card:${card.agent.agentId}`,
      card,
      at: card.agent.startedAt,
      sequence: card.agent.timeline[0]?.sequence ?? 0,
    });

    const echoItems = card.agent.timeline.filter(isAgentEchoTimelineItem);
    for (const item of echoItems) {
      entries.push({
        kind: "agent-echo",
        key: `agent:${card.agent.agentId}:${item.id}`,
        item,
        agent: card.agent,
        agentLabel: formatProjectionAgentLabel(card.agent, agentDisplayNames),
        shortAgentId: shortProjectionAgentId(card.agent.agentId),
        at: item.at,
        sequence: item.sequence,
      });
    }
  }

  return entries.sort(compareMainFeedEntries);
}

function filterMainTimelineForFeed(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem[] {
  const displayTimeline = filterProjectionTimelineForDetailFeed(timeline, requestSpansById);
  const requestFiltered = displayTimeline.filter((item) => !isMainTimelineNoiseItem(item));
  return filterCompactionTimelineForFeed(requestFiltered);
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
    buildProjectionDisplayTimelineItems(timeline, requestSpansById),
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
    displayTimeline.filter((item) => {
    if (isProjectionRequestCompletionItem(item)) {
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
  );
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

function isMainTimelineNoiseItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (isProjectionUserPromptItem(item)) {
    return false;
  }
  if (isProjectionInternalMessageText(item.text) || isThreadFollowUpActivityMessage(item.text)) {
    return true;
  }
  const liveType = projectionLiveType(item);
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
  if (item.eventType !== "thread.status") {
    return false;
  }
  const text = item.text.trim();
  return (
    !text || text === "状态已更新" || isProjectionLifecycleText(text) || isProjectionUsageNoiseText(text)
  );
}

function isProjectionUsageNoiseText(text: string): boolean {
  return /^[↑↓⊙][↑↓⊙\d\s.,kKmM$%·+()-]*$/u.test(text);
}

function isProjectionInternalMessageText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("__eco_worktree_merge__") ||
    trimmed === "执行完成。" ||
    trimmed === "执行完成，变更已写入项目目录。" ||
    trimmed === "执行完成，工作树内无相对基线的文件变更。" ||
    /^正在启动 Claude Agent SDK/u.test(trimmed) ||
    /^Working in project directory:/u.test(trimmed) ||
    /^Local model router ready:/u.test(trimmed) ||
    isProjectionApprovalTransitionStatus(trimmed)
  );
}

function isProjectionApprovalTransitionStatus(text: string): boolean {
  return (
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
  for (const item of timeline) {
    const reconnectKey = projectionReconnectDisplayKey(item);
    if (reconnectKey) {
      const current = latestReconnectDisplayByKey.get(reconnectKey);
      if (!current || compareTimelineItems(current, item) <= 0) {
        latestReconnectDisplayByKey.set(reconnectKey, item);
      }
    }

    const lifecycleKey = projectionToolLifecycleKey(item);
    if (lifecycleKey) {
      const current = latestLifecycleDisplayByKey.get(lifecycleKey);
      if (!current || compareProjectionLifecycleDisplayItems(item, current) > 0) {
        latestLifecycleDisplayByKey.set(lifecycleKey, item);
      }
    }

    const streamKey = projectionStreamDisplayKey(item);
    if (streamKey) {
      const current = latestStreamDisplayByKey.get(streamKey);
      if (!current || compareTimelineItems(current, item) <= 0) {
        latestStreamDisplayByKey.set(streamKey, item);
      }
    }

    const toolKey = projectionToolDisplayKey(item);
    if (toolKey) {
      const current = latestToolDisplayByKey.get(toolKey);
      if (!current || compareProjectionToolDisplayItems(current, item) <= 0) {
        latestToolDisplayByKey.set(toolKey, item);
      }
    }
  }

  const displayItems: ThreadRunProjectionTimelineItem[] = [];
  for (const item of timeline) {
    const reconnectKey = projectionReconnectDisplayKey(item);
    if (reconnectKey && latestReconnectDisplayByKey.get(reconnectKey)?.id !== item.id) {
      continue;
    }
    const lifecycleKey = projectionToolLifecycleKey(item);
    if (lifecycleKey && latestLifecycleDisplayByKey.get(lifecycleKey)?.id !== item.id) {
      continue;
    }
    const streamKey = projectionStreamDisplayKey(item);
    if (streamKey && latestStreamDisplayByKey.get(streamKey)?.id !== item.id) {
      continue;
    }
    const toolKey = projectionToolDisplayKey(item);
    if (toolKey && latestToolDisplayByKey.get(toolKey)?.id !== item.id) {
      continue;
    }
    const settled = settleTerminalStreamDisplayItem(item, requestSpansById);
    if (settled) {
      displayItems.push(settled);
    }
  }
  return displayItems;
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
export function isThreadAutoCompactSuspended(
  projection: ThreadRunProjectionSnapshot | undefined,
): boolean {
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
export function isThreadPromptCacheInvalidated(
  projection: ThreadRunProjectionSnapshot | undefined,
): boolean {
  return (
    projection?.timeline.some((item) => item.eventType === "context.cache_invalidated") ?? false
  );
}

/** Orphaned compaction.started without a terminal event stops blocking the UI after this long. */
const COMPACTION_IN_FLIGHT_STALE_MS = 2 * 60 * 1000;

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
    if (
      Number.isFinite(startedAtMs) &&
      nowMs - startedAtMs > COMPACTION_IN_FLIGHT_STALE_MS
    ) {
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
    Boolean(span && isProjectionRequestActive(span)) &&
    compareTimelineItems(streamItem, requestStarted) > 0
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

function isProjectionRequestCompletionItem(item: ThreadRunProjectionTimelineItem): boolean {
  return item.eventType === "request.completed" || item.eventType === "request.cancelled";
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
  return parseReconnectActivityMessage(item.text.trim()) ? "reconnect" : undefined;
}

function projectionStreamDisplayKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (!isStreamingRequestDisplayItem(item)) {
    return undefined;
  }
  const channel =
    item.eventType === "thinking.delta" || item.eventType === "thinking.final" ? "thinking" : "message";
  return `${channel}:${projectionRequestKey(item) ?? projectionOwnerKey(item) ?? item.id}`;
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

function resolveProjectionToolLifecycle(item: ThreadRunProjectionTimelineItem): ToolActionLifecycle | undefined {
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

function projectionToolDisplayRichness(item: ThreadRunProjectionTimelineItem): number {
  const metadataTool = readProjectionToolMetadata(item);
  if (!metadataTool) {
    return 0;
  }
  return (
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

function compareTimelineItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
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

function compareMainFeedEntries(
  left: ThreadRunProjectionMainFeedEntry,
  right: ThreadRunProjectionMainFeedEntry,
): number {
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

function isAgentEchoTimelineItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (isProjectionTodoStatusItem(item)) {
    return false;
  }
  if (isSubagentMissionEnvelope(item.text)) {
    return false;
  }
  if (
    item.eventType !== "message.delta" &&
    item.eventType !== "message.final" &&
    item.eventType !== "thinking.delta" &&
    item.eventType !== "thinking.final"
  ) {
    return false;
  }
  return item.text.trim().length > 0;
}

export function formatProjectionAgentLabel(
  agent: Pick<ThreadRunProjectionAgent, "agentId" | "role">,
  displayNames?: RuntimeAgentDisplayNames | undefined,
): string {
  return `${resolveRuntimeAgentName(agent.role, displayNames) ?? resolveSubagentRunDisplayTitle(agent.role)} #${shortProjectionAgentId(agent.agentId)}`;
}

export function shortProjectionAgentId(agentId: string): string {
  if (agentId.length <= 8) {
    return agentId;
  }
  return agentId.slice(-8);
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
    summaryText: item.text,
    ...(metadataTool?.output && { output: metadataTool.output }),
    ...(metadataTool?.durationMs !== undefined && { durationMs: metadataTool.durationMs }),
    ...(description && { description }),
  });
  const fileChange = resolveFileChangeCardDisplay(metadataTool?.fileChange);
  return {
    kind: "action",
    icon: iconForToolName(input.toolName),
    label: input.label,
    ...(input.lifecycle && { lifecycle: input.lifecycle }),
    ...(bashRun && { bashRun }),
    ...(fileChange && { fileChange }),
    ...(subagent && { subagent }),
    ...(item.agentId && { agentId: item.agentId }),
  };
}

export function projectionItemToDetailBlock(
  item: ThreadRunProjectionTimelineItem,
): ActivityDetailBlock | undefined {
  const text = item.text.trim();
  const reconnect = parseReconnectActivityMessage(text);
  if (reconnect) {
    return {
      kind: "phase",
      label: reconnect.summary,
      reconnecting: true,
      ...(reconnect.detail && { reconnectDetail: reconnect.detail }),
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
    return {
      kind: "thinking",
      text: item.text,
      streaming: item.eventType === "thinking.delta",
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
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
    return {
      kind: "tool-failed",
      tool: resolveProjectionToolName(item),
      ...(text && { error: text }),
      ...(subagent && { subagent }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.started" || item.eventType === "tool.completed") {
    const metadataTool = readProjectionToolMetadata(item);
    const lifecycle = toolStatusToLifecycle(metadataTool?.status, item.eventType);
    return buildProjectionToolActionBlock(item, {
      toolName: resolveProjectionToolName(item),
      label: resolveProjectionToolActionLabel(item),
      ...(lifecycle && { lifecycle }),
    });
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
      return `思考：${text}`;
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
  return {
    name,
    ...(typeof record.detail === "string" && record.detail.trim() && { detail: record.detail.trim() }),
    ...(typeof record.output === "string" && record.output.trim() && { output: record.output.trim() }),
    ...(typeof record.toolUseId === "string" &&
      record.toolUseId.trim() && { toolUseId: record.toolUseId.trim() }),
    ...(typeof record.durationMs === "number" &&
      Number.isFinite(record.durationMs) && { durationMs: record.durationMs }),
    ...(isProjectionToolStatus(record.status) && { status: record.status }),
    ...(typeof record.description === "string" &&
      record.description.trim() && { description: record.description.trim() }),
    ...((): { fileChange?: ThreadRunToolMetadata["fileChange"] } => {
      const fileChange = parseThreadRunFileChangeMetadata(record.fileChange);
      return fileChange ? { fileChange } : {};
    })(),
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
    return text || "正在自动压缩上下文";
  }
  if (item.eventType === "context.compaction.completed") {
    return text || "上下文已自动压缩";
  }
  if (item.eventType === "context.compaction.failed") {
    return text || "上下文压缩失败";
  }
  if (item.eventType === "context.compaction.suspended") {
    return text || "自动上下文压缩已暂停";
  }
  if (item.eventType === "context.cache_config_drift") {
    return text || "Composer 配置已变更";
  }
  if (item.eventType === "context.cache_invalidated") {
    return text || "本会话 prompt cache 已失效";
  }
  if (item.eventType === "billing.cache_hit_dropped") {
    return text || "Prompt cache 命中率大幅下降";
  }
  if (item.eventType === "context.tool_output_truncated") {
    return text || "Tool 输出已截断";
  }
  if (item.eventType === "agent.started") {
    return `${resolveSubagentRunDisplayTitle(item.role ?? "子代理")} 已启动`;
  }
  if (item.eventType === "agent.stopped") {
    return `${resolveSubagentRunDisplayTitle(item.role ?? "子代理")} 已完成`;
  }
  if (item.eventType === "agent.abandoned") {
    return `${resolveSubagentRunDisplayTitle(item.role ?? "子代理")} 已中止`;
  }
  if (item.eventType === "request.retry_scheduled") {
    return text || "准备重试";
  }
  if (item.eventType === "request.completed") {
    return text || "模型请求完成";
  }
  if (item.eventType === "request.failed") {
    return text || "模型请求失败";
  }
  if (item.eventType === "request.cancelled") {
    return text || "模型请求已取消";
  }
  if (item.eventType === "diagnostic") {
    return text || "运行诊断";
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
  return "Tool";
}

function resolveProjectionToolActionLabel(item: ThreadRunProjectionTimelineItem): string {
  const metadataTool = readProjectionToolMetadata(item);
  if (metadataTool) {
    return formatProjectionToolActionLabel(metadataTool);
  }
  return item.eventType === "tool.completed" ? "工具完成" : "工具调用";
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
    const base = formatToolStatusPreview(metadataTool.name, metadataTool.detail);
    if (metadataTool.durationMs === undefined) {
      return base;
    }
    return `${base} (${(metadataTool.durationMs / 1000).toFixed(1)}s)`;
  }
  const label = resolveProjectionToolActionLabel(item);
  return clampActivityPreviewLine(label.replace(/^Tool:\s*/iu, "").replace(/\s+\(\d+(?:\.\d+)?s\)$/iu, "").trim());
}

function formatProjectionToolBaseLabel(tool: ThreadRunToolMetadata): string {
  return formatToolDisplayLabel(tool.name, tool.detail);
}

function readProjectionDelegationMetadata(
  item: ThreadRunProjectionTimelineItem,
): { subagent: string; summary: string; prompt?: string } | undefined {
  const metadata = item.metadata;
  const summary =
    typeof metadata?.delegationSummary === "string" ? metadata.delegationSummary.trim() : "";
  const prompt = typeof metadata?.delegationPrompt === "string" ? metadata.delegationPrompt.trim() : "";
  const role = normalizeAgentDisplayRole(item.role) ?? item.role?.trim();
  if (!summary && !prompt) {
    return undefined;
  }
  return {
    subagent: role || "子代理",
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
