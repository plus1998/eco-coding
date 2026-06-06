import type { UsageBillingObservation } from "./billing-orchestration";
import {
  resolveSdkEventUsageBilling,
  type SdkEventUsageBillingResolution,
  type SdkUsageEventLike,
} from "./sdk-event-usage-billing";
import type {
  SdkUsageBillingDispatchResult,
  SdkUsageBillingDispatchServices,
} from "./sdk-usage-billing-dispatch";
import type { SubagentUsageAttributionResolver } from "./subagent-usage-attribution";

export interface SdkUsageRecordedContextEventInput {
  threadId: string;
  eventId: string;
  payload: unknown;
}

export interface SdkUsageRecordedEventHandlerServices {
  handleContextEvent(input: SdkUsageRecordedContextEventInput): boolean;
  usageRunAttemptId(threadId: string): string | undefined;
  usagePlannerAgentId(threadId: string): string | undefined;
  listObservedAuthoritativeUsage(threadId: string): readonly UsageBillingObservation[] | undefined;
  resolver: SubagentUsageAttributionResolver;
  dispatchUsageBilling(input: {
    threadId: string;
    resolved: SdkEventUsageBillingResolution;
    services: SdkUsageBillingDispatchServices;
  }): SdkUsageBillingDispatchResult;
  dispatchServices: SdkUsageBillingDispatchServices;
}

export type SdkUsageRecordedEventHandlerResult =
  | { handled: "context" }
  | {
      handled: "usage";
      resolutionKind: SdkEventUsageBillingResolution["kind"];
      dispatch: SdkUsageBillingDispatchResult;
    };

export function handleSdkUsageRecordedEvent(input: {
  threadId: string;
  event: SdkUsageEventLike;
  services: SdkUsageRecordedEventHandlerServices;
}): SdkUsageRecordedEventHandlerResult {
  const { threadId, event, services } = input;
  if (
    services.handleContextEvent({
      threadId,
      eventId: event.id,
      payload: event.payload,
    })
  ) {
    return { handled: "context" };
  }

  const runAttemptId = services.usageRunAttemptId(threadId);
  const plannerAgentId = services.usagePlannerAgentId(threadId);
  const observedAuthoritativeUsage = services.listObservedAuthoritativeUsage(threadId);
  const resolved = resolveSdkEventUsageBilling({
    threadId,
    event,
    resolver: services.resolver,
    ...(runAttemptId && { runAttemptId }),
    ...(plannerAgentId && { plannerAgentId }),
    ...(observedAuthoritativeUsage && { observedAuthoritativeUsage }),
  });

  return {
    handled: "usage",
    resolutionKind: resolved.kind,
    dispatch: services.dispatchUsageBilling({
      threadId,
      resolved,
      services: services.dispatchServices,
    }),
  };
}
