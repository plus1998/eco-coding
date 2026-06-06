import type { ParsedUsage, RequestBillingDelta } from "@eco/runtime";
import type { AgentRole, ThreadBillingSnapshot } from "../shared/ipc";
import {
  buildSubagentLegacyMetricsRecordInput,
  type SubagentBillingMetricsContext,
} from "./subagent-billing-metrics-effects";
import {
  applySubagentLegacyMetricsFallback,
  type AppliedSubagentLegacyMetricsFallback,
  type SubagentLegacyMetricsFallbackServices,
} from "./subagent-legacy-metrics-fallback-effects";
import type {
  UsageLedgerBillingSnapshotSelection,
  UsageLedgerBillingSnapshotSelectionOptions,
} from "./usage-ledger-coordinator";

export interface ApplySingleUsageSubagentLegacyFallbackInput {
  threadId: string;
  context: SubagentBillingMetricsContext | undefined;
  billingSelection: UsageLedgerBillingSnapshotSelection;
  legacyBilling: ThreadBillingSnapshot;
  selectionOptions: UsageLedgerBillingSnapshotSelectionOptions;
  usage: ParsedUsage;
  billing: RequestBillingDelta;
  modelId?: string;
  requestKey: string;
  services: SubagentLegacyMetricsFallbackServices;
}

export interface SdkRunSubagentLegacyFallbackModel {
  role?: AgentRole;
  usage: ParsedUsage;
  computedBilling: RequestBillingDelta;
  modelId?: string;
}

export interface ApplySdkRunSubagentLegacyFallbackInput {
  threadId: string;
  context: SubagentBillingMetricsContext | undefined;
  billingSelection: UsageLedgerBillingSnapshotSelection;
  legacyBilling: ThreadBillingSnapshot;
  selectionOptions: UsageLedgerBillingSnapshotSelectionOptions;
  models: readonly SdkRunSubagentLegacyFallbackModel[];
  billingRole: AgentRole;
  parentToolUseId?: string;
  requestKey: string;
  services: SubagentLegacyMetricsFallbackServices;
}

export function applySingleUsageSubagentLegacyFallback(
  input: ApplySingleUsageSubagentLegacyFallbackInput,
): AppliedSubagentLegacyMetricsFallback {
  const records = input.context
    ? [
        buildSubagentLegacyMetricsRecordInput(input.context, {
          usage: input.usage,
          billing: input.billing,
          ...(input.modelId && { modelId: input.modelId }),
          requestKey: input.requestKey,
        }),
      ]
    : [];

  return applySubagentLegacyMetricsFallback({
    threadId: input.threadId,
    hasSubagentContext: Boolean(input.context),
    billingSelection: input.billingSelection,
    legacyBilling: input.legacyBilling,
    selectionOptions: input.selectionOptions,
    records,
    services: input.services,
  });
}

export function applySdkRunSubagentLegacyFallback(
  input: ApplySdkRunSubagentLegacyFallbackInput,
): AppliedSubagentLegacyMetricsFallback {
  const context = input.context;
  const records = context
    ? input.models.map((model) =>
        buildSubagentLegacyMetricsRecordInput(context, {
          role: model.role ?? input.billingRole,
          ...(input.parentToolUseId && { parentToolUseId: input.parentToolUseId }),
          usage: model.usage,
          billing: model.computedBilling,
          ...(model.modelId && { modelId: model.modelId }),
          requestKey: input.requestKey,
        }),
      )
    : [];

  return applySubagentLegacyMetricsFallback({
    threadId: input.threadId,
    hasSubagentContext: Boolean(input.context),
    billingSelection: input.billingSelection,
    legacyBilling: input.legacyBilling,
    selectionOptions: input.selectionOptions,
    records,
    services: input.services,
  });
}
