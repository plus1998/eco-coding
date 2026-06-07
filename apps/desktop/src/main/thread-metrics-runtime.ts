import type { ParsedUsage } from "@eco/runtime";
import type { RuntimeAgentRole, ThreadContextSnapshot } from "../shared/ipc";
import type { ThreadMetricsRecord } from "./conversation-store";
import type { SerializedThreadUsageState } from "./thread-usage-accumulator";
import type { UsageContextUpdateMonitor } from "./usage-context-effects";

export interface PersistedThreadMetricsInput {
  accumulator?: SerializedThreadUsageState;
  context?: ThreadContextSnapshot;
}

export interface ThreadMetricsStore {
  listThreadMetrics(): readonly ThreadMetricsRecord[];
  listThreads(): readonly { id: string }[];
  saveThreadMetrics(threadId: string, input: PersistedThreadMetricsInput): void;
}

export interface ThreadMetricsUsageAccumulator {
  restoreState(threadId: string, data: SerializedThreadUsageState): void;
  serializeState(threadId: string): SerializedThreadUsageState | undefined;
}

export interface ThreadMetricsContextSnapshots {
  restoreSnapshot(threadId: string, snapshot: ThreadContextSnapshot): void;
  getDisplaySnapshot(threadId: string): ThreadContextSnapshot | undefined;
}

export interface ThreadMetricsSubagentEntry {
  agentId: string;
  role: RuntimeAgentRole;
  usage: ParsedUsage;
  contextOccupied: number;
  modelId?: string;
}

export interface ThreadMetricsSubagentRegistry {
  restoreFromStore(threadId: string): void;
  listEntries(threadId: string): readonly ThreadMetricsSubagentEntry[];
}

export interface RestoreThreadMetricsInput {
  store: Pick<ThreadMetricsStore, "listThreadMetrics">;
  accumulator: Pick<ThreadMetricsUsageAccumulator, "restoreState">;
  contextSnapshots: Pick<ThreadMetricsContextSnapshots, "restoreSnapshot">;
  subagentMetrics: ThreadMetricsSubagentRegistry;
  contextMonitor: UsageContextUpdateMonitor;
}

export interface PersistThreadMetricsInput {
  store: Pick<ThreadMetricsStore, "saveThreadMetrics">;
  accumulator: Pick<ThreadMetricsUsageAccumulator, "serializeState">;
  contextSnapshots: Pick<ThreadMetricsContextSnapshots, "getDisplaySnapshot">;
}

export interface FlushThreadMetricsInput extends PersistThreadMetricsInput {
  store: ThreadMetricsStore;
}

export function restoreThreadMetricsFromStore(input: RestoreThreadMetricsInput): void {
  for (const record of input.store.listThreadMetrics()) {
    if (record.accumulator) {
      input.accumulator.restoreState(record.threadId, record.accumulator);
    }
    if (record.context) {
      input.contextSnapshots.restoreSnapshot(record.threadId, record.context);
    }
    input.subagentMetrics.restoreFromStore(record.threadId);
    hydrateSubagentContextFromMetrics(input, record.threadId);
  }
}

export function buildPersistedThreadMetrics(
  input: Omit<PersistThreadMetricsInput, "store">,
  threadId: string,
): PersistedThreadMetricsInput {
  const accumulator = input.accumulator.serializeState(threadId);
  const context = input.contextSnapshots.getDisplaySnapshot(threadId);
  const metrics: PersistedThreadMetricsInput = {};
  if (accumulator) {
    metrics.accumulator = accumulator;
  }
  if (context) {
    metrics.context = context;
  }
  return metrics;
}

export function persistThreadMetrics(input: PersistThreadMetricsInput, threadId: string): void {
  input.store.saveThreadMetrics(threadId, buildPersistedThreadMetrics(input, threadId));
}

export function flushThreadMetrics(input: FlushThreadMetricsInput): void {
  const threadIds = new Set<string>();
  for (const record of input.store.listThreadMetrics()) {
    threadIds.add(record.threadId);
  }
  for (const thread of input.store.listThreads()) {
    threadIds.add(thread.id);
  }
  for (const threadId of threadIds) {
    if (
      input.accumulator.serializeState(threadId) ||
      input.contextSnapshots.getDisplaySnapshot(threadId)
    ) {
      persistThreadMetrics(input, threadId);
    }
  }
}

function hydrateSubagentContextFromMetrics(
  input: RestoreThreadMetricsInput,
  threadId: string,
): void {
  for (const entry of input.subagentMetrics.listEntries(threadId)) {
    if (entry.contextOccupied <= 0 && entry.usage.inputTokens <= 0) {
      continue;
    }
    void input.contextMonitor
      .updateFromUsage(threadId, entry.usage, {
        role: entry.role,
        agentId: entry.agentId,
        ...(entry.modelId && { modelId: entry.modelId }),
      })
      .catch(() => undefined);
  }
}
