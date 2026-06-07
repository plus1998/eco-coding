import type { AgentTemplate, ModelSettingsSnapshot, OrchestrationProfile } from "../shared/ipc";

export interface AgentRegistrySettingsSource {
  listAgentTemplates(): AgentTemplate[];
  listOrchestrationProfiles(): OrchestrationProfile[];
}

export function mergeAgentRegistrySettings(
  base: ModelSettingsSnapshot,
  registry: AgentRegistrySettingsSource,
): ModelSettingsSnapshot {
  return {
    ...base,
    agentTemplates: mergeUniqueById(base.agentTemplates, registry.listAgentTemplates()),
    orchestrationProfiles: mergeUniqueById(base.orchestrationProfiles, registry.listOrchestrationProfiles()),
  };
}

function mergeUniqueById<T extends { id: string }>(protectedItems: T[], extensionItems: T[]): T[] {
  const protectedIds = new Set(protectedItems.map((item) => item.id));
  return [...protectedItems, ...extensionItems.filter((item) => !protectedIds.has(item.id))];
}
