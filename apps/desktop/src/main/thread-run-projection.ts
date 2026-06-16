import type {
  ThreadBillingSnapshot,
  ThreadContextSnapshot,
  ThreadRunEvent,
  ThreadRunProjectionAgent,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionContext,
  ThreadRunProjectionDiagnostic,
  ThreadRunProjectionRequestSpan,
  ThreadRunProjectionRequestStatus,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
  ThreadRunProjectionUsage,
  ThreadStatus,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";
import type { ThreadSubagentSessionTiming } from "../shared/ipc";
import { isMetricsOnlyThreadRunEvent } from "./thread-run-event-normalizer";
import type { AgentInstanceRecord, RunAttemptRecord } from "./usage-ledger";

const subagentRoleSet = new Set<string>(SUBAGENT_ROLES);

export interface BuildThreadRunProjectionInput {
  threadId: string;
  status: ThreadStatus | string;
  message?: string;
  attempts: readonly RunAttemptRecord[];
  agents: readonly AgentInstanceRecord[];
  events: readonly ThreadRunEvent[];
  billing?: ThreadBillingSnapshot;
  context?: ThreadContextSnapshot;
  subagentTimings?: readonly ThreadSubagentSessionTiming[];
  nowMs?: number;
}

interface MutableRequestSpan {
  requestId: string;
  ownerAgentId?: string;
  role?: string;
  source?: string;
  status: ThreadRunProjectionRequestStatus;
  startedAt: string;
  firstTokenAt?: string;
  endedAt?: string;
  error?: string;
  sawStreamStart: boolean;
}

export function buildThreadRunProjection(
  input: BuildThreadRunProjectionInput,
): ThreadRunProjectionSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const events = [...input.events].sort((left, right) => {
    const sequenceDiff = left.sequence - right.sequence;
    return sequenceDiff !== 0 ? sequenceDiff : left.observedAt.localeCompare(right.observedAt);
  });
  const attempts = input.attempts
    .map(mapAttempt)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.retryIndex - right.retryIndex);
  const currentAttemptId =
    attempts.find((attempt) => attempt.status === "running")?.attemptId ??
    attempts[attempts.length - 1]?.attemptId;

  const timeline = events.map((event) => eventToTimelineItem(event));
  const diagnostics: ThreadRunProjectionDiagnostic[] = [];
  const agentsById = new Map<string, ThreadRunProjectionAgent>();
  const eventsByAgentId = new Map<string, ThreadRunProjectionTimelineItem[]>();
  const agentsByRole = buildAgentsByRole(input.agents);

  for (const event of events) {
    if (isMetricsOnlyThreadRunEvent(event)) {
      continue;
    }
    const resolvedAgentId = resolveProjectionEventAgentId(event, agentsByRole, diagnostics);
    if ((event.scope === "agent" || event.scope === "both") && resolvedAgentId) {
      const item = eventToTimelineItem(event, resolvedAgentId);
      const rows = eventsByAgentId.get(resolvedAgentId) ?? [];
      rows.push(item);
      eventsByAgentId.set(resolvedAgentId, rows);
    }
  }

  const usageByAgentId = buildUsageByAgentId(input.billing);
  const contextByAgentId = buildContextByAgentId(input.context);
  const timingByAgentId = new Map((input.subagentTimings ?? []).map((timing) => [timing.agentId, timing]));

  for (const agent of input.agents) {
    const timelineItems = eventsByAgentId.get(agent.agentId) ?? [];
    const startedAt = agent.startedAt;
    const endedAt = agent.endedAt;
    const timing = timingByAgentId.get(agent.agentId);
    const usage = usageByAgentId.get(agent.agentId);
    const context = contextByAgentId.get(agent.agentId);
    const activity = latestActivity(timelineItems);
    const durationMs =
      timing?.durationMs ??
      computeDurationMs(startedAt, endedAt, nowMs, diagnostics, agent.agentId);
    agentsById.set(agent.agentId, {
      agentId: agent.agentId,
      role: agent.role,
      kind: agent.kind,
      status: agent.status,
      startedAt,
      durationMs,
      timeline: timelineItems,
      ...(agent.runAttemptId && { runAttemptId: agent.runAttemptId }),
      ...(agent.parentAgentId && { parentAgentId: agent.parentAgentId }),
      ...(agent.parentToolUseId && { parentToolUseId: agent.parentToolUseId }),
      ...(agent.missionKey && { mission: agent.missionKey }),
      ...(agent.todoId && { todoId: agent.todoId }),
      ...(endedAt && { endedAt }),
      ...(activity && { latestActivity: activity }),
      ...(usage && { usage }),
      ...(context && { context }),
    });
  }

  const requestSpans = buildRequestSpans(events, input.status, diagnostics, input.agents);
  const mainTimeline = timeline.filter((item) => item.scope === "main" || item.scope === "both");

  return {
    thread: {
      threadId: input.threadId,
      status: input.status,
      generatedAt: new Date(nowMs).toISOString(),
      ...(input.message && { message: input.message }),
      ...(currentAttemptId && { currentAttemptId }),
    },
    attempts,
    agents: [...agentsById.values()].sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    requestSpans,
    timeline: mainTimeline,
    diagnostics,
    sourceEventCount: events.length,
  };
}

