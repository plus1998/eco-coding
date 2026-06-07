import type {
  AgentProfilePerformanceRunSnapshot,
  AgentProfilePerformanceSnapshot,
  AgentProfileWorkflowStepPerformanceSnapshot,
  OrchestrationProfile,
  ThreadBillingSnapshot,
  ThreadStatus,
  ThreadSummary,
} from "../shared/ipc";

export interface BuildAgentProfilePerformanceInput {
  threads: readonly ThreadSummary[];
  profiles: readonly OrchestrationProfile[];
  getBillingSnapshot: (threadId: string) => ThreadBillingSnapshot | undefined;
}

interface MutableProfilePerformance {
  profileId: string;
  selectionId: string;
  profileName: string;
  preset: string;
  strategyKind: AgentProfilePerformanceSnapshot["strategyKind"];
  source: AgentProfilePerformanceSnapshot["source"];
  runCount: number;
  completedCount: number;
  failedCount: number;
  blockedCount: number;
  idleCount: number;
  activeCount: number;
  durationTotalMs: number;
  durationCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  latestRunAt?: string;
  modelIds: Set<string>;
  workflowSteps: Map<string, MutableWorkflowStepPerformance>;
  recentRuns: AgentProfilePerformanceRunSnapshot[];
}

interface MutableWorkflowStepPerformance {
  stepId: string;
  agentKey: string;
  outputKey: string;
  runCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  ecoCostUsd: number;
  modelIds: Set<string>;
}

export function buildAgentProfilePerformanceSnapshots(
  input: BuildAgentProfilePerformanceInput,
): AgentProfilePerformanceSnapshot[] {
  const profileBySelectionId = new Map<string, OrchestrationProfile>();
  for (const profile of input.profiles) {
    profileBySelectionId.set(profile.id, profile);
    if (profile.sourceRouteProfileId) {
      profileBySelectionId.set(profile.sourceRouteProfileId, profile);
    }
  }

  const byProfileId = new Map<string, MutableProfilePerformance>();
  for (const profile of input.profiles) {
    byProfileId.set(profile.id, createConfiguredProfilePerformance(profile));
  }

  for (const thread of input.threads) {
    const selectionId = thread.runtimeConfig?.routeProfileId?.trim();
    if (!selectionId) {
      continue;
    }
    const profile = profileBySelectionId.get(selectionId);
    const state = getOrCreateProfilePerformance(byProfileId, selectionId, profile);
    addThreadToProfilePerformance(state, thread, input.getBillingSnapshot(thread.id));
  }

  return [...byProfileId.values()].map(finalizeProfilePerformance).sort(compareProfilePerformanceSnapshots);
}

function createConfiguredProfilePerformance(profile: OrchestrationProfile): MutableProfilePerformance {
  return {
    profileId: profile.id,
    selectionId: profile.sourceRouteProfileId ?? profile.id,
    profileName: profile.name,
    preset: profile.preset,
    strategyKind: profile.strategy.kind,
    source: "configured",
    runCount: 0,
    completedCount: 0,
    failedCount: 0,
    blockedCount: 0,
    idleCount: 0,
    activeCount: 0,
    durationTotalMs: 0,
    durationCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ecoCostUsd: 0,
    modelIds: new Set(),
    workflowSteps: new Map(),
    recentRuns: [],
  };
}

function getOrCreateProfilePerformance(
  byProfileId: Map<string, MutableProfilePerformance>,
  selectionId: string,
  profile: OrchestrationProfile | undefined,
): MutableProfilePerformance {
  if (profile) {
    const existing = byProfileId.get(profile.id);
    if (existing) {
      return existing;
    }
    const created = createConfiguredProfilePerformance(profile);
    byProfileId.set(profile.id, created);
    return created;
  }

  const profileId = `historical:${selectionId}`;
  const existing = byProfileId.get(profileId);
  if (existing) {
    return existing;
  }
  const created: MutableProfilePerformance = {
    profileId,
    selectionId,
    profileName: `已删除 Profile · ${selectionId}`,
    preset: "unknown",
    strategyKind: "unknown",
    source: "historical",
    runCount: 0,
    completedCount: 0,
    failedCount: 0,
    blockedCount: 0,
    idleCount: 0,
    activeCount: 0,
    durationTotalMs: 0,
    durationCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ecoCostUsd: 0,
    modelIds: new Set(),
    workflowSteps: new Map(),
    recentRuns: [],
  };
  byProfileId.set(profileId, created);
  return created;
}

