import {
  computeRequestBilling,
  computeThreadBillingTotals,
  emptyCostBreakdown,
  type ModelCostRates,
  mergeCostBreakdowns,
  mergeUsageTotals,
  type ParsedUsage,
  type RequestBillingDelta,
  type TokenCostBreakdown,
  tokenTotalsFromUsage,
} from "@eco/runtime";
import type {
  BillingUsageSource,
  RuntimeAgentRole,
  ThreadBillingModelSnapshot,
  ThreadBillingSnapshot,
  ThreadBillingSourceSnapshot,
  ThreadSubagentBillingSnapshot,
} from "../shared/ipc";
import { isSubagentBillingRole } from "./billing-orchestration";
import { resolveLedgerSourcePriority } from "./billing-source-priority";
import { ledgerEventDuplicateKey } from "../shared/ledger-events-display";
import { readRouteRole } from "./proxy-usage-pending-settlement";
import type {
  AgentInstanceKind,
  AgentInstanceRecord,
  AgentInstanceStatus,
  UsageLedgerEvent,
  UsageLedgerSource,
} from "./usage-ledger";
import { readUsageLedgerComputedBilling } from "./usage-ledger-cost-metadata";
import { createEmptyUsage } from "./usage-request-types";

export interface BillingProjectorRateResolution {
  actualRates: ModelCostRates | null;
  plannerRates: ModelCostRates | null;
}

export interface ProjectBillingFromUsageLedgerInput {
  events: readonly UsageLedgerEvent[];
  agents?: readonly AgentInstanceRecord[];
  plannerModelLabel?: string;
  resolveRates?: (event: UsageLedgerEvent) => BillingProjectorRateResolution | undefined;
  primarySourcePriority?: readonly UsageLedgerSource[];
  /** Preserve known window occupancy; never invent 0 when prior metrics exist. */
  existingSubagentContextByAgentId?: ReadonlyMap<string, number>;
}

export interface BillingProjectorAgentSnapshot {
  agentId: string;
  role: RuntimeAgentRole;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  reportedCostUsd: number;
  pricingResolved: boolean;
  sources: UsageLedgerSource[];
  modelIds: string[];
  kind?: AgentInstanceKind;
  status?: AgentInstanceStatus;
  runAttemptId?: string;
  parentAgentId?: string;
  parentToolUseId?: string;
  missionKey?: string;
  todoId?: string;
  ecoCostBreakdown?: TokenCostBreakdown;
}

export interface BillingProjectorRunAttemptSnapshot {
  runAttemptId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  reportedCostUsd: number;
  pricingResolved: boolean;
}

export interface UsageLedgerBillingProjection {
  snapshot?: ThreadBillingSnapshot;
  byAgent: Record<string, BillingProjectorAgentSnapshot>;
  byRunAttempt: Record<string, BillingProjectorRunAttemptSnapshot>;
  unattributedEvents: UsageLedgerEvent[];
  pendingEvents: UsageLedgerEvent[];
  unsettledPartialEvents: UsageLedgerEvent[];
  contextEvents: UsageLedgerEvent[];
  unresolvedEventCount: number;
  eventCount: number;
}

interface MutableSourceState {
  source: UsageLedgerSource;
  total: ParsedUsage;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  plannerCostBreakdown: TokenCostBreakdown;
  roleEcoCostUsd: Partial<Record<RuntimeAgentRole, number>>;
  roleModelIds: Partial<Record<RuntimeAgentRole, string>>;
  byRole: Partial<Record<RuntimeAgentRole, ParsedUsage>>;
  byModel: Record<string, MutableModelState>;
  reportedCostUsd: number;
  pricingResolved: boolean;
  unresolvedCount: number;
  eventCount: number;
}

interface MutableModelState {
  modelId: string;
  roles: RuntimeAgentRole[];
  usage: ParsedUsage;
  ecoCostUsd: number;
  reportedCostUsd: number;
}

interface MutableAgentState {
  agentId: string;
  role: RuntimeAgentRole;
  usage: ParsedUsage;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  reportedCostUsd: number;
  pricingResolved: boolean;
  sources: Set<UsageLedgerSource>;
  modelIds: Set<string>;
  ecoCostBreakdown: TokenCostBreakdown;
}

