import type { ModelSettingsSnapshot, ProviderDeleteReference, ThreadSummary } from "../shared/ipc";

const ACTIVE_THREAD_STATUSES = new Set<ThreadSummary["status"]>(["queued", "running"]);

export function collectProviderDeleteReferences(
  providerId: string,
  settings: ModelSettingsSnapshot,
  threads: readonly ThreadSummary[],
): ProviderDeleteReference[] {
  const targetId = providerId.trim();
  const references: ProviderDeleteReference[] = [];

  for (const config of settings.mainAgentConfigs) {
    if (config.modelRef.providerId === targetId) {
      references.push({
        kind: "main_agent_config",
        id: config.id,
        name: config.name,
      });
    }
  }

  for (const orchestration of settings.subagentOrchestrations) {
    if (orchestration.agents.some((agent) => agent.modelRef.providerId === targetId)) {
      references.push({
        kind: "subagent_orchestration",
        id: orchestration.id,
        name: orchestration.name,
      });
    }
  }

  for (const thread of threads) {
    if (!ACTIVE_THREAD_STATUSES.has(thread.status) || !threadReferencesProvider(thread, targetId)) {
      continue;
    }
    references.push({
      kind: "active_thread",
      id: thread.id,
      name: thread.title,
    });
  }

  return references;
}

function threadReferencesProvider(thread: ThreadSummary, providerId: string): boolean {
  const runtimeConfig = thread.runtimeConfig;
  if (!runtimeConfig) {
    return false;
  }
  if (runtimeConfig.mainAgentModelOverride?.providerId === providerId) {
    return true;
  }
  const snapshot = runtimeConfig.resolvedOrchestrationSnapshot;
  return Boolean(
    snapshot &&
      (snapshot.mainAgent.modelRef.providerId === providerId ||
        snapshot.agents.some((agent) => agent.modelRef.providerId === providerId)),
  );
}