function addThreadToProfilePerformance(
  state: MutableProfilePerformance,
  thread: ThreadSummary,
  billing: ThreadBillingSnapshot | undefined,
): void {
  state.runCount += 1;
  addStatusCount(state, thread.status);

  const durationMs = readThreadDurationMs(thread);
  if (durationMs !== undefined && isDurationStatus(thread.status)) {
    state.durationTotalMs += durationMs;
    state.durationCount += 1;
  }

  if (isNewerIso(thread.updatedAt, state.latestRunAt)) {
    state.latestRunAt = thread.updatedAt;
  }

  const usage = usageTotalsFromBilling(billing);
  state.inputTokens += usage.inputTokens;
  state.outputTokens += usage.outputTokens;
  state.cacheReadTokens += usage.cacheReadTokens;
  state.cacheCreationTokens += usage.cacheCreationTokens;
  state.ecoCostUsd += billing?.ecoCostUsd ?? 0;

  for (const model of billing?.byModel ?? []) {
    if (model.modelId) {
      state.modelIds.add(model.modelId);
    }
  }
  for (const subagent of billing?.subagents ?? []) {
    if (subagent.modelId) {
      state.modelIds.add(subagent.modelId);
    }
  }

  for (const step of billing?.workflowSteps ?? []) {
    const stepState = getOrCreateWorkflowStepPerformance(state, step.stepId, step.agentKey, step.outputKey);
    stepState.runCount += 1;
    stepState.inputTokens += step.inputTokens;
    stepState.outputTokens += step.outputTokens;
    stepState.cacheReadTokens += step.cacheReadTokens;
    stepState.cacheCreationTokens += step.cacheCreationTokens;
    stepState.ecoCostUsd += step.ecoCostUsd;
    for (const modelId of step.modelIds) {
      stepState.modelIds.add(modelId);
      state.modelIds.add(modelId);
    }
  }

  state.recentRuns.push({
    threadId: thread.id,
    title: thread.title,
    status: thread.status,
    updatedAt: thread.updatedAt,
    ...(durationMs !== undefined && { durationMs }),
    totalTokens: usageTotal(usage),
    ecoCostUsd: billing?.ecoCostUsd ?? 0,
  });
}

function addStatusCount(state: MutableProfilePerformance, status: ThreadStatus): void {
  if (status === "completed") {
    state.completedCount += 1;
    return;
  }
  if (status === "failed") {
    state.failedCount += 1;
    return;
  }
  if (status === "blocked") {
    state.blockedCount += 1;
    return;
  }
  if (status === "idle") {
    state.idleCount += 1;
    return;
  }
  state.activeCount += 1;
}

function getOrCreateWorkflowStepPerformance(
  profile: MutableProfilePerformance,
  stepId: string,
  agentKey: string,
  outputKey: string,
): MutableWorkflowStepPerformance {
  const existing = profile.workflowSteps.get(stepId);
  if (existing) {
    return existing;
  }
  const created: MutableWorkflowStepPerformance = {
    stepId,
    agentKey,
    outputKey,
    runCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ecoCostUsd: 0,
    modelIds: new Set(),
  };
  profile.workflowSteps.set(stepId, created);
  return created;
}