interface MutableRunAttemptState {
  runAttemptId: string;
  usage: ParsedUsage;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  reportedCostUsd: number;
  pricingResolved: boolean;
}

export function projectBillingFromUsageLedger(
  input: ProjectBillingFromUsageLedgerInput,
): UsageLedgerBillingProjection {
  const sources: Partial<Record<UsageLedgerSource, MutableSourceState>> = {};
  const byAgent = new Map<string, MutableAgentState>();
  const byRunAttempt = new Map<string, MutableRunAttemptState>();
  const unattributedEvents: UsageLedgerEvent[] = [];
  const pendingEvents: UsageLedgerEvent[] = [];
  const unsettledPartialEvents: UsageLedgerEvent[] = [];
  const contextEvents: UsageLedgerEvent[] = [];
  let unresolvedEventCount = 0;

  const proxyBillableIndex = indexProxyBillableEvents(input.events);
  // A billable row observed twice for the same invocation is counted once; see loop.
  const seenBillableRequestKeys = new Set<string>();

  for (const event of input.events) {
    if (event.usageKind === "request_partial") {
      unsettledPartialEvents.push(event);
      continue;
    }
    if (event.usageKind === "context") {
      contextEvents.push(event);
      continue;
    }
    if (shouldSkipDuplicateBillableEvent(event, proxyBillableIndex)) {
      continue;
    }
    // A billable row observed twice for the same invocation (same source + usage kind +
    // usage fingerprint — e.g. legacy PI double usage emission) is counted once; the
    // first observation wins. Distinct models from one SDK result keep separate rows.
    const duplicateKey = ledgerEventDuplicateKey(event);
    if (seenBillableRequestKeys.has(duplicateKey)) {
      continue;
    }
    seenBillableRequestKeys.add(duplicateKey);
    const usage = usageFromEvent(event);
    const billing = resolveEventBilling(event, input.resolveRates);
    if (!billing.pricingResolved) {
      unresolvedEventCount += 1;
    }
    addEventToSource(getOrCreateSource(sources, event.source), event, usage, billing);
    if (event.agentId) {
      addEventToAgent(getOrCreateAgent(byAgent, event), event, usage, billing);
    }
    if (event.runAttemptId) {
      addEventToRunAttempt(getOrCreateRunAttempt(byRunAttempt, event.runAttemptId), usage, billing);
    }
    if (event.attribution.status === "pending") {
      pendingEvents.push(event);
    } else if (event.attribution.status === "unattributed") {
      unattributedEvents.push(event);
    }
  }

  applySourceReportedCosts(sources, input.events);
  applyAgentReportedCosts(byAgent, input.events);
  applyRunAttemptReportedCosts(byRunAttempt, input.events);

  const sourceBreakdown = buildSourceBreakdown(sources);
  const priority = input.primarySourcePriority ?? resolveLedgerSourcePriority(sourceBreakdown);
  const nonVisionSources = new Set(
    input.events
      .filter(
        (event) =>
          event.role !== "vision" && event.usageKind !== "request_partial" && event.usageKind !== "context",
      )
      .map((event) => event.source),
  );
  const primarySource =
    priority.find((source) => sourceBreakdown[source] && nonVisionSources.has(source)) ??
    priority.find((source) => sourceBreakdown[source]);
  const agentRecords = new Map((input.agents ?? []).map((agent) => [agent.agentId, agent]));
  const agentSnapshots = finalizeAgents(byAgent, agentRecords);
  const runAttemptSnapshots = finalizeRunAttempts(byRunAttempt);
  const snapshot = primarySource
    ? buildThreadBillingSnapshot({
        primarySource,
        sourceBreakdown,
        sources,
        subagents: buildThreadSubagentSnapshots(agentSnapshots, input.existingSubagentContextByAgentId),
        ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
      })
    : undefined;

  return {
    ...(snapshot && { snapshot }),
    byAgent: agentSnapshots,
    byRunAttempt: runAttemptSnapshots,
    unattributedEvents,
    pendingEvents,
    unsettledPartialEvents,
    contextEvents,
    unresolvedEventCount,
    eventCount: input.events.length,
  };
}

