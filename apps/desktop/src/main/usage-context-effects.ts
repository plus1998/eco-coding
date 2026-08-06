import type { ParsedUsage } from "@eco/runtime";
import type { ContextWindowMonitor } from "./context-window-monitor";
import type { UsageBillingContextUpdate } from "./usage-billing-artifacts";

export type UsageContextUpdateOptions = NonNullable<
  Parameters<ContextWindowMonitor["updateFromUsage"]>[2]
>;

export interface UsageContextUpdateMonitor {
  updateFromUsage: ContextWindowMonitor["updateFromUsage"];
  updateOccupied: ContextWindowMonitor["updateOccupied"];
}

export interface UsageContextMonitor
  extends UsageContextUpdateMonitor,
    Pick<ContextWindowMonitor, "getSnapshot"> {}

export interface UsageContextService {
  applyUpdate(input: ApplyUsageContextUpdateInput): Promise<boolean>;
  getSnapshot: ContextWindowMonitor["getSnapshot"];
  emitLive(threadId: string): void;
}

export interface CreateUsageContextServiceInput {
  monitor: UsageContextMonitor;
  emitLiveContext(threadId: string): void;
}

export interface BuildUsageContextUpdateOptionsInput {
  agentId?: string;
  messageId?: string;
}

export interface ApplyUsageContextUpdateInput {
  threadId: string;
  usage: ParsedUsage;
  contextUpdate?: UsageBillingContextUpdate;
  updateContext?: boolean;
  agentId?: string;
  messageId?: string;
}

export function buildUsageContextUpdateOptions(
  contextUpdate: UsageBillingContextUpdate,
  input: BuildUsageContextUpdateOptionsInput = {},
): UsageContextUpdateOptions {
  return {
    role: contextUpdate.role,
    ...(input.agentId && { agentId: input.agentId }),
    modelId: contextUpdate.modelId,
    providerBaseUrl: contextUpdate.providerBaseUrl,
    ...(contextUpdate.modelsDevMapping && { modelsDevMapping: contextUpdate.modelsDevMapping }),
    ...(contextUpdate.manualSpec && { manualSpec: contextUpdate.manualSpec }),
    ...(input.messageId && { messageId: input.messageId }),
  };
}

export async function applyUsageContextUpdate(
  monitor: UsageContextUpdateMonitor,
  input: ApplyUsageContextUpdateInput,
): Promise<boolean> {
  if (input.updateContext === false || !input.contextUpdate) {
    return false;
  }
  await monitor.updateFromUsage(
    input.threadId,
    input.usage,
    buildUsageContextUpdateOptions(input.contextUpdate, {
      ...(input.agentId && { agentId: input.agentId }),
      ...(input.messageId && { messageId: input.messageId }),
    }),
  );
  return true;
}

export function createUsageContextService(
  input: CreateUsageContextServiceInput,
): UsageContextService {
  return {
    applyUpdate: (update) => applyUsageContextUpdate(input.monitor, update),
    getSnapshot: (threadId) => input.monitor.getSnapshot(threadId),
    emitLive: (threadId) => input.emitLiveContext(threadId),
  };
}