function finalizeProfilePerformance(state: MutableProfilePerformance): AgentProfilePerformanceSnapshot {
  const totalTokens = tokenTotalFromParts(state);
  const terminalCount = state.completedCount + state.failedCount + state.blockedCount;
  return {
    profileId: state.profileId,
    selectionId: state.selectionId,
    profileName: state.profileName,
    preset: state.preset,
    strategyKind: state.strategyKind,
    source: state.source,
    runCount: state.runCount,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
    blockedCount: state.blockedCount,
    idleCount: state.idleCount,
    activeCount: state.activeCount,
    ...(terminalCount > 0 && {
      successRatePct: (state.completedCount / terminalCount) * 100,
    }),
    ...(state.durationCount > 0 && {
      avgDurationMs: state.durationTotalMs / state.durationCount,
    }),
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheCreationTokens: state.cacheCreationTokens,
    totalTokens,
    ecoCostUsd: state.ecoCostUsd,
    ...(state.runCount > 0 && { avgCostUsd: state.ecoCostUsd / state.runCount }),
    ...(state.latestRunAt && { latestRunAt: state.latestRunAt }),
    modelIds: [...state.modelIds].sort(),
    workflowSteps: [...state.workflowSteps.values()]
      .map(finalizeWorkflowStepPerformance)
      .sort(compareWorkflowStepPerformance),
    recentRuns: state.recentRuns.sort(compareRecentRuns).slice(0, 3),
  };
}

function finalizeWorkflowStepPerformance(
  state: MutableWorkflowStepPerformance,
): AgentProfileWorkflowStepPerformanceSnapshot {
  return {
    stepId: state.stepId,
    agentKey: state.agentKey,
    outputKey: state.outputKey,
    runCount: state.runCount,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheCreationTokens: state.cacheCreationTokens,
    totalTokens: tokenTotalFromParts(state),
    ecoCostUsd: state.ecoCostUsd,
    modelIds: [...state.modelIds].sort(),
  };
}

function usageTotalsFromBilling(billing: ThreadBillingSnapshot | undefined): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  return {
    inputTokens: billing?.totalTokens.input ?? 0,
    outputTokens: billing?.totalTokens.output ?? 0,
    cacheReadTokens: billing?.totalTokens.cacheRead ?? 0,
    cacheCreationTokens: billing?.totalTokens.cacheCreation ?? 0,
  };
}

function readThreadDurationMs(thread: ThreadSummary): number | undefined {
  const started = Date.parse(thread.createdAt);
  const ended = Date.parse(thread.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return undefined;
  }
  return ended - started;
}

function isDurationStatus(status: ThreadStatus): boolean {
  return status === "completed" || status === "failed" || status === "blocked" || status === "idle";
}

function usageTotal(input: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return input.inputTokens + input.outputTokens + input.cacheReadTokens + input.cacheCreationTokens;
}

function tokenTotalFromParts(input: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}): number {
  return usageTotal(input);
}

function isNewerIso(candidate: string, current: string | undefined): boolean {
  if (!current) {
    return true;
  }
  return Date.parse(candidate) > Date.parse(current);
}

function compareRecentRuns(
  left: AgentProfilePerformanceRunSnapshot,
  right: AgentProfilePerformanceRunSnapshot,
): number {
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function compareWorkflowStepPerformance(
  left: AgentProfileWorkflowStepPerformanceSnapshot,
  right: AgentProfileWorkflowStepPerformanceSnapshot,
): number {
  return (
    right.ecoCostUsd - left.ecoCostUsd ||
    right.totalTokens - left.totalTokens ||
    left.stepId.localeCompare(right.stepId)
  );
}

function compareProfilePerformanceSnapshots(
  left: AgentProfilePerformanceSnapshot,
  right: AgentProfilePerformanceSnapshot,
): number {
  const latest = readSortableTime(right.latestRunAt) - readSortableTime(left.latestRunAt);
  if (latest !== 0) {
    return latest;
  }
  return left.profileName.localeCompare(right.profileName);
}

function readSortableTime(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}
