import type {
  AgentTemplate,
  MainAgentConfigResource,
  MainAgentPromptResource,
  ModelSettingsSnapshot,
  ProviderConfigView,
  SubagentOrchestrationResource,
} from "../shared/ipc";

export interface AgentRegistrySettingsSource {
  listAgentTemplates(): AgentTemplate[];
  listMainAgentConfigs(): MainAgentConfigResource[];
  listMainAgentPrompts(): MainAgentPromptResource[];
  listSubagentOrchestrations(): SubagentOrchestrationResource[];
}

/** Virtual built-in main agent config for OpenAI official subscription. */
const OPENAI_OFFICIAL_MAIN_AGENT_CONFIG: MainAgentConfigResource = {
  id: "__openai_official__",
  name: "OpenAI Official",
  agentKey: "openai-official",
  modelRef: { providerId: "openai", modelId: "gpt-5.6-sol" },
  tools: { allowed: [], disallowed: [] },
  skills: [],
  v4aTeachingEnabled: false,
  updatedAt: "",
  source: "built_in",
};

/** Virtual built-in provider for OpenAI official subscription (auth.json). */
const OPENAI_OFFICIAL_PROVIDER: ProviderConfigView = {
  id: "openai",
  name: "OpenAI",
  baseUrl: "",
  requestPath: "/v1",
  version: "v1",
  apiCompat: "openai_responses",
  defaultModel: "gpt-5.6-sol",
  enabled: true,
  hasApiKey: false,
  authMethod: "auth_json",
};

export function mergeAgentRegistrySettings(
  base: ModelSettingsSnapshot,
  registry: AgentRegistrySettingsSource,
  options?: { openAiAccountActive?: boolean },
): ModelSettingsSnapshot {
  const mainAgentConfigs = registry.listMainAgentConfigs();
  const withOpenAiOfficial = options?.openAiAccountActive
    ? [OPENAI_OFFICIAL_MAIN_AGENT_CONFIG, ...mainAgentConfigs]
    : mainAgentConfigs;
  const providersWithOpenAi = options?.openAiAccountActive && !base.providers.some((p) => p.id === "openai")
    ? [OPENAI_OFFICIAL_PROVIDER, ...base.providers]
    : base.providers;
  return {
    ...base,
    providers: providersWithOpenAi,
    agentTemplates: mergeUniqueById(base.agentTemplates, registry.listAgentTemplates()),
    mainAgentConfigs: withOpenAiOfficial,
    mainAgentPrompts: registry.listMainAgentPrompts(),
    subagentOrchestrations: registry.listSubagentOrchestrations(),
  };
}

function mergeUniqueById<T extends { id: string }>(protectedItems: T[], extensionItems: T[]): T[] {
  const protectedIds = new Set(protectedItems.map((item) => item.id));
  return [...protectedItems, ...extensionItems.filter((item) => !protectedIds.has(item.id))];
}
