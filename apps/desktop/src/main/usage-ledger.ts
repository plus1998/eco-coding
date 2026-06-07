import type { RuntimeAgentRole } from "../shared/ipc";

export type RunAttemptPhase = "planning" | "execution" | "question" | "continuation";
export type RunAttemptStatus = "running" | "completed" | "failed" | "cancelled";
export type AgentInstanceKind = "planner" | "subagent";
export type AgentInstanceStatus = "launching" | "active" | "stopped" | "abandoned";
export type UsageLedgerSource = "sdk" | "proxy" | "otel";
export type UsageLedgerKind = "request_final" | "request_partial" | "assistant_fallback" | "context";
export type UsageAttributionStatus = "attributed" | "unattributed";

export interface RunAttemptRecord {
  threadId: string;
  attemptId: string;
  phase: RunAttemptPhase;
  retryIndex: number;
  status: RunAttemptStatus;
  startedAt: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentInstanceRecord {
  threadId: string;
  agentId: string;
  role: RuntimeAgentRole;
  kind: AgentInstanceKind;
  status: AgentInstanceStatus;
  runAttemptId?: string;
  parentAgentId?: string;
  parentToolUseId?: string;
  missionKey?: string;
  todoId?: string;
  startedAt: string;
  endedAt?: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface UsageAttribution {
  status: UsageAttributionStatus;
  agentId?: string;
  reason?: string;
}

export interface UsageLedgerEvent {
  id: string;
  idempotencyKey: string;
  threadId: string;
  source: UsageLedgerSource;
  sourceEventId: string;
  usageKind: UsageLedgerKind;
  role: RuntimeAgentRole;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  observedAt: string;
  attribution: UsageAttribution;
  runAttemptId?: string;
  agentId?: string;
  parentToolUseId?: string;
  requestKey?: string;
  providerRequestId?: string;
  sdkMessageId?: string;
  modelId?: string;
  reportedCostUsd?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageLedgerAppendResult {
  event: UsageLedgerEvent;
  inserted: boolean;
}

export interface UsageLedgerTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reportedCostUsd: number;
}

export interface UsageLedgerProjection {
  total: UsageLedgerTotals;
  byRole: Record<string, UsageLedgerTotals>;
  byAgent: Record<string, UsageLedgerTotals>;
  byModel: Record<string, UsageLedgerTotals>;
  unattributedEvents: UsageLedgerEvent[];
}

export interface UsageLedgerEventKeyInput {
  threadId: string;
  source: UsageLedgerSource;
  sourceEventId: string;
  usageKind: UsageLedgerKind;
  modelId?: string;
  agentId?: string;
}

const FIELD_SEPARATOR = "\u001f";

export function buildUsageLedgerEventKey(input: UsageLedgerEventKeyInput): string {
  return [
    input.threadId,
    input.source,
    input.sourceEventId,
    input.usageKind,
    input.modelId?.trim() || "unknown-model",
  ].join(FIELD_SEPARATOR);
}

export function createEmptyUsageLedgerTotals(): UsageLedgerTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reportedCostUsd: 0,
  };
}

export function tokenTotalOf(event: UsageLedgerEvent): number {
  return event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens;
}

export function projectUsageLedger(events: readonly UsageLedgerEvent[]): UsageLedgerProjection {
  const projection: UsageLedgerProjection = {
    total: createEmptyUsageLedgerTotals(),
    byRole: {},
    byAgent: {},
    byModel: {},
    unattributedEvents: [],
  };

  for (const event of events) {
    addEventToTotals(projection.total, event);
    addEventToTotals((projection.byRole[event.role] ??= createEmptyUsageLedgerTotals()), event);
    if (event.agentId) {
      addEventToTotals((projection.byAgent[event.agentId] ??= createEmptyUsageLedgerTotals()), event);
    }
    if (event.modelId) {
      addEventToTotals((projection.byModel[event.modelId] ??= createEmptyUsageLedgerTotals()), event);
    }
    if (event.attribution.status === "unattributed") {
      projection.unattributedEvents.push(event);
    }
  }

  return projection;
}

export class InMemoryUsageLedger {
  private readonly runAttempts = new Map<string, RunAttemptRecord>();
  private readonly agentInstances = new Map<string, AgentInstanceRecord>();
  private readonly eventsByIdempotencyKey = new Map<string, UsageLedgerEvent>();

  upsertRunAttempt(record: RunAttemptRecord): RunAttemptRecord {
    this.runAttempts.set(runAttemptKey(record.threadId, record.attemptId), record);
    return record;
  }

  upsertAgentInstance(record: AgentInstanceRecord): AgentInstanceRecord {
    this.agentInstances.set(agentInstanceKey(record.threadId, record.agentId), record);
    return record;
  }

  appendUsageEvent(event: UsageLedgerEvent): UsageLedgerAppendResult {
    const existing = this.eventsByIdempotencyKey.get(event.idempotencyKey);
    if (existing) {
      return { event: existing, inserted: false };
    }
    this.eventsByIdempotencyKey.set(event.idempotencyKey, event);
    return { event, inserted: true };
  }

  listUsageEvents(threadId: string): UsageLedgerEvent[] {
    return [...this.eventsByIdempotencyKey.values()]
      .filter((event) => event.threadId === threadId)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  }

  listRunAttempts(threadId: string): RunAttemptRecord[] {
    return [...this.runAttempts.values()]
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }

  listAgentInstances(threadId: string): AgentInstanceRecord[] {
    return [...this.agentInstances.values()]
      .filter((record) => record.threadId === threadId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  }
}

function addEventToTotals(total: UsageLedgerTotals, event: UsageLedgerEvent): void {
  total.inputTokens += event.inputTokens;
  total.outputTokens += event.outputTokens;
  total.cacheReadTokens += event.cacheReadTokens;
  total.cacheCreationTokens += event.cacheCreationTokens;
  total.reportedCostUsd += event.reportedCostUsd ?? 0;
}

function runAttemptKey(threadId: string, attemptId: string): string {
  return `${threadId}${FIELD_SEPARATOR}${attemptId}`;
}

function agentInstanceKey(threadId: string, agentId: string): string {
  return `${threadId}${FIELD_SEPARATOR}${agentId}`;
}
