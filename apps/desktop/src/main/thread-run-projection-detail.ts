import type {
  ThreadRunProjectionDetailKind,
  ThreadRunProjectionDetailRequest,
  ThreadRunProjectionDetailResult,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";

const DEFAULT_DETAIL_LIMIT = 200;
const MAX_DETAIL_LIMIT = 500;

export function parseThreadRunProjectionDetailRequest(
  payload: unknown,
): ThreadRunProjectionDetailRequest | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  const threadId = readNonEmptyString(payload.threadId);
  const kind = readDetailKind(payload.kind);
  const key = readNonEmptyString(payload.key);
  if (!threadId || !kind || !key) {
    return undefined;
  }
  const afterSequence = readOptionalNumber(payload.afterSequence);
  const limit = readOptionalNumber(payload.limit);
  return {
    threadId,
    kind,
    key,
    ...(afterSequence !== undefined ? { afterSequence } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function buildThreadRunProjectionDetail(
  projection: ThreadRunProjectionSnapshot,
  request: ThreadRunProjectionDetailRequest,
): ThreadRunProjectionDetailResult | undefined {
  const sourceTimeline =
    request.kind === "agent"
      ? timelineForAgent(projection, request.key)
      : timelineForTool(projection, request.key);
  if (!sourceTimeline) {
    return undefined;
  }

  const afterSequence = request.afterSequence ?? -Infinity;
  const limit = clampLimit(request.limit);
  const filtered = sourceTimeline
    .filter((item) => item.sequence > afterSequence)
    .sort(compareTimelineItems);
  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > page.length;
  const nextAfterSequence = page.at(-1)?.sequence;
  const agent =
    request.kind === "agent"
      ? projection.agents.find((candidate) => candidate.agentId === request.key)
      : undefined;

  return {
    threadId: projection.thread.threadId,
    kind: request.kind,
    key: request.key,
    generatedAt: projection.thread.generatedAt,
    timeline: page,
    sourceEventCount: projection.sourceEventCount,
    hasMore,
    ...(nextAfterSequence !== undefined ? { nextAfterSequence } : {}),
    ...(agent ? { agent: { ...agent, timeline: [] } } : {}),
  };
}

function timelineForAgent(
  projection: ThreadRunProjectionSnapshot,
  agentId: string,
): ThreadRunProjectionTimelineItem[] | undefined {
  const agent = projection.agents.find((candidate) => candidate.agentId === agentId);
  return agent ? [...agent.timeline] : undefined;
}

function timelineForTool(
  projection: ThreadRunProjectionSnapshot,
  toolUseId: string,
): ThreadRunProjectionTimelineItem[] | undefined {
  const timeline = allTimelineItems(projection).filter(
    (item) => readTimelineToolUseId(item) === toolUseId,
  );
  return timeline.length > 0 ? timeline : undefined;
}

function allTimelineItems(
  projection: ThreadRunProjectionSnapshot,
): ThreadRunProjectionTimelineItem[] {
  return [
    ...projection.timeline,
    ...projection.agents.flatMap((agent) => agent.timeline),
  ];
}

function readTimelineToolUseId(item: ThreadRunProjectionTimelineItem): string | undefined {
  const tool = isRecord(item.metadata?.tool) ? item.metadata.tool : undefined;
  const toolUseId = readNonEmptyString(tool?.toolUseId);
  if (toolUseId) {
    return toolUseId;
  }
  const bashApproval = isRecord(item.metadata?.bashApproval)
    ? item.metadata.bashApproval
    : undefined;
  return readNonEmptyString(bashApproval?.toolUseId);
}

function compareTimelineItems(
  left: ThreadRunProjectionTimelineItem,
  right: ThreadRunProjectionTimelineItem,
): number {
  const sequenceDelta = left.sequence - right.sequence;
  if (sequenceDelta !== 0) {
    return sequenceDelta;
  }
  const atDelta = left.at.localeCompare(right.at);
  if (atDelta !== 0) {
    return atDelta;
  }
  return left.id.localeCompare(right.id);
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DETAIL_LIMIT;
  }
  return Math.min(MAX_DETAIL_LIMIT, Math.max(1, Math.floor(value)));
}

function readDetailKind(value: unknown): ThreadRunProjectionDetailKind | undefined {
  return value === "agent" || value === "tool" ? value : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