export function summarizeUsageLedgerBillingProjection(
  projection: UsageLedgerBillingProjection,
): Record<string, unknown> {
  return {
    eventCount: projection.eventCount,
    unresolvedEventCount: projection.unresolvedEventCount,
    unattributedEventCount: projection.unattributedEvents.length,
    unsettledPartialEventCount: projection.unsettledPartialEvents.length,
    contextEventCount: projection.contextEvents.length,
    byAgentCount: Object.keys(projection.byAgent).length,
    byRunAttemptCount: Object.keys(projection.byRunAttempt).length,
    primarySource: projection.snapshot?.primarySource,
    totalTokens: projection.snapshot?.totalTokens,
    ecoCostUsd: projection.snapshot?.ecoCostUsd,
    plannerTokenCostUsd: projection.snapshot?.plannerTokenCostUsd,
    subagentCount: projection.snapshot?.subagents?.length ?? 0,
  };
}

function buildThreadBillingSnapshot(input: {
  primarySource: UsageLedgerSource;
  sourceBreakdown: Partial<Record<UsageLedgerSource, ThreadBillingSourceSnapshot>>;
  sources: Partial<Record<UsageLedgerSource, MutableSourceState>>;
  plannerModelLabel?: string;
  subagents: ThreadSubagentBillingSnapshot[];
}): ThreadBillingSnapshot {
  const primary = input.sourceBreakdown[input.primarySource];
  const primaryState = input.sources[input.primarySource];
  if (!primary || !primaryState) {
    return {
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      ...computeThreadBillingTotals(0, 0, 0),
      pricingResolved: false,
    };
  }
  const sdkReported = input.sourceBreakdown.sdk?.reportedCostUsd ?? 0;
  return {
    totalTokens: primary.totalTokens,
    ...computeThreadBillingTotals(sdkReported, primary.plannerTokenCostUsd, primary.ecoCostUsd),
    ecoCostBreakdown: primaryState.ecoCostBreakdown,
    plannerCostBreakdown: primaryState.plannerCostBreakdown,
    pricingResolved: primary.pricingResolved,
    primarySource: input.primarySource as BillingUsageSource,
    sourceBreakdown: input.sourceBreakdown as Partial<
      Record<BillingUsageSource, ThreadBillingSourceSnapshot>
    >,
    ...(input.plannerModelLabel && { plannerModelLabel: input.plannerModelLabel }),
    ...(primary.byModel && { byModel: primary.byModel }),
    ...(primary.byRole && { byRole: primary.byRole }),
    ...(input.subagents.length > 0 && { subagents: input.subagents }),
  };
}

function addEventToSource(
  state: MutableSourceState,
  event: UsageLedgerEvent,
  usage: ParsedUsage,
  billing: RequestBillingDelta,
): void {
  state.total = mergeUsageTotals(state.total, usage);
  state.plannerTokenCostUsd += billing.plannerTokenCostUsd;
  state.ecoCostUsd += billing.ecoCostUsd;
  state.roleEcoCostUsd[event.role] = (state.roleEcoCostUsd[event.role] ?? 0) + billing.ecoCostUsd;
  state.byRole[event.role] = mergeUsageTotals(state.byRole[event.role] ?? createEmptyUsage(), usage);
  if (event.modelId && event.agentId) {
    state.roleModelIds[event.role] = event.modelId;
  }
  if (billing.ecoBreakdown) {
    state.ecoCostBreakdown = mergeCostBreakdowns(state.ecoCostBreakdown, billing.ecoBreakdown);
  }
  if (billing.plannerBreakdown) {
    state.plannerCostBreakdown = mergeCostBreakdowns(state.plannerCostBreakdown, billing.plannerBreakdown);
  }
  const model = getOrCreateModel(state, event.modelId?.trim() || event.role);
  addRole(model.roles, readRouteRole(event));
  model.usage = mergeUsageTotals(model.usage, usage);
  model.ecoCostUsd += billing.ecoCostUsd;
  if (event.reportedCostUsd !== undefined && Number.isFinite(event.reportedCostUsd)) {
    model.reportedCostUsd += event.reportedCostUsd;
  }
  if (!billing.pricingResolved) {
    state.pricingResolved = false;
    state.unresolvedCount += 1;
  }
  state.eventCount += 1;
}

