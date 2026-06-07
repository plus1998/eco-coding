import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";
import {
  resolveSubagentRunDisplayTitle,
  type ActivityActionIcon,
  type ActivityDetailBlock,
} from "./activity-log";

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
}

export function buildThreadRunProjectionViewModel(
  projection: ThreadRunProjectionSnapshot,
  thread?: { id: string; prompt: string },
): ThreadRunProjectionViewModel {
  const hasProjectedUserPrompt = projection.timeline.some(isProjectionUserPromptItem);
  const showThreadPrompt = Boolean(thread?.prompt.trim() && !hasProjectedUserPrompt);
  const requestSpansById = new Map(projection.requestSpans.map((span) => [span.requestId, span]));
  const subagentCards = projection.agents
    .filter((agent) => agent.kind === "subagent")
    .map((agent) => {
      const displayTimeline = buildProjectionDisplayTimelineItems(agent.timeline, requestSpansById);
      const displayAgent: ThreadRunProjectionAgent = { ...agent, timeline: displayTimeline };
      const statusText = resolveProjectionAgentStatusText(displayAgent);
      return {
        key: agent.agentId,
        agent: displayAgent,
        timelineIds: displayTimeline.map((item) => item.id),
        running: agent.status === "active" || agent.status === "launching",
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
): ThreadRunProjectionMainFeedEntry[] {
  const displayMainTimeline = filterMainTimelineForFeed(mainTimeline, requestSpansById);
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
        agentLabel: formatProjectionAgentLabel(card.agent),
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
  const displayTimeline = buildProjectionDisplayTimelineItems(timeline, requestSpansById);
  const requestsWithStreamRows = new Set(
    displayTimeline
      .filter(isStreamingRequestDisplayItem)
      .map(projectionRequestKey)
      .filter((key): key is string => Boolean(key)),
  );
  const ownersWithStreamRows = new Set(
    displayTimeline
      .filter(isStreamingRequestDisplayItem)
      .map(projectionOwnerKey)
      .filter((key): key is string => Boolean(key)),
  );

  const requestFiltered = displayTimeline.filter((item) => {
    if (isMainTimelineNoiseItem(item)) {
      return false;
    }
    if (isProjectionRequestCompletionItem(item)) {
      return false;
    }
    if (item.eventType !== "request.started") {
      return true;
    }
    const requestSpan = projectionRequestSpan(item, requestSpansById);
    if (requestSpan && !isProjectionRequestActive(requestSpan)) {
      return false;
    }
    const requestKey = projectionRequestKey(item);
    if (requestKey && requestsWithStreamRows.has(requestKey)) {
      return false;
    }
    const ownerKey = projectionOwnerKey(item);
    return !ownerKey || !ownersWithStreamRows.has(ownerKey);
  });
  return filterCompactionTimelineForFeed(requestFiltered);
}

function isMainTimelineNoiseItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (isProjectionUserPromptItem(item)) {
    return false;
  }
  if (isProjectionInternalMessageText(item.text)) {
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
    !text ||
    text === "状态已更新" ||
    isProjectionLifecycleText(text) ||
    isProjectionUsageNoiseText(text)
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
    /^Local model router ready:/u.test(trimmed)
  );
}

export function buildProjectionDisplayTimelineItems(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  requestSpansById: ReadonlyMap<string, ThreadRunProjectionSnapshot["requestSpans"][number]>,
): ThreadRunProjectionTimelineItem[] {
  const latestStreamDisplayByKey = new Map<string, ThreadRunProjectionTimelineItem>();
  for (const item of timeline) {
    const streamKey = projectionStreamDisplayKey(item);
    if (!streamKey) {
      continue;
    }
    const current = latestStreamDisplayByKey.get(streamKey);
    if (!current || compareTimelineItems(current, item) <= 0) {
      latestStreamDisplayByKey.set(streamKey, item);
    }
  }

  const displayItems: ThreadRunProjectionTimelineItem[] = [];
  for (const item of timeline) {
    const streamKey = projectionStreamDisplayKey(item);
    if (streamKey && latestStreamDisplayByKey.get(streamKey)?.id !== item.id) {
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
    return !timeline
      .slice(index + 1)
      .some((later) => isProjectionContextCompactionItem(later));
  });
}

function isProjectionContextCompactionItem(item: ThreadRunProjectionTimelineItem): boolean {
  return (
    item.eventType === "context.compaction.started" ||
    item.eventType === "context.compaction.completed" ||
    item.eventType === "context.compaction.failed"
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
  return (
    item.eventType === "request.completed" ||
    item.eventType === "request.cancelled"
  );
}

function projectionRequestKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (item.requestId) {
    return `request:${item.requestId}`;
  }
  if (item.streamKey) {
    return `stream:${item.streamKey}`;
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
  if (item.requestId) {
    return item.requestId;
  }
  if (item.streamKey) {
    return `stream:${item.streamKey}`;
  }
  if (isStreamingRequestDisplayItem(item)) {
    return `stream:${item.agentId ?? item.role ?? item.id}`;
  }
  return undefined;
}

function projectionStreamDisplayKey(item: ThreadRunProjectionTimelineItem): string | undefined {
  if (!isStreamingRequestDisplayItem(item)) {
    return undefined;
  }
  const channel =
    item.eventType === "thinking.delta" || item.eventType === "thinking.final"
      ? "thinking"
      : "message";
  return `${channel}:${projectionRequestKey(item) ?? projectionOwnerKey(item) ?? item.id}`;
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

export function formatProjectionAgentLabel(agent: Pick<ThreadRunProjectionAgent, "agentId" | "role">): string {
  return `${resolveSubagentRunDisplayTitle(agent.role)} #${shortProjectionAgentId(agent.agentId)}`;
}

export function shortProjectionAgentId(agentId: string): string {
  if (agentId.length <= 8) {
    return agentId;
  }
  return agentId.slice(-8);
}

export function projectionItemToDetailBlock(
  item: ThreadRunProjectionTimelineItem,
): ActivityDetailBlock | undefined {
  const text = item.text.trim();

  if (isProjectionTodoToolActionItem(item)) {
    return {
      kind: "action",
      icon: resolveProjectionActionIcon(text),
      label: resolveProjectionToolActionLabel(item),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "message.delta" || item.eventType === "message.final") {
    if (!text && item.eventType !== "message.delta") {
      return undefined;
    }
    return {
      kind: "narrative",
      text: item.text,
      streaming: item.eventType === "message.delta",
      ...(item.role && { subagent: item.role }),
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
      return {
        kind: "agent-request",
        ...(item.role && { subagent: item.role }),
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
    return {
      kind: "api-error",
      message: apiError?.message ?? text,
      ...(apiError?.statusCode !== undefined && { statusCode: apiError.statusCode }),
      ...(apiError?.code && { code: apiError.code }),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.failed") {
    return {
      kind: "tool-failed",
      tool: resolveProjectionToolName(item),
      ...(text && { error: text }),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  if (item.eventType === "tool.started" || item.eventType === "tool.completed") {
    return {
      kind: "action",
      icon: resolveProjectionActionIcon(text),
      label: resolveProjectionToolActionLabel(item),
      ...(item.role && { subagent: item.role }),
      ...(item.agentId && { agentId: item.agentId }),
    };
  }

  const phaseLabel = resolveProjectionPhaseLabel(item);
  if (phaseLabel) {
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
  return liveType === "thread.user_prompt" || (item.role === "user" && item.text.trim().length > 0);
}

export function resolveProjectionAgentStatusText(
  agent: ThreadRunProjectionAgent,
): string | undefined {
  const speech = findLatestAgentSpeechSummary(agent.timeline);
  if (speech) {
    return speech;
  }
  const latest = agent.latestActivity?.trim();
  if (!latest || isProjectionLifecycleText(latest) || latest === "状态已更新") {
    const action = findLatestAgentToolAction(agent.timeline);
    return action ? resolveProjectionToolActionLabel(action) : undefined;
  }
  return latest;
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
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 160) ?? "";
}

function projectionLiveType(item: ThreadRunProjectionTimelineItem): string | undefined {
  const liveType = item.metadata?.liveType;
  return typeof liveType === "string" ? liveType : undefined;
}

function isProjectionTodoStatusItem(item: ThreadRunProjectionTimelineItem): boolean {
  return projectionLiveType(item) === "todo.updated";
}

function isProjectionTodoToolActionItem(item: ThreadRunProjectionTimelineItem): boolean {
  return isProjectionTodoStatusItem(item) && /^Tool:/iu.test(item.text.trim());
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
  const text = item.text.trim();
  const failedMatch = /^Tool failed:\s*([^:]+)(?::\s*(.*))?$/iu.exec(text);
  if (failedMatch?.[1]?.trim()) {
    return failedMatch[1].trim();
  }
  const toolMatch = /^Tool:\s*([^:]+)(?::\s*(.*))?$/iu.exec(text);
  if (toolMatch?.[1]?.trim()) {
    return toolMatch[1].trim();
  }
  return text || "tool";
}

function resolveProjectionToolActionLabel(item: ThreadRunProjectionTimelineItem): string {
  const text = item.text.trim();
  if (!text) {
    return item.eventType === "tool.completed" ? "工具完成" : "工具调用";
  }
  return text.replace(/^Tool:\s*/iu, "").trim();
}

function resolveProjectionActionIcon(text: string): ActivityActionIcon {
  const lower = text.toLowerCase();
  if (/(search|grep|find|rg|ripgrep)/u.test(lower)) {
    return "search";
  }
  if (/(read|open|cat|list|ls|file)/u.test(lower)) {
    return "file";
  }
  if (/(edit|write|patch|apply)/u.test(lower)) {
    return "edit";
  }
  if (/(bash|shell|terminal|run|exec|command)/u.test(lower)) {
    return "terminal";
  }
  return "agent";
}