function mapAttempt(attempt: RunAttemptRecord): ThreadRunProjectionAttempt {
  return {
    attemptId: attempt.attemptId,
    phase: attempt.phase,
    retryIndex: attempt.retryIndex,
    status: attempt.status,
    startedAt: attempt.startedAt,
    ...(attempt.endedAt && { endedAt: attempt.endedAt }),
  };
}

function eventToTimelineItem(
  event: ThreadRunEvent,
  resolvedAgentId?: string,
): ThreadRunProjectionTimelineItem {
  return {
    id: event.id,
    sequence: event.sequence,
    eventType: event.eventType,
    scope: event.scope,
    text: event.message,
    at: event.observedAt,
    ...(event.role && { role: event.role }),
    ...(resolvedAgentId || event.agentId ? { agentId: resolvedAgentId ?? event.agentId } : {}),
    ...(event.requestId && { requestId: event.requestId }),
    ...(event.streamKey && { streamKey: event.streamKey }),
    ...(event.metadata && { metadata: event.metadata }),
  };
}

function buildAgentsByRole(
  agents: readonly AgentInstanceRecord[],
): Map<string, AgentInstanceRecord[]> {
  const map = new Map<string, AgentInstanceRecord[]>();
  for (const agent of agents) {
    if (!subagentRoleSet.has(agent.role)) {
      continue;
    }
    const rows = map.get(agent.role) ?? [];
    rows.push(agent);
    map.set(agent.role, rows);
  }
  return map;
}

function resolveProjectionEventAgentId(
  event: ThreadRunEvent,
  agentsByRole: ReadonlyMap<string, readonly AgentInstanceRecord[]>,
  diagnostics: ThreadRunProjectionDiagnostic[],
): string | undefined {
  if (event.scope !== "agent" && event.scope !== "both") {
    return event.agentId;
  }
  if (event.agentId) {
    return event.agentId;
  }
  if (!event.role || !subagentRoleSet.has(event.role)) {
    return undefined;
  }

  const candidates = (agentsByRole.get(event.role) ?? []).filter((agent) =>
    agentInstanceContainsEvent(agent, event.observedAt),
  );
  if (candidates.length === 1) {
    return candidates[0]?.agentId;
  }

  diagnostics.push({
    code: candidates.length > 1 ? "ambiguous_subagent_role" : "missing_agent_id",
    message:
      candidates.length > 1
        ? `Agent-scoped event for role ${event.role} has multiple matching agents.`
        : `Agent-scoped event for role ${event.role} is missing agentId.`,
    eventId: event.id,
  });
  return undefined;
}