function addEventToAgent(
  state: MutableAgentState,
  event: UsageLedgerEvent,
  usage: ParsedUsage,
  billing: RequestBillingDelta,
): void {
  state.usage = mergeUsageTotals(state.usage, usage);
  state.plannerTokenCostUsd += billing.plannerTokenCostUsd;
  state.ecoCostUsd += billing.ecoCostUsd;
  state.sources.add(event.source);
  if (event.modelId) {
    state.modelIds.add(event.modelId);
  }
  if (billing.ecoBreakdown) {
    state.ecoCostBreakdown = mergeCostBreakdowns(state.ecoCostBreakdown, billing.ecoBreakdown);
  }
  if (!billing.pricingResolved) {
    state.pricingResolved = false;
  }
}

function addEventToRunAttempt(
  state: MutableRunAttemptState,
  usage: ParsedUsage,
  billing: RequestBillingDelta,
): void {
  state.usage = mergeUsageTotals(state.usage, usage);
  state.plannerTokenCostUsd += billing.plannerTokenCostUsd;
  state.ecoCostUsd += billing.ecoCostUsd;
  if (!billing.pricingResolved) {
    state.pricingResolved = false;
  }
}

function buildSourceBreakdown(
  sources: Partial<Record<UsageLedgerSource, MutableSourceState>>,
): Partial<Record<UsageLedgerSource, ThreadBillingSourceSnapshot>> {
  const snapshots: Partial<Record<UsageLedgerSource, ThreadBillingSourceSnapshot>> = {};
  const ledgerPriority = resolveLedgerSourcePriority(sources);
  for (const source of ledgerPriority) {
    const state = sources[source];
    if (!state || !hasSourceData(state)) {
      continue;
    }
    const byModel = buildModelSnapshot(state.byModel);
    const byRole = buildRoleSnapshot(state.byRole, state.roleEcoCostUsd, state.roleModelIds);
    snapshots[source] = {
      source: source as BillingUsageSource,
      totalTokens: tokenTotalsFromUsage(state.total),
      plannerTokenCostUsd: state.plannerTokenCostUsd,
      ecoCostUsd: state.ecoCostUsd,
      ...(state.reportedCostUsd > 0 && { reportedCostUsd: state.reportedCostUsd }),
      pricingResolved: state.pricingResolved && state.unresolvedCount === 0,
      ...(byModel.length > 0 && { byModel }),
      ...(Object.keys(byRole).length > 0 && { byRole }),
    };
  }
  return snapshots;
}

function buildRoleSnapshot(
  byRoleState: Partial<Record<RuntimeAgentRole, ParsedUsage>>,
  roleEcoCostUsd: Partial<Record<RuntimeAgentRole, number>>,
  roleModelIds: Partial<Record<RuntimeAgentRole, string>>,
): NonNullable<ThreadBillingSnapshot["byRole"]> {
  const byRole: NonNullable<ThreadBillingSnapshot["byRole"]> = {};
  for (const [role, usage] of Object.entries(byRoleState) as [RuntimeAgentRole, ParsedUsage][]) {
    byRole[role] = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      ecoCostUsd: roleEcoCostUsd[role] ?? 0,
      ...(roleModelIds[role] && { modelId: roleModelIds[role] }),
    };
  }
  return byRole;
}

function buildModelSnapshot(byModel: Record<string, MutableModelState>): ThreadBillingModelSnapshot[] {
  return Object.values(byModel)
    .filter((entry) => usageTotal(entry.usage) > 0 || entry.ecoCostUsd > 0 || entry.reportedCostUsd > 0)
    .map((entry) => ({
      modelId: entry.modelId,
      roles: entry.roles,
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      cacheReadTokens: entry.usage.cacheReadTokens,
      cacheCreationTokens: entry.usage.cacheCreationTokens,
      ecoCostUsd: entry.ecoCostUsd,
      ...(entry.reportedCostUsd > 0 && { reportedCostUsd: entry.reportedCostUsd }),
    }))
    .sort((left, right) => {
      const tokenDiff = modelSnapshotTotal(right) - modelSnapshotTotal(left);
      return tokenDiff !== 0 ? tokenDiff : left.modelId.localeCompare(right.modelId);
    });
}

