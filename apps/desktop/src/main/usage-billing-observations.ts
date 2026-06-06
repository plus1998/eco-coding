import type { UsageBillingObservation } from "./billing-orchestration";

export function usageBillingObservationKey(observation: UsageBillingObservation): string {
  return JSON.stringify([
    observation.source,
    observation.role,
    observation.agentId ?? "unknown-agent",
    observation.requestKey ?? "unknown-request",
    observation.modelId ?? "unknown-model",
    observation.usage.inputTokens,
    observation.usage.outputTokens,
    observation.usage.cacheReadTokens,
    observation.usage.cacheCreationTokens,
  ]);
}

export function appendUsageBillingObservation(
  observations: UsageBillingObservation[],
  observation: UsageBillingObservation,
): boolean {
  const key = usageBillingObservationKey(observation);
  if (observations.some((entry) => usageBillingObservationKey(entry) === key)) {
    return false;
  }
  observations.push(observation);
  return true;
}
