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
  isToolProgressStatusText,
  resolveBashRunCardDisplay,
  resolveFileChangeCardDisplay,
  readBashApprovalMetadata,
  toolStatusToLifecycle,
  type ToolActionLifecycle,
} from "../shared/activity-display";
import {
  formatThreadRunToolDetailLabel,
  resolveGrepToolTargetDisplay,
  resolveGrepToolTargetDisplayFromToolMetadata,
  resolveReadToolTargetDisplayFromToolMetadata,
} from "../shared/tool-target";
import {
  isReconnectActivityOrigin,
  isRequestFailureFeedNoiseOrigin,
  isTimelineItemSupersededByRecovery,
  isUpstreamErrorPhaseOrigin,
  resolveReconnectPhaseDisplay,
  resolveThreadActivityOrigin,
} from "../shared/thread-activity-origin";
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
import {
  parseThreadRunGrepToolTarget,
  parseThreadRunReadToolTarget,
} from "../shared/tool-target";
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
  const toolSortAnchors = buildToolLifecycleSortAnchors([
    ...mainTimeline,
    ...subagentCards.flatMap((card) => card.agent.timeline),
  ]);
  const entries: ThreadRunProjectionMainFeedEntry[] = displayMainTimeline.map((item) => {
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

    const echoItems = card.agent.timeline.filter(isAgentEchoTimelineItem);
    for (const item of echoItems) {
      const sortAnchor = resolveFeedEntrySortAnchor(item, toolSortAnchors);
      entries.push({
        kind: "agent-echo",
        key: projectionMainFeedEntryKey(item, {
          agentId: card.agent.agentId,
          requestSpansById,
          timeline: card.agent.timeline,
        }),
        item,
        agent: card.agent,
        agentLabel: formatProjectionAgentLabel(card.agent, agentDisplayNames),
        shortAgentId: shortProjectionAgentId(card.agent.agentId),
        at: sortAnchor.at,
        sequence: sortAnchor.sequence,
      });
    }
  }

  return entries.sort((left, right) => compareMainFeedEntries(left, right, requestSpansById));
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
    filterProjectionToolProgressNoiseItems(
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
    ),
  );
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
  return (
    metadataTool.name === "Read" ||
    metadataTool.name === "NotebookRead" ||
    metadataTool.name === "Grep"
  );
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
        other.id !== item.id &&
        (isStructuredFilesystemToolItem(other) || isFilesystemToolEvent(other)),
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
    metadataTool.name === "Read" ||
    metadataTool.name === "NotebookRead" ||
    metadataTool.name === "Grep";

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

function isMainTimelineNoiseItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (isProjectionUserPromptItem(item)) {
    return false;
  }
  if (isRequestFailureFeedNoiseItem(item)) {
    return true;
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
  const latestOriginalApiErrorDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of timeline) {
    const reconnectKey = projectionReconnectDisplayKey(item);
    if (reconnectKey) {
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
        latestLifecycleDisplayByKey.set(lifecycleKey, item);
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
    const reconnectKey = projectionReconnectDisplayKey(item);
    if (reconnectKey) {
      if (latestReconnectDisplayByKey.get(reconnectKey)?.id !== item.id) {
        continue;
      }
      if (isTimelineItemSupersededByRecovery(timeline, item, compareTimelineItems)) {
        continue;
      }
    }
    const upstreamErrorKey = projectionUpstreamErrorDisplayKey(item);
    if (upstreamErrorKey) {
      if (latestOriginalApiErrorDisplayByKey.get(upstreamErrorKey)?.id !== item.id) {
        continue;
      }
      if (isTimelineItemSupersededByRecovery(timeline, item, compareTimelineItems)) {
        continue;
      }
    }
    const lifecycleKey = projectionToolLifecycleKey(item);
    if (lifecycleKey && latestLifecycleDisplayByKey.get(lifecycleKey)?.id !== item.id) {
      continue;
    }
    const streamKey = projectionStreamDisplayKey(item, requestSpansById, timeline);
    let displayItem = item;
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
    const settled = settleTerminalStreamDisplayItem(displayItem, requestSpansById);
    if (settled) {
      displayItems.push(settled);
    }
  }
  return displayItems;
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

/** @deprecated Use appendStreamScopeSuffix */
function appendThinkingStreamScopeSuffix(
  key: string,
  item: ThreadRunProjectionTimelineItem,
  effectiveRequestId?: string,
): string {
  return appendStreamScopeSuffix(key, item, effectiveRequestId);
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
    const isThinking =
      entry.eventType === "thinking.delta" || entry.eventType === "thinking.final";
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
  const isThinkingStream =
    item.eventType === "thinking.delta" || item.eventType === "thinking.final";
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
  if (preservedText === item.text) {
    return item;
  }
  return { ...item, text: preservedText };
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
  const mergedTool: ThreadRunToolMetadata = {
    ...placeholderTool,
    ...richerTool,
    ...(richerTool.readTarget || placeholderTool?.readTarget
      ? { readTarget: richerTool.readTarget ?? placeholderTool?.readTarget }
      : {}),
    ...(richerTool.grepTarget || placeholderTool?.grepTarget
      ? { grepTarget: richerTool.grepTarget ?? placeholderTool?.grepTarget }
      : {}),
    detail: richerTool.detail ?? placeholderTool?.detail,
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
    item.role === "thinking" ||
    item.eventType === "thinking.delta" ||
    item.eventType === "thinking.final";
  if (isThinkingStream) {
    const plannerRequestId = resolveNearestPlannerRequestId(item, timeline, requestSpansById);
    if (plannerRequestId) {
      return plannerRequestId;
    }
    const itemIndex = timeline.findIndex((entry) => entry.id === item.id);
    const turnBoundaryIndex = itemIndex >= 0 ? resolveTurnBoundaryIndex(timeline, itemIndex) : -1;
    const boundaryItem = turnBoundaryIndex >= 0 ? timeline[turnBoundaryIndex] : undefined;
    const hasUserPromptInTurn = Boolean(boundaryItem && isProjectionUserPromptItem(boundaryItem));
    if (!hasUserPromptInTurn) {
      const itemRequestId = item.requestId?.trim();
      if (itemRequestId && requestSpansById?.has(itemRequestId)) {
        return itemRequestId;
      }
    }
    return undefined;
  }
  return item.requestId?.trim() || undefined;
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
  if (requestId && requestSpansById) {
    const span = requestSpansById.get(requestId);
    if (span && !isProjectionRequestActive(span)) {
      return `${channel}:request:${requestId}`;
    }
  }
  const streamKey = item.streamKey?.trim();
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
  const readTarget = metadataTool ? resolveReadToolTargetDisplayFromToolMetadata(metadataTool) : undefined;
  const grepTarget = metadataTool ? resolveGrepToolTargetDisplayFromToolMetadata(metadataTool) : undefined;
  return {
    kind: "action",
    icon: iconForToolName(input.toolName),
    label: input.label,
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
      label: reconnect.summary,
      reconnecting: true,
      ...(reconnect.failed && { reconnectFailed: true }),
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
  const fileChange = parseThreadRunFileChangeMetadata(record.fileChange);
  const readTarget = parseThreadRunReadToolTarget(record.readTarget);
  const grepTarget = parseThreadRunGrepToolTarget(record.grepTarget);
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
    const base = formatToolStatusPreview(
      metadataTool.name,
      formatThreadRunToolDetailLabel(metadataTool),
    );
    if (metadataTool.durationMs === undefined) {
      return base;
    }
    return `${base} (${(metadataTool.durationMs / 1000).toFixed(1)}s)`;
  }
  const label = resolveProjectionToolActionLabel(item);
  return clampActivityPreviewLine(label.replace(/^Tool:\s*/iu, "").replace(/\s+\(\d+(?:\.\d+)?s\)$/iu, "").trim());
}

function formatProjectionToolBaseLabel(tool: ThreadRunToolMetadata): string {
  const structuredDetail = formatThreadRunToolDetailLabel(tool);
  return formatToolDisplayLabel(tool.name, structuredDetail);
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
