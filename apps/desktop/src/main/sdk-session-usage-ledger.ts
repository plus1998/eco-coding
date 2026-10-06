import { computeRequestBilling, type ParsedUsage } from "@eco/runtime";
import type { ResolvedSdkRunBillingModel } from "./usage-billing-artifacts";
import type { UsageLedgerEvent } from "./usage-ledger";
import {
  type BuildSdkUsageLedgerEventsInput,
  buildSdkUsageLedgerEvents,
  buildSingleUsageLedgerEvent,
} from "./usage-ledger-adapters";

export interface SdkSessionUsageContext {
  sessionId: string;
  resumed: boolean;
  resetId?: string;
}

export function readSdkSessionUsageContext(payload: unknown): SdkSessionUsageContext | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const context = (payload as Record<string, unknown>).sdk_session_usage;
  if (!context || typeof context !== "object") return undefined;
  const value = context as Record<string, unknown>;
  if (
    typeof value.sessionId !== "string" ||
    !value.sessionId ||
    value.sessionId === "unknown-session" ||
    typeof value.resumed !== "boolean"
  )
    throw new Error("Invalid SDK session usage identity");
  return {
    sessionId: value.sessionId,
    resumed: value.resumed,
    ...(typeof value.resetId === "string" && { resetId: value.resetId }),
  };
}

export interface AppendSdkSessionUsageInput extends Omit<BuildSdkUsageLedgerEventsInput, "models"> {
  models: readonly ResolvedSdkRunBillingModel[];
  session: SdkSessionUsageContext;
}

const TOKEN_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const;

/** Persist cumulative checkpoints separately from billable deltas (SDK 0.3.277+).
 * A restored session without a checkpoint has unknown historical usage: record
 * the baseline and report the gap instead of charging the entire history again.
 */
export function buildSdkSessionUsageLedgerEvents(
  input: AppendSdkSessionUsageInput,
  existing: readonly UsageLedgerEvent[],
): { events: UsageLedgerEvent[]; warnings: string[] } {
  const checkpoints = existing
    .filter(
      (event) =>
        event.usageKind === "session_total" && event.metadata?.sdkSessionId === input.session.sessionId,
    )
    .sort(
      (left, right) =>
        Number(left.metadata?.sdkUsageSequence ?? 0) - Number(right.metadata?.sdkUsageSequence ?? 0),
    );
  if (checkpoints.some((event) => event.sourceEventId === input.requestKey))
    return { events: [], warnings: [] };
  const latest = checkpoints.at(-1);
  const epoch = input.session.resetId ?? latest?.metadata?.sdkUsageEpoch ?? "initial";
  const baseline = latest?.metadata?.sdkUsageEpoch === epoch ? latest : undefined;
  const previousModels = (baseline?.metadata?.sdkSessionModels ?? {}) as Record<
    string,
    { usage: ParsedUsage; cost?: number }
  >;
  const missingBaseline = input.session.resumed && !baseline;
  const warnings: string[] = missingBaseline ? ["sdk_session_usage_baseline_missing"] : [];
  const currentModels = { ...previousModels };
  const deltas: ResolvedSdkRunBillingModel[] = [];
  const previousCost = baseline?.reportedCostUsd;
  const costDelta = input.totalCostUsd === undefined ? undefined : input.totalCostUsd - (previousCost ?? 0);
  const snapshotUsage: ParsedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  for (const model of input.models) {
    // Keep the SDK model key: a public provider route can change on resume.
    const key = model.sdkModelId ?? model.modelId;
    const previous = previousModels[key];
    const usage: ParsedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
    let valid = true;
    for (const tokenKey of TOKEN_KEYS) {
      const current = model.usage[tokenKey];
      const delta = current - (previous?.usage[tokenKey] ?? 0);
      if (!Number.isFinite(current) || delta < 0) valid = false;
      usage[tokenKey] = delta;
      snapshotUsage[tokenKey] += current;
    }
    if (model.usage.reasoningTokens !== undefined) {
      usage.reasoningTokens = model.usage.reasoningTokens - (previous?.usage.reasoningTokens ?? 0);
      if (usage.reasoningTokens < 0) valid = false;
    }
    const currentCost = model.sdkCostUsd ?? (input.models.length === 1 ? input.totalCostUsd : undefined);
    const modelCostDelta = currentCost === undefined ? undefined : currentCost - (previous?.cost ?? 0);
    if (modelCostDelta !== undefined && (!Number.isFinite(modelCostDelta) || modelCostDelta < 0))
      valid = false;
    if (!valid) warnings.push(`sdk_session_usage_regressed:${key}`);
    currentModels[key] = { usage: model.usage, ...(currentCost !== undefined && { cost: currentCost }) };
    if (!missingBaseline)
      deltas.push({
        ...model,
        usage,
        computedBilling: computeRequestBilling(usage, model.actualRates, model.plannerRates),
        ...(modelCostDelta !== undefined && { sdkCostUsd: modelCostDelta }),
      });
  }
  if (costDelta !== undefined && (!Number.isFinite(costDelta) || costDelta < 0))
    warnings.push("sdk_session_cost_regressed");
  // A checkpoint is one coherent result. Never partially settle a regressed result.
  if (warnings.some((warning) => warning.includes("regressed"))) return { events: [], warnings };
  const { totalCostUsd: _cumulativeCost, ...baseInput } = input;
  const events = buildSdkUsageLedgerEvents({
    ...baseInput,
    models: deltas,
    ...(!missingBaseline && costDelta !== undefined && { totalCostUsd: costDelta }),
  });
  // A single checkpoint follows ALL model deltas. If any write fails, retry uses
  // the old baseline and the already-written deltas' idempotency keys.
  const snapshot = buildSingleUsageLedgerEvent({
    ...baseInput,
    source: "sdk",
    sourceEventId: input.requestKey,
    usageKind: "session_total",
    usage: snapshotUsage,
    ...(input.totalCostUsd !== undefined && { reportedCostUsd: input.totalCostUsd }),
    metadata: {
      ...input.metadata,
      sdkSessionId: input.session.sessionId,
      sdkUsageEpoch: epoch,
      sdkUsageSequence: Number(latest?.metadata?.sdkUsageSequence ?? 0) + 1,
      sdkSessionModels: currentModels,
      ...(missingBaseline && { billingGap: "sdk_session_usage_baseline_missing" }),
    },
  });
  return { events: [...events, snapshot], warnings };
}
