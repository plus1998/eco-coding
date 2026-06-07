import type { OtelUsageUpdate, ParsedUsage } from "@eco/runtime";
import type { BillingUsageSource, RuntimeAgentRole } from "../shared/ipc";
import {
  nextOtelRequestDedupId,
  type UsageBillingObservation,
} from "./billing-orchestration";
import { normalizeTelemetryBillingRole } from "./telemetry-billing-role";
import { buildUsageRequestKey } from "./thread-usage-accumulator";

export { normalizeTelemetryBillingRole } from "./telemetry-billing-role";

export interface OtelUsageBillingInput {
  threadId: string;
  role: RuntimeAgentRole;
  source: BillingUsageSource;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  otelCostUsd?: number;
  modelId?: string;
  runAttemptId?: string;
  plannerAgentId?: string;
  requestKey: string;
  otelDedupId: string;
  reconciliationOnly: true;
  updateContext: false;
}

export interface ResolveOtelUsageBillingInput {
  usage: OtelUsageUpdate;
  currentRequestSeq?: number;
  runAttemptId?: string;
  plannerAgentId?: string;
}

export interface OtelUsageBillingResolution {
  nextRequestSeq: number;
  dedupId: string;
  billingRole: RuntimeAgentRole;
  hasTokens: boolean;
  usage: ParsedUsage;
  requestKey: string;
  observation?: UsageBillingObservation;
  billingInput: OtelUsageBillingInput;
}

export function resolveOtelUsageBilling(
  input: ResolveOtelUsageBillingInput,
): OtelUsageBillingResolution {
  const { usage } = input;
  const { seq, dedupId } = nextOtelRequestDedupId(input.currentRequestSeq);
  const billingRole = normalizeTelemetryBillingRole(usage.role);
  const parsedUsage: ParsedUsage = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheCreationTokens: usage.cacheCreationTokens ?? 0,
  };
  const hasTokens = usageTotal(parsedUsage) > 0;
  const requestKey = buildUsageRequestKey({
    role: billingRole,
    inputTokens: parsedUsage.inputTokens,
    outputTokens: parsedUsage.outputTokens,
    cacheReadTokens: parsedUsage.cacheReadTokens,
    cacheCreationTokens: parsedUsage.cacheCreationTokens,
    ...(usage.modelId && { modelId: usage.modelId }),
    dedupId,
  });
  return {
    nextRequestSeq: seq,
    dedupId,
    billingRole,
    hasTokens,
    usage: parsedUsage,
    requestKey,
    ...(hasTokens && {
      observation: {
        source: "otel",
        role: billingRole,
        usage: parsedUsage,
        requestKey,
        ...(usage.modelId && { modelId: usage.modelId }),
      },
    }),
    billingInput: {
      threadId: usage.threadId,
      role: billingRole,
      source: "otel",
      inputTokens: parsedUsage.inputTokens,
      outputTokens: parsedUsage.outputTokens,
      cacheReadTokens: parsedUsage.cacheReadTokens,
      cacheCreationTokens: parsedUsage.cacheCreationTokens,
      ...(usage.costUsd !== undefined && { otelCostUsd: usage.costUsd }),
      ...(usage.modelId && { modelId: usage.modelId }),
      ...(input.runAttemptId && { runAttemptId: input.runAttemptId }),
      ...(input.plannerAgentId && { plannerAgentId: input.plannerAgentId }),
      requestKey,
      otelDedupId: dedupId,
      reconciliationOnly: true,
      updateContext: false,
    },
  };
}

function usageTotal(usage: ParsedUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
}
