import type {
  SdkAssistantSubagentBillingInput,
  SdkEventUsageBillingResolution,
  SdkRunUsageBillingInput,
  SdkStreamPartialUsageInput,
} from "./sdk-event-usage-billing";
import type { SingleUsageBillingRequest } from "./single-usage-billing-orchestration";

export type SdkUsageBillingLoggableResolution = Extract<
  SdkEventUsageBillingResolution,
  { kind: "stream_partial" | "sdk_run" }
>;

export interface SdkUsageBillingDispatchServices {
  trackUsageUpdate(threadId: string, task: Promise<void>): void;
  processUsageBilling(input: SingleUsageBillingRequest): Promise<unknown>;
  processSdkStreamPartialUsage(input: SdkStreamPartialUsageInput): Promise<unknown>;
  processSdkRunBilling(input: SdkRunUsageBillingInput): Promise<unknown>;
  logResolution(threadId: string, resolved: SdkUsageBillingLoggableResolution): void;
  writeError(message: string): void;
}

export type SdkUsageBillingDispatchResult =
  | { dispatched: false; reason: "none" | "assistant_ignored" }
  | { dispatched: true; kind: "assistant_subagent" | "stream_partial" | "sdk_run" };

export function dispatchSdkEventUsageBilling(input: {
  threadId: string;
  resolved: SdkEventUsageBillingResolution;
  services: SdkUsageBillingDispatchServices;
}): SdkUsageBillingDispatchResult {
  const { threadId, resolved, services } = input;

  if (resolved.kind === "none" || resolved.kind === "assistant_ignored") {
    return { dispatched: false, reason: resolved.kind };
  }

  if (resolved.kind === "assistant_subagent") {
    services.trackUsageUpdate(
      threadId,
      services
        .processUsageBilling(resolved.billingInput)
        .then(() => undefined)
        .catch((error) => {
          services.writeError(`[eco] SDK assistant subagent billing failed: ${errorMessage(error)}\n`);
        }),
    );
    return { dispatched: true, kind: resolved.kind };
  }

  services.logResolution(threadId, resolved);

  if (resolved.kind === "stream_partial") {
    services.trackUsageUpdate(
      threadId,
      services
        .processSdkStreamPartialUsage(resolved.streamInput)
        .then(() => undefined)
        .catch((error) => {
          services.writeError(`[eco] SDK stream partial usage failed: ${errorMessage(error)}\n`);
        }),
    );
    return { dispatched: true, kind: resolved.kind };
  }

  services.trackUsageUpdate(
    threadId,
    services
      .processSdkRunBilling(resolved.runInput)
      .then(() => undefined)
      .catch((error) => {
        services.writeError(`[eco] SDK run billing failed: ${errorMessage(error)}\n`);
      }),
  );
  return { dispatched: true, kind: resolved.kind };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