function agentInstanceContainsEvent(agent: AgentInstanceRecord, observedAt: string): boolean {
  const eventMs = Date.parse(observedAt);
  const startMs = Date.parse(agent.startedAt);
  const endMs = agent.endedAt ? Date.parse(agent.endedAt) : undefined;
  if (!Number.isFinite(eventMs) || !Number.isFinite(startMs)) {
    return agent.status === "active";
  }
  if (eventMs < startMs) {
    return false;
  }
  if (endMs !== undefined && Number.isFinite(endMs) && eventMs > endMs) {
    return false;
  }
  return true;
}

function buildUsageByAgentId(
  billing: ThreadBillingSnapshot | undefined,
): Map<string, ThreadRunProjectionUsage> {
  const map = new Map<string, ThreadRunProjectionUsage>();
  for (const row of billing?.subagents ?? []) {
    map.set(row.agentId, {
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      ecoCostUsd: row.ecoCostUsd,
      ...(row.modelId && { modelId: row.modelId }),
    });
  }
  return map;
}

function buildContextByAgentId(
  context: ThreadContextSnapshot | undefined,
): Map<string, ThreadRunProjectionContext> {
  const map = new Map<string, ThreadRunProjectionContext>();
  for (const row of context?.instances ?? []) {
    map.set(row.agentId, {
      occupied: row.occupied,
      limit: row.limit,
      occupancyPct: row.occupancyPct,
      ...(row.modelId && { modelId: row.modelId }),
    });
  }
  return map;
}

function computeDurationMs(
  startedAt: string,
  endedAt: string | undefined,
  nowMs: number,
  diagnostics: ThreadRunProjectionDiagnostic[],
  agentId: string,
): number {
  const startMs = Date.parse(startedAt);
  const endMs = endedAt ? Date.parse(endedAt) : nowMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return 0;
  }
  const durationMs = endMs - startMs;
  if (durationMs < 0) {
    diagnostics.push({
      code: "negative_duration",
      message: `Agent ${agentId} has negative duration.`,
      agentId,
    });
    return 0;
  }
  return durationMs;
}