function finalizeAgents(
  agents: Map<string, MutableAgentState>,
  records: Map<string, AgentInstanceRecord>,
): Record<string, BillingProjectorAgentSnapshot> {
  const result: Record<string, BillingProjectorAgentSnapshot> = {};
  for (const state of agents.values()) {
    const record = records.get(state.agentId);
    result[state.agentId] = {
      agentId: state.agentId,
      role: record?.role ?? state.role,
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      cacheReadTokens: state.usage.cacheReadTokens,
      cacheCreationTokens: state.usage.cacheCreationTokens,
      plannerTokenCostUsd: state.plannerTokenCostUsd,
      ecoCostUsd: state.ecoCostUsd,
      reportedCostUsd: state.reportedCostUsd,
      pricingResolved: state.pricingResolved,
      sources: [...state.sources].sort(),
      modelIds: [...state.modelIds].sort(),
      ...(record?.kind && { kind: record.kind }),
      ...(record?.status && { status: record.status }),
      ...(record?.runAttemptId && { runAttemptId: record.runAttemptId }),
      ...(record?.parentAgentId && { parentAgentId: record.parentAgentId }),
      ...(record?.parentToolUseId && { parentToolUseId: record.parentToolUseId }),
      ...(record?.missionKey && { missionKey: record.missionKey }),
      ...(record?.todoId && { todoId: record.todoId }),
      ecoCostBreakdown: state.ecoCostBreakdown,
    };
  }
  return result;
}

function finalizeRunAttempts(
  runAttempts: Map<string, MutableRunAttemptState>,
): Record<string, BillingProjectorRunAttemptSnapshot> {
  const result: Record<string, BillingProjectorRunAttemptSnapshot> = {};
  for (const state of runAttempts.values()) {
    result[state.runAttemptId] = {
      runAttemptId: state.runAttemptId,
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      cacheReadTokens: state.usage.cacheReadTokens,
      cacheCreationTokens: state.usage.cacheCreationTokens,
      plannerTokenCostUsd: state.plannerTokenCostUsd,
      ecoCostUsd: state.ecoCostUsd,
      reportedCostUsd: state.reportedCostUsd,
      pricingResolved: state.pricingResolved,
    };
  }
  return result;
}

function buildThreadSubagentSnapshots(
  agents: Record<string, BillingProjectorAgentSnapshot>,
  existingSubagentContextByAgentId?: ReadonlyMap<string, number>,
): ThreadSubagentBillingSnapshot[] {
  return Object.values(agents)
    .filter((agent) => agent.kind === "subagent" || isSubagentBillingRole(agent.role))
    .map((agent): ThreadSubagentBillingSnapshot => {
      const status: ThreadSubagentBillingSnapshot["status"] =
        agent.status === "active" ? "active" : "stopped";
      const existingOccupied = existingSubagentContextByAgentId?.get(agent.agentId);
      return {
        agentId: agent.agentId,
        role: agent.role,
        status,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
        cacheReadTokens: agent.cacheReadTokens,
        cacheCreationTokens: agent.cacheCreationTokens,
        // Do not hardcode 0: that was persisted and later hydrate mistook billing totals
        // for window fill. Prefer metrics registry when present.
        contextOccupied: existingOccupied !== undefined && existingOccupied > 0 ? existingOccupied : 0,
        ecoCostUsd: agent.ecoCostUsd,
        ...(agent.ecoCostBreakdown && { ecoCostBreakdown: agent.ecoCostBreakdown }),
        ...(agent.modelIds[0] && { modelId: agent.modelIds[0] }),
      };
    })
    .sort((left, right) => {
      const tokenDiff = subagentSnapshotTotal(right) - subagentSnapshotTotal(left);
      return tokenDiff !== 0 ? tokenDiff : left.agentId.localeCompare(right.agentId);
    });
}

function applySourceReportedCosts(
  sources: Partial<Record<UsageLedgerSource, MutableSourceState>>,
  events: readonly UsageLedgerEvent[],
): void {
  for (const cost of collectReportedRequestCosts(events).values()) {
    const source = sources[cost.source];
    if (source) {
      source.reportedCostUsd += cost.hasExplicit ? cost.explicitSum : (cost.metadataTotal ?? 0);
    }
  }
}

