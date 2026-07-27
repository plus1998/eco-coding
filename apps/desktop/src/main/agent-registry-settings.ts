import type {
  AgentTemplate,
  MainAgentConfigResource,
  MainAgentPromptResource,
  ModelSettingsSnapshot,
  SubagentOrchestrationResource,
} from "../shared/ipc";

export interface AgentRegistrySettingsSource {
  listAgentTemplates(): AgentTemplate[];
  listMainAgentConfigs(): MainAgentConfigResource[];
  listMainAgentPrompts(): MainAgentPromptResource[];
  listSubagentOrchestrations(): SubagentOrchestrationResource[];
}

export function mergeAgentRegistrySettings(
  base: ModelSettingsSnapshot,
  registry: AgentRegistrySettingsSource,
): ModelSettingsSnapshot {
  return {
    ...base,
    agentTemplates: mergeUniqueById(base.agentTemplates, registry.listAgentTemplates()),
    mainAgentConfigs: registry.listMainAgentConfigs(),
    mainAgentPrompts: registry.listMainAgentPrompts(),
    subagentOrchestrations: registry.listSubagentOrchestrations(),
  };
}

function mergeUniqueById<T extends { id: string }>(protectedItems: T[], extensionItems: T[]): T[] {
  const protectedIds = new Set(protectedItems.map((item) => item.id));
  return [...protectedItems, ...extensionItems.filter((item) => !protectedIds.has(item.id))];
}
