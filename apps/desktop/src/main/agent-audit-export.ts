import type {
  AgentProfilePerformanceSnapshot,
  AgentTemplate,
  OrchestrationProfile,
  ThreadActivityLine,
  ThreadBillingSnapshot,
  ThreadRunProjectionSnapshot,
  ThreadSummary,
} from "../shared/ipc";
import type { AgentInstanceRecord, RunAttemptRecord, UsageLedgerEvent } from "./usage-ledger";

export const AGENT_AUDIT_EXPORT_SCHEMA = "eco.agent-audit.v1";

export interface AgentAuditExportProfileSummary {
  profileId: string;
  selectionId: string;
  name: string;
  preset: string;
  strategyKind: string;
  source: string;
}

export interface AgentAuditExportThreadRecord {
  thread: ThreadSummary;
  profile?: AgentAuditExportProfileSummary;
  billing?: ThreadBillingSnapshot;
  runProjection?: ThreadRunProjectionSnapshot;
  activity: ThreadActivityLine[];
  runAttempts: RunAttemptRecord[];
  agentInstances: AgentInstanceRecord[];
  usageLedgerEvents: UsageLedgerEvent[];
}

export interface AgentAuditExportArchive {
  schema: typeof AGENT_AUDIT_EXPORT_SCHEMA;
  exportedAt: string;
  appVersion?: string;
  summary: {
    threadCount: number;
    profileCount: number;
    agentTemplateCount: number;
  };
  profiles: OrchestrationProfile[];
  agentTemplates: AgentTemplate[];
  profilePerformance: AgentProfilePerformanceSnapshot[];
  threads: AgentAuditExportThreadRecord[];
}

export interface BuildAgentAuditExportArchiveInput {
  exportedAt?: string;
  appVersion?: string;
  threads: readonly ThreadSummary[];
  profiles: readonly OrchestrationProfile[];
  agentTemplates: readonly AgentTemplate[];
  profilePerformance: readonly AgentProfilePerformanceSnapshot[];
  getThreadBilling: (threadId: string) => ThreadBillingSnapshot | undefined;
  getThreadRunProjection: (threadId: string) => ThreadRunProjectionSnapshot | undefined;
  listThreadActivity: (threadId: string) => Promise<ThreadActivityLine[]>;
  listRunAttempts: (threadId: string) => RunAttemptRecord[];
  listAgentInstances: (threadId: string) => AgentInstanceRecord[];
  listUsageLedgerEvents: (threadId: string) => UsageLedgerEvent[];
}

export async function buildAgentAuditExportArchive(
  input: BuildAgentAuditExportArchiveInput,
): Promise<AgentAuditExportArchive> {
  const profileBySelectionId = new Map<string, OrchestrationProfile>(
    input.profiles.map((profile) => [profile.id, profile]),
  );

  const threads = await Promise.all(
    input.threads.map(async (thread) => {
      const billing = input.getThreadBilling(thread.id);
      const runProjection = input.getThreadRunProjection(thread.id);
      const profile = resolveThreadProfile(thread, profileBySelectionId);
      const record: AgentAuditExportThreadRecord = {
        thread,
        activity: await input.listThreadActivity(thread.id),
        runAttempts: input.listRunAttempts(thread.id),
        agentInstances: input.listAgentInstances(thread.id),
        usageLedgerEvents: input.listUsageLedgerEvents(thread.id),
      };
      if (profile) {
        record.profile = summarizeProfile(profile, thread.runtimeConfig?.routeProfileId);
      }
      if (billing) {
        record.billing = billing;
      }
      if (runProjection) {
        record.runProjection = runProjection;
      }
      return record;
    }),
  );

  return {
    schema: AGENT_AUDIT_EXPORT_SCHEMA,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    ...(input.appVersion && { appVersion: input.appVersion }),
    summary: {
      threadCount: threads.length,
      profileCount: input.profiles.length,
      agentTemplateCount: input.agentTemplates.length,
    },
    profiles: [...input.profiles],
    agentTemplates: [...input.agentTemplates],
    profilePerformance: [...input.profilePerformance],
    threads,
  };
}

function resolveThreadProfile(
  thread: ThreadSummary,
  profileBySelectionId: ReadonlyMap<string, OrchestrationProfile>,
): OrchestrationProfile | undefined {
  const selectionId =
    thread.runtimeConfig?.agentProfileId?.trim() || thread.runtimeConfig?.routeProfileId?.trim();
  return selectionId ? profileBySelectionId.get(selectionId) : undefined;
}

function summarizeProfile(
  profile: OrchestrationProfile,
  selectionId: string | undefined,
): AgentAuditExportProfileSummary {
  return {
    profileId: profile.id,
    selectionId: selectionId?.trim() || profile.id,
    name: profile.name,
    preset: profile.preset,
    strategyKind: profile.strategy.kind,
    source: profile.source,
  };
}
