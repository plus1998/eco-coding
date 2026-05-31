import type { AgentRole, ThreadBillingSnapshot } from "../shared/ipc";
import {
  computeRequestBilling,
  computeThreadBillingTotals,
  emptyCostBreakdown,
  mergeCostBreakdowns,
  mergeUsageTotals,
  type ModelCostRates,
  type ParsedUsage,
  type TokenCostBreakdown,
  tokenTotalsFromUsage,
} from "@eco/runtime";
import { createEmptyUsage, type UsageRequestRecord } from "./usage-request-types";

export type { ThreadBillingSnapshot };

export interface RecordUsageInput {
  threadId: string;
  role: AgentRole;
  delta: ParsedUsage;
  otelCostUsd?: number;
  actualRates: ModelCostRates | null;
  plannerRates: ModelCostRates | null;
  modelId?: string;
  requestKey?: string;
  plannerModelLabel?: string;
}

export interface RecordRunUsageModel {
  role?: AgentRole;
  modelId: string;
  usage: ParsedUsage;
  actualRates: ModelCostRates | null;
  plannerRates: ModelCostRates | null;
}

export interface RecordRunUsageInput {
  threadId: string;
  role: AgentRole;
  requestKey: string;
  models: RecordRunUsageModel[];
  otelCostUsd?: number;
  plannerModelLabel?: string;
}

type ThreadUsageAccumulatorState = {
  byRole: Partial<Record<AgentRole, ParsedUsage>>;
  total: ParsedUsage;
  otelCostUsd: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  plannerCostBreakdown: TokenCostBreakdown;
  roleEcoCostUsd: Partial<Record<AgentRole, number>>;
  roleModelIds: Partial<Record<AgentRole, string>>;
  seenRequestKeys: Set<string>;
  pricingResolved: boolean;
  unresolvedCount: number;
  plannerModelLabel?: string;
};

/** JSON-serializable accumulator state for SQLite persistence. */
export interface SerializedThreadUsageState {
  byRole: Partial<Record<AgentRole, ParsedUsage>>;
  total: ParsedUsage;
  otelCostUsd: number;
  plannerTokenCostUsd: number;
  ecoCostUsd: number;
  ecoCostBreakdown: TokenCostBreakdown;
  plannerCostBreakdown: TokenCostBreakdown;
  roleEcoCostUsd: Partial<Record<AgentRole, number>>;
  roleModelIds: Partial<Record<AgentRole, string>>;
  seenRequestKeys: string[];
  pricingResolved: boolean;
  unresolvedCount: number;
  plannerModelLabel?: string;
}

export class ThreadUsageAccumulator {
  private readonly states = new Map<string, ThreadUsageAccumulatorState>();

  recordUsage(input: RecordUsageInput): ThreadBillingSnapshot {
    const state = this.getOrCreateState(input.threadId);

    if (input.requestKey && state.seenRequestKeys.has(input.requestKey)) {
      return this.toSnapshot(state, input.plannerModelLabel);
    }
    if (input.requestKey) {
      state.seenRequestKeys.add(input.requestKey);
    }

    const role = input.role;
    const prevRole = state.byRole[role] ?? createEmptyUsage();
    state.byRole[role] = mergeUsageTotals(prevRole, input.delta);
    state.total = mergeUsageTotals(state.total, input.delta);

    if (input.otelCostUsd !== undefined && Number.isFinite(input.otelCostUsd)) {
      state.otelCostUsd += input.otelCostUsd;
    }

    const billing = computeRequestBilling(input.delta, input.actualRates, input.plannerRates);
    state.plannerTokenCostUsd += billing.plannerTokenCostUsd;
    state.ecoCostUsd += billing.ecoCostUsd;
    if (billing.ecoBreakdown) {
      state.ecoCostBreakdown = mergeCostBreakdowns(state.ecoCostBreakdown, billing.ecoBreakdown);
    }
    if (billing.plannerBreakdown) {
      state.plannerCostBreakdown = mergeCostBreakdowns(
        state.plannerCostBreakdown,
        billing.plannerBreakdown,
      );
    }
    state.roleEcoCostUsd[role] = (state.roleEcoCostUsd[role] ?? 0) + billing.ecoCostUsd;

    if (input.modelId) {
      state.roleModelIds[role] = input.modelId;
    }

    if (!billing.pricingResolved) {
      state.unresolvedCount += 1;
      state.pricingResolved = false;
    }

    if (input.plannerModelLabel) {
      state.plannerModelLabel = input.plannerModelLabel;
    }

    return this.toSnapshot(state, input.plannerModelLabel);
  }

