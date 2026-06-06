import type { AgentRole } from "../shared/ipc";
import {
  type SubagentMetricsPersistenceStore,
  subagentMetricsEntryFromPersistenceRecord,
  subagentMetricsEntryToPersistenceInput,
} from "./subagent-metrics-persistence";
import type { SubagentMetricsEntry } from "./subagent-metrics-state";

export interface RestoredSubagentUsageContribution {
  agentId: string;
  role: AgentRole;
  requestKey: string;
  modelId?: string;
}

export interface RestoredSubagentMetricsEntry {
  entry: SubagentMetricsEntry;
  legacyUsageContribution?: RestoredSubagentUsageContribution;
}

export interface SubagentMetricsRegistryPersistence {
  restoreThread(threadId: string): RestoredSubagentMetricsEntry[];
  persistEntry(threadId: string, entry: SubagentMetricsEntry): void;
  clearThread(threadId: string): void;
}

export class SubagentMetricsStoreFacade implements SubagentMetricsRegistryPersistence {
  constructor(private readonly store: SubagentMetricsPersistenceStore) {}

  restoreThread(threadId: string): RestoredSubagentMetricsEntry[] {
    return this.store.listSubagentMetrics(threadId).map((row) => {
      const entry = subagentMetricsEntryFromPersistenceRecord(row);
      return {
        entry,
        ...(row.lastRequestKey && {
          legacyUsageContribution: {
            agentId: row.agentId,
            role: row.role,
            requestKey: row.lastRequestKey,
            ...(entry.modelId && { modelId: entry.modelId }),
          },
        }),
      };
    });
  }

  persistEntry(threadId: string, entry: SubagentMetricsEntry): void {
    this.store.upsertSubagentMetrics(threadId, subagentMetricsEntryToPersistenceInput(entry));
  }

  clearThread(threadId: string): void {
    this.store.clearSubagentMetrics(threadId);
  }
}