function applyAgentReportedCosts(
  agents: Map<string, MutableAgentState>,
  events: readonly UsageLedgerEvent[],
): void {
  for (const cost of collectReportedRequestCosts(events, "agent").values()) {
    if (cost.agentId) {
      const agent = agents.get(cost.agentId);
      if (agent) {
        agent.reportedCostUsd += cost.hasExplicit ? cost.explicitSum : (cost.metadataTotal ?? 0);
      }
    }
  }
}

function applyRunAttemptReportedCosts(
  runAttempts: Map<string, MutableRunAttemptState>,
  events: readonly UsageLedgerEvent[],
): void {
  for (const cost of collectReportedRequestCosts(events, "runAttempt").values()) {
    if (cost.runAttemptId) {
      const runAttempt = runAttempts.get(cost.runAttemptId);
      if (runAttempt) {
        runAttempt.reportedCostUsd += cost.hasExplicit ? cost.explicitSum : (cost.metadataTotal ?? 0);
      }
    }
  }
}

function collectReportedRequestCosts(
  events: readonly UsageLedgerEvent[],
  scope: "source" | "agent" | "runAttempt" = "source",
): Map<
  string,
  {
    source: UsageLedgerSource;
    explicitSum: number;
    hasExplicit: boolean;
    metadataTotal?: number;
    agentId?: string;
    runAttemptId?: string;
  }
> {
  const costs = new Map<
    string,
    {
      source: UsageLedgerSource;
      explicitSum: number;
      hasExplicit: boolean;
      metadataTotal?: number;
      agentId?: string;
      runAttemptId?: string;
    }
  >();
  for (const event of events) {
    const scopedId =
      scope === "agent" ? event.agentId : scope === "runAttempt" ? event.runAttemptId : undefined;
    if (scope !== "source" && !scopedId) {
      continue;
    }
    const key = [scope, scopedId ?? event.source, event.source, event.requestKey ?? event.sourceEventId].join(
      "\u001f",
    );
    const cost = costs.get(key) ?? {
      source: event.source,
      explicitSum: 0,
      hasExplicit: false,
      ...(event.agentId && { agentId: event.agentId }),
      ...(event.runAttemptId && { runAttemptId: event.runAttemptId }),
    };
    if (event.reportedCostUsd !== undefined && Number.isFinite(event.reportedCostUsd)) {
      cost.explicitSum += event.reportedCostUsd;
      cost.hasExplicit = true;
    }
    const sdkTotal = readNumberMetadata(event.metadata, "sdkTotalCostUsd");
    if (sdkTotal !== undefined) {
      cost.metadataTotal = sdkTotal;
    }
    costs.set(key, cost);
  }
  return costs;
}

function resolveEventBilling(
  event: UsageLedgerEvent,
  resolveRates: ProjectBillingFromUsageLedgerInput["resolveRates"],
): RequestBillingDelta {
  const computed = readUsageLedgerComputedBilling(event.metadata);
  if (computed) {
    return computed;
  }
  const rates = resolveRates?.(event);
  if (rates) {
    return computeRequestBilling(usageFromEvent(event), rates.actualRates, rates.plannerRates);
  }
  return {
    plannerTokenCostUsd: 0,
    ecoCostUsd: 0,
    plannerBreakdown: null,
    ecoBreakdown: null,
    pricingResolved: false,
  };
}

function getOrCreateSource(
  sources: Partial<Record<UsageLedgerSource, MutableSourceState>>,
  source: UsageLedgerSource,
): MutableSourceState {
  const existing = sources[source];
  if (existing) {
    return existing;
  }
  const created: MutableSourceState = {
    source,
    total: createEmptyUsage(),
    plannerTokenCostUsd: 0,
    ecoCostUsd: 0,
    ecoCostBreakdown: emptyCostBreakdown(),
    plannerCostBreakdown: emptyCostBreakdown(),
    roleEcoCostUsd: {},
    roleModelIds: {},
    byRole: {},
    byModel: {},
    reportedCostUsd: 0,
    pricingResolved: true,
    unresolvedCount: 0,
    eventCount: 0,
  };
  sources[source] = created;
  return created;
}

