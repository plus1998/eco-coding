import { mergeCostBreakdowns, type ParsedUsage, type RequestBillingDelta } from "@eco/runtime";
import type { AgentRole } from "../shared/ipc";
import { buildSubagentUsageContributionKey } from "./subagent-metrics-persistence";
import type { SubagentMetricsEntry } from "./subagent-metrics-state";
import { SubagentMetricsState } from "./subagent-metrics-state";

export interface SubagentLegacyUsageRecordTarget {
  agentId: string;
  role: AgentRole;
}

export interface SubagentLegacyUsageObservationInput {
  usage: ParsedUsage;
  contextOccupied: number;
  contextLimit?: number;
  billing: RequestBillingDelta;
  modelId?: string;
  requestKey: string;
}

export interface SubagentLegacyUsageRecordInput
  extends SubagentLegacyUsageRecordTarget,
    SubagentLegacyUsageObservationInput {}

export type SubagentLegacyUsageRecordResult =
  | {
      deduped: false;
      entry: SubagentMetricsEntry;
      usageKey: string;
      modelId?: string;
    }
  | {
      deduped: true;
      entry?: SubagentMetricsEntry;
      usageKey: string;
      modelId?: string;
    };

export class SubagentLegacyUsageTracker {
  private readonly seenUsageKeys = new Set<string>();

  recordForTarget(
    metrics: SubagentMetricsState,
    target: SubagentLegacyUsageRecordTarget,
    input: SubagentLegacyUsageObservationInput,
    updatedAt: number,
  ): SubagentLegacyUsageRecordResult {
    return this.record(
      metrics,
      {
        agentId: target.agentId,
        role: target.role,
        usage: input.usage,
        contextOccupied: input.contextOccupied,
        billing: input.billing,
        requestKey: input.requestKey,
        ...(input.contextLimit !== undefined && { contextLimit: input.contextLimit }),
        ...(input.modelId && { modelId: input.modelId }),
      },
      updatedAt,
    );
  }

  record(
    metrics: SubagentMetricsState,
    input: SubagentLegacyUsageRecordInput,
    updatedAt: number,
  ): SubagentLegacyUsageRecordResult {
    const usageKey = buildSubagentUsageContributionKey(input, {
      agentId: input.agentId,
      role: input.role,
    });
    const modelId = input.modelId ?? input.usage.modelId;

    if (this.seenUsageKeys.has(usageKey)) {
      const entry = metrics.getEntry(input.agentId);
      return {
        deduped: true,
        usageKey,
        ...(entry && { entry }),
        ...(modelId && { modelId }),
      };
    }

    this.seenUsageKeys.add(usageKey);
    const entry = metrics.ensureEntry(input.agentId, input.role, "active", updatedAt);
    entry.usage = mergeSubagentUsage(entry.usage, input.usage);
    entry.contextOccupied = input.contextOccupied;
    if (input.contextLimit !== undefined) {
      entry.contextLimit = input.contextLimit;
    }
    entry.ecoCostUsd += input.billing.ecoCostUsd;
    if (input.billing.ecoBreakdown) {
      entry.ecoCostBreakdown = mergeCostBreakdowns(entry.ecoCostBreakdown, input.billing.ecoBreakdown);
    }
    if (input.modelId) {
      entry.modelId = input.modelId;
    }
    entry.lastRequestKey = input.requestKey;
    entry.updatedAt = updatedAt;

    return {
      deduped: false,
      entry,
      usageKey,
      ...(modelId && { modelId }),
    };
  }

  restoreContribution(input: {
    agentId: string;
    role: AgentRole;
    requestKey: string;
    modelId?: string;
  }): void {
    this.seenUsageKeys.add(
      buildSubagentUsageContributionKey(
        {
          ...(input.modelId && { modelId: input.modelId }),
          requestKey: input.requestKey,
        },
        { agentId: input.agentId, role: input.role },
      ),
    );
  }
}

function mergeSubagentUsage(left: ParsedUsage, right: ParsedUsage): ParsedUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheCreationTokens: left.cacheCreationTokens + right.cacheCreationTokens,
  };
}
