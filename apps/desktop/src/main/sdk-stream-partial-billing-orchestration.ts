import type { RuntimeRoute } from "./billing-resolver";
import type { SdkStreamPartialUsageInput } from "./sdk-event-usage-billing";
import {
  resolveSdkStreamPartialBillingArtifacts,
  type UsageBillingPricingLookup,
} from "./usage-billing-artifacts";
import type { ApplySdkStreamPartialBillingEffectsInput } from "./usage-billing-effects";

export type SdkStreamPartialBillingRequest = SdkStreamPartialUsageInput;

export interface ResolveSdkStreamPartialBillingOrchestrationInput {
  request: SdkStreamPartialBillingRequest;
  runtimeRoutes: readonly RuntimeRoute[];
  lookupPricing: UsageBillingPricingLookup;
}

export interface SdkStreamPartialBillingOrchestration {
  effectsInput: ApplySdkStreamPartialBillingEffectsInput;
}

export async function resolveSdkStreamPartialBillingOrchestration(
  input: ResolveSdkStreamPartialBillingOrchestrationInput,
): Promise<SdkStreamPartialBillingOrchestration> {
  const { request } = input;
  const artifacts = await resolveSdkStreamPartialBillingArtifacts({
    threadId: request.threadId,
    eventId: request.eventId,
    role: request.role,
    usage: request.usage,
    runtimeRoutes: input.runtimeRoutes,
    lookupPricing: input.lookupPricing,
    ...(request.modelId && { modelId: request.modelId }),
    ...(request.runAttemptId && { runAttemptId: request.runAttemptId }),
    ...(request.plannerAgentId && { plannerAgentId: request.plannerAgentId }),
    ...(request.subagentAgentId && { subagentAgentId: request.subagentAgentId }),
    ...(request.parentToolUseId && { parentToolUseId: request.parentToolUseId }),
  });

  return {
    effectsInput: {
      threadId: request.threadId,
      usage: request.usage,
      artifacts,
      ...(request.subagentAgentId && { subagentAgentId: request.subagentAgentId }),
      ...(request.updateContext === false && { updateContext: false }),
    },
  };
}