function getOrCreateModel(state: MutableSourceState, modelId: string): MutableModelState {
  const existing = state.byModel[modelId];
  if (existing) {
    return existing;
  }
  const created = {
    modelId,
    roles: [],
    usage: createEmptyUsage(),
    ecoCostUsd: 0,
    reportedCostUsd: 0,
  };
  state.byModel[modelId] = created;
  return created;
}

function getOrCreateAgent(
  agents: Map<string, MutableAgentState>,
  event: UsageLedgerEvent,
): MutableAgentState {
  const agentId = event.agentId ?? "";
  const existing = agents.get(agentId);
  if (existing) {
    return existing;
  }
  const created: MutableAgentState = {
    agentId,
    role: event.role,
    usage: createEmptyUsage(),
    plannerTokenCostUsd: 0,
    ecoCostUsd: 0,
    reportedCostUsd: 0,
    pricingResolved: true,
    sources: new Set(),
    modelIds: new Set(),
    ecoCostBreakdown: emptyCostBreakdown(),
  };
  agents.set(agentId, created);
  return created;
}

function getOrCreateRunAttempt(
  runAttempts: Map<string, MutableRunAttemptState>,
  runAttemptId: string,
): MutableRunAttemptState {
  const existing = runAttempts.get(runAttemptId);
  if (existing) {
    return existing;
  }
  const created: MutableRunAttemptState = {
    runAttemptId,
    usage: createEmptyUsage(),
    plannerTokenCostUsd: 0,
    ecoCostUsd: 0,
    reportedCostUsd: 0,
    pricingResolved: true,
  };
  runAttempts.set(runAttemptId, created);
  return created;
}

function usageFromEvent(event: UsageLedgerEvent): ParsedUsage {
  return {
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    cacheReadTokens: event.cacheReadTokens,
    cacheCreationTokens: event.cacheCreationTokens,
  };
}

function addRole(roles: RuntimeAgentRole[], role: RuntimeAgentRole): void {
  if (!roles.includes(role)) {
    roles.push(role);
  }
}

function hasSourceData(state: MutableSourceState): boolean {
  return (
    usageTotal(state.total) > 0 ||
    state.ecoCostUsd > 0 ||
    state.plannerTokenCostUsd > 0 ||
    state.reportedCostUsd > 0
  );
}

function usageTotal(usage: ParsedUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

function modelSnapshotTotal(entry: ThreadBillingModelSnapshot): number {
  return entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens;
}

function subagentSnapshotTotal(entry: ThreadSubagentBillingSnapshot): number {
  return entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens;
}

function readNumberMetadata(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface ProxyBillableIndex {
  requestKeys: Set<string>;
  providerRequestIds: Set<string>;
  usageFingerprints: Set<string>;
}

function indexProxyBillableEvents(events: readonly UsageLedgerEvent[]): ProxyBillableIndex {
  const requestKeys = new Set<string>();
  const providerRequestIds = new Set<string>();
  const usageFingerprints = new Set<string>();
  for (const event of events) {
    if (event.source !== "proxy") {
      continue;
    }
    if (event.usageKind === "request_partial" || event.usageKind === "context") {
      continue;
    }
    if (event.requestKey) {
      requestKeys.add(event.requestKey);
    }
    if (event.providerRequestId) {
      providerRequestIds.add(event.providerRequestId);
    }
    usageFingerprints.add(buildUsageLedgerFingerprint(event));
  }
  return { requestKeys, providerRequestIds, usageFingerprints };
}

function shouldSkipDuplicateBillableEvent(event: UsageLedgerEvent, proxyIndex: ProxyBillableIndex): boolean {
  if (event.source !== "sdk") {
    return false;
  }
  if (event.requestKey && proxyIndex.requestKeys.has(event.requestKey)) {
    return true;
  }
  if (event.providerRequestId && proxyIndex.providerRequestIds.has(event.providerRequestId)) {
    return true;
  }
  return proxyIndex.usageFingerprints.has(buildUsageLedgerFingerprint(event));
}

function buildUsageLedgerFingerprint(event: UsageLedgerEvent): string {
  return [
    event.role,
    event.agentId ?? "",
    event.modelId ?? "",
    event.inputTokens,
    event.outputTokens,
    event.cacheReadTokens,
    event.cacheCreationTokens,
  ].join(":");
}
