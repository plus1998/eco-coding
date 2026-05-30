import type { AgentRole, ThreadBillingSnapshot } from "../shared/ipc";
import {
  computeRequestBilling,
  computeThreadBillingTotals,
  mergeUsageTotals,
  type ModelCostRates,
  type ParsedUsage,
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

export class ThreadUsageAccumulator {
  private readonly states = new Map<
    string,
    {
      byRole: Partial<Record<AgentRole, ParsedUsage>>;
      total: ParsedUsage;
      otelCostUsd: number;
      plannerTokenCostUsd: number;
      ecoCostUsd: number;
      roleEcoCostUsd: Partial<Record<AgentRole, number>>;
      roleModelIds: Partial<Record<AgentRole, string>>;
      seenRequestKeys: Set<string>;
      pricingResolved: boolean;
      unresolvedCount: number;
    }
  >();

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
    state.roleEcoCostUsd[role] = (state.roleEcoCostUsd[role] ?? 0) + billing.ecoCostUsd;

    if (input.modelId) {
      state.roleModelIds[role] = input.modelId;
    }

    if (!billing.pricingResolved) {
      state.unresolvedCount += 1;
      state.pricingResolved = false;
    }

    return this.toSnapshot(state, input.plannerModelLabel);
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

  private getOrCreateState(threadId: string) {
    let state = this.states.get(threadId);
    if (!state) {
      state = {
        byRole: {},
        total: createEmptyUsage(),
        otelCostUsd: 0,
        plannerTokenCostUsd: 0,
        ecoCostUsd: 0,
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
    state: NonNullable<ReturnType<typeof this.states.get>>,
    plannerModelLabel?: string,
  ): ThreadBillingSnapshot {
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
      ...(plannerModelLabel && { plannerModelLabel }),
      pricingResolved: state.pricingResolved && state.unresolvedCount === 0,
      ...(Object.keys(byRole).length > 0 && { byRole }),
    };
  }
}

export function buildUsageRequestKey(record: UsageRequestRecord): string {
  return [
    record.role,
    record.inputTokens,
    record.outputTokens,
    record.cacheReadTokens ?? 0,
    record.cacheCreationTokens ?? 0,
    record.modelId ?? "",
  ].join(":");
}