function latestActivity(items: readonly ThreadRunProjectionTimelineItem[]): string | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const text = items[index]?.text.trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function buildRequestSpans(
  events: readonly ThreadRunEvent[],
  threadStatus: string,
  diagnostics: ThreadRunProjectionDiagnostic[],
  agents: readonly AgentInstanceRecord[] = [],
): ThreadRunProjectionRequestSpan[] {
  const spans = new Map<string, MutableRequestSpan>();
  const seenStreamingKeys = new Set<string>();

  for (const event of events) {
    const requestId = resolveProjectionRequestId(event);
    if (!requestId) {
      continue;
    }
    const span = spans.get(requestId) ?? createRequestSpan(event, requestId);
    spans.set(requestId, span);
    applyEventToRequestSpan(span, event, diagnostics, seenStreamingKeys);
  }

  closeRequestSpansForTerminalAgents(spans, agents);

  const terminalThread = ["completed", "failed", "blocked", "idle", "awaiting_plan"].includes(threadStatus);
  const terminalAt = events[events.length - 1]?.observedAt;
  const output: ThreadRunProjectionRequestSpan[] = [];
  for (const span of spans.values()) {
    if (terminalThread && (span.status === "waiting_first_token" || span.status === "streaming")) {
      diagnostics.push({
        code: "request_span_left_open",
        message: `Request span ${span.requestId} is still open after terminal thread status ${threadStatus}.`,
        requestId: span.requestId,
      });
      closeRequestSpanForTerminalThread(span, threadStatus, terminalAt);
    }
    output.push({
      requestId: span.requestId,
      status: span.status,
      startedAt: span.startedAt,
      ...(span.ownerAgentId && { ownerAgentId: span.ownerAgentId }),
      ...(span.role && { role: span.role }),
      ...(span.source && { source: span.source }),
      ...(span.firstTokenAt && { firstTokenAt: span.firstTokenAt }),
      ...(span.endedAt && { endedAt: span.endedAt }),
      ...(span.error && { error: span.error }),
    });
  }
  return output.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function closeRequestSpansForTerminalAgents(
  spans: ReadonlyMap<string, MutableRequestSpan>,
  agents: readonly AgentInstanceRecord[],
): void {
  for (const agent of agents) {
    if (agent.status === "active" || agent.status === "launching") {
      continue;
    }
    for (const span of spans.values()) {
      if (span.ownerAgentId !== agent.agentId || !isOpenRequestSpan(span)) {
        continue;
      }
      if (agent.status === "abandoned") {
        span.status = "cancelled";
      } else {
        span.status = "completed";
      }
      span.endedAt = span.endedAt ?? agent.endedAt ?? agent.updatedAt;
    }
  }
}

function isOpenRequestSpan(span: MutableRequestSpan): boolean {
  return span.status === "waiting_first_token" || span.status === "streaming";
}

function closeRequestSpanForTerminalThread(
  span: MutableRequestSpan,
  threadStatus: string,
  terminalAt: string | undefined,
): void {
  if (threadStatus === "failed" || threadStatus === "blocked") {
    span.status = "failed";
    span.error = span.error ?? `Thread ended with status ${threadStatus}.`;
  } else if (threadStatus === "cancelled") {
    span.status = "cancelled";
  } else {
    span.status = "completed";
  }
  span.endedAt = span.endedAt ?? terminalAt ?? span.startedAt;
}

function resolveProjectionRequestId(event: ThreadRunEvent): string | undefined {
  if (event.requestId) {
    return event.requestId;
  }
  if (event.streamState !== "none") {
    return `stream:${event.streamKey ?? event.agentId ?? event.role ?? event.id}`;
  }
  return undefined;
}

function createRequestSpan(event: ThreadRunEvent, requestId: string): MutableRequestSpan {
  return {
    requestId,
    ...(event.agentId && { ownerAgentId: event.agentId }),
    ...(event.role && { role: event.role }),
    ...(typeof event.metadata?.source === "string" && { source: event.metadata.source }),
    status: "waiting_first_token",
    startedAt: event.observedAt,
    sawStreamStart: false,
  };
}

function applyEventToRequestSpan(
  span: MutableRequestSpan,
  event: ThreadRunEvent,
  diagnostics: ThreadRunProjectionDiagnostic[],
  seenStreamingKeys: Set<string>,
): void {
  if (!span.ownerAgentId && event.agentId) {
    span.ownerAgentId = event.agentId;
  }
  if (!span.role && event.role) {
    span.role = event.role;
  }

  if (event.eventType === "request.started") {
    span.status = "waiting_first_token";
    span.sawStreamStart = true;
  }
  if (event.streamState === "placeholder") {
    span.status = "waiting_first_token";
    span.sawStreamStart = true;
    seenStreamingKeys.add(span.requestId);
  }
  if (event.streamState === "streaming") {
    span.status = "streaming";
    if (!span.firstTokenAt) {
      span.firstTokenAt = event.observedAt;
    }
    span.sawStreamStart = true;
    seenStreamingKeys.add(span.requestId);
  }
  if (event.streamState === "finalized") {
    if (!span.sawStreamStart && !seenStreamingKeys.has(span.requestId)) {
      diagnostics.push({
        code: "orphan_stream_finalize",
        message: `Stream finalized without a prior stream start for ${span.requestId}.`,
        eventId: event.id,
        requestId: span.requestId,
      });
    }
    span.status = "completed";
    span.endedAt = event.observedAt;
  }
  if (event.eventType === "request.completed") {
    span.status = "completed";
    span.endedAt = event.observedAt;
  }
  if (event.eventType === "request.cancelled") {
    span.status = "cancelled";
    span.endedAt = event.observedAt;
  }
  if (event.eventType === "request.failed" || event.eventType === "api.error") {
    span.status = "failed";
    span.endedAt = event.observedAt;
    span.error = resolveErrorMessage(event);
  }
}

function resolveErrorMessage(event: ThreadRunEvent): string {
  const apiError = event.metadata?.apiError;
  if (apiError && typeof apiError === "object" && "message" in apiError) {
    const message = (apiError as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }
  return event.message;
}