  /** Authoritative SDK result billing (modelUsage); deduped per run via requestKey. */
  recordRunUsage(input: RecordRunUsageInput): ThreadBillingSnapshot {
    const state = this.getOrCreateState(input.threadId);

    if (state.seenRequestKeys.has(input.requestKey)) {
      return this.toSnapshot(state, input.plannerModelLabel);
    }
    state.seenRequestKeys.add(input.requestKey);

    if (input.otelCostUsd !== undefined && Number.isFinite(input.otelCostUsd)) {
      state.otelCostUsd += input.otelCostUsd;
    }

    for (const model of input.models) {
      const role = model.role ?? input.role;
      const prevRole = state.byRole[role] ?? createEmptyUsage();
      state.byRole[role] = mergeUsageTotals(prevRole, model.usage);
      state.total = mergeUsageTotals(state.total, model.usage);

      const billing = computeRequestBilling(model.usage, model.actualRates, model.plannerRates);
      state.plannerTokenCostUsd += billing.plannerTokenCostUsd;
      state.ecoCostUsd += billing.ecoCostUsd;
      if (billing.ecoBreakdown) {
        state.ecoCostBreakdown = mergeCostBreakdowns(state.ecoCostBreakdown, billing.ecoBreakdown);
      }
      if (billing.plannerBreakdown) {
        state.plannerCostBreakdown = mergeCostBreakdowns(
          state.plannerCostBreakdown,
          billing.plannerBreakdown,
        );
      }
      state.roleEcoCostUsd[role] = (state.roleEcoCostUsd[role] ?? 0) + billing.ecoCostUsd;
      state.roleModelIds[role] = model.modelId;

      if (!billing.pricingResolved) {
        state.unresolvedCount += 1;
        state.pricingResolved = false;
      }
    }

    if (input.plannerModelLabel) {
      state.plannerModelLabel = input.plannerModelLabel;
    }

    return this.toSnapshot(state, input.plannerModelLabel);
  }

  recordOtelCostOnly(threadId: string, otelCostUsd: number, plannerModelLabel?: string): ThreadBillingSnapshot {
    const state = this.getOrCreateState(threadId);
    if (Number.isFinite(otelCostUsd)) {
      state.otelCostUsd += otelCostUsd;
    }
    return this.toSnapshot(state, plannerModelLabel);
  }

  getSnapshot(threadId: string, plannerModelLabel?: string): ThreadBillingSnapshot | undefined {
    const state = this.states.get(threadId);
    if (!state) {
      return undefined;
    }
    return this.toSnapshot(state, plannerModelLabel);
  }

  clear(threadId: string): void {
    this.states.delete(threadId);
  }

  serializeState(threadId: string): SerializedThreadUsageState | undefined {
    const state = this.states.get(threadId);
    if (!state) {
      return undefined;
    }
    return {
      byRole: state.byRole,
      total: state.total,
      otelCostUsd: state.otelCostUsd,
      plannerTokenCostUsd: state.plannerTokenCostUsd,
      ecoCostUsd: state.ecoCostUsd,
      ecoCostBreakdown: state.ecoCostBreakdown,
      plannerCostBreakdown: state.plannerCostBreakdown,
      roleEcoCostUsd: state.roleEcoCostUsd,
      roleModelIds: state.roleModelIds,
      seenRequestKeys: [...state.seenRequestKeys],
      pricingResolved: state.pricingResolved,
      unresolvedCount: state.unresolvedCount,
      ...(state.plannerModelLabel && { plannerModelLabel: state.plannerModelLabel }),
    };
  }

  restoreState(threadId: string, data: SerializedThreadUsageState): void {
    this.states.set(threadId, {
      byRole: data.byRole,
      total: data.total,
      otelCostUsd: data.otelCostUsd,
      plannerTokenCostUsd: data.plannerTokenCostUsd,
      ecoCostUsd: data.ecoCostUsd,
      ecoCostBreakdown: data.ecoCostBreakdown,
      plannerCostBreakdown: data.plannerCostBreakdown,
      roleEcoCostUsd: data.roleEcoCostUsd,
      roleModelIds: data.roleModelIds,
      seenRequestKeys: new Set(data.seenRequestKeys),
      pricingResolved: data.pricingResolved,
      unresolvedCount: data.unresolvedCount,
      ...(data.plannerModelLabel && { plannerModelLabel: data.plannerModelLabel }),
    });
  }

  private getOrCreateState(threadId: string) {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        byRole: {},
        total: createEmptyUsage(),
        otelCostUsd: 0,
        plannerTokenCostUsd: 0,
        ecoCostUsd: 0,
        ecoCostBreakdown: emptyCostBreakdown(),
        plannerCostBreakdown: emptyCostBreakdown(),
        roleEcoCostUsd: {},
        roleModelIds: {},
        seenRequestKeys: new Set(),
        pricingResolved: true,
        unresolvedCount: 0,
      };
      this.states.set(threadId, state);
    }
    return state;
  }

  private toSnapshot(
    state: ThreadUsageAccumulatorState,
    plannerModelLabel?: string,
  ): ThreadBillingSnapshot {
    const label = plannerModelLabel ?? state.plannerModelLabel;
    const totals = computeThreadBillingTotals(
      state.otelCostUsd,
      state.plannerTokenCostUsd,
      state.ecoCostUsd,
    );

    const byRole: ThreadBillingSnapshot["byRole"] = {};
    for (const [role, usage] of Object.entries(state.byRole) as [AgentRole, ParsedUsage][]) {
      byRole[role] = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheCreationTokens: usage.cacheCreationTokens,
        ecoCostUsd: state.roleEcoCostUsd[role] ?? 0,
        ...(state.roleModelIds[role] && { modelId: state.roleModelIds[role] }),
      };
    }

    return {
      totalTokens: tokenTotalsFromUsage(state.total),
      ...totals,
      ecoCostBreakdown: state.ecoCostBreakdown,
      plannerCostBreakdown: state.plannerCostBreakdown,
      ...(label && { plannerModelLabel: label }),
      pricingResolved: state.pricingResolved && state.unresolvedCount === 0,
      ...(Object.keys(byRole).length > 0 && { byRole }),
    };
  }
}

export function buildUsageRequestKey(record: UsageRequestRecord): string {
  return [
    "otel",
    record.role,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens ?? 0,
    record.cacheCreationTokens ?? 0,
    record.modelId ?? "",
    record.dedupId ?? "",
  ].join(":");
}
