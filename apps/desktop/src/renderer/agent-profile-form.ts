import type { AgentConfigSource } from "../shared/agent-orchestration";
import type {
  AgentDomain,
  AgentTemplate,
  ModelRef,
  OrchestrationProfile,
  OrchestrationStrategy,
  ProviderConfigView,
  ToolPolicy,
  ThinkingEffort,
  UpstreamApiCompat,
} from "../shared/ipc";
import {
  emptyManualSpecForm,
  formToManualSpec,
  manualSpecToForm,
  type ManualSpecFormFields,
} from "./agent-profile-manual-spec-form";
import { formatList, parseList } from "./agent-template-form-utils";
import {
  capabilityFieldsToToolPolicy,
  createDefaultToolCapabilityFields,
  toolPolicyToCapabilityFields,
  type ToolCapabilityFieldValues,
} from "./tool-capability-groups";

export type AgentProfileAgentCapabilityFields = Omit<ToolCapabilityFieldValues, "allowDelegation">;

export interface AgentProfileAgentFormState extends AgentProfileAgentCapabilityFields {
  agentKey: string;
  templateId: string;
  displayName: string;
  providerId: string;
  modelId: string;
  thinkingEffort: string;
  modelsDevMappingProviderKey: string;
  modelsDevMappingModelId: string;
  manualSpec: ManualSpecFormFields;
  apiCompat: string;
  enabled: boolean;
}

export interface AgentProfileFormState {
  id: string;
  name: string;
  preset: AgentDomain;
  source: Extract<AgentConfigSource, "user" | "project">;
  mainName: string;
  mainProviderId: string;
  mainModelId: string;
  mainThinkingEffort: string;
  mainModelsDevMappingProviderKey: string;
  mainModelsDevMappingModelId: string;
  mainManualSpec: ManualSpecFormFields;
  mainApiCompat: string;
  mainSystemPromptPreset: "claude_code" | "custom";
  mainPrompt: string;
  mainReadCodebase: boolean;
  mainReadScope: ToolCapabilityFieldValues["readScope"];
  mainWriteCodebase: boolean;
  mainBash: boolean;
  mainBashCommandAllowlist: string;
  mainBashCommandDenylist: string;
  mainNetwork: boolean;
  mainSkill: boolean;
  mainAskUser: boolean;
  mainTaskProgress: boolean;
  mainAllowDelegation: boolean;
  mainAdvancedDisallowedTools: string;
  mainMcpServers: string;
  mainMcpTools: string;
  builtinExploreProviderId: string;
  builtinExploreModelId: string;
  builtinExploreThinkingEffort: string;
  builtinExploreModelsDevMappingProviderKey: string;
  builtinExploreModelsDevMappingModelId: string;
  builtinExploreManualSpec: ManualSpecFormFields;
  builtinExploreApiCompat: string;
  guidancePrompt: string;
  agents: AgentProfileAgentFormState[];
}

interface ProfileFormOptions {
  existingIds?: readonly string[];
  existingNames?: readonly string[];
  providers?: readonly ProviderConfigView[];
  templates?: readonly AgentTemplate[];
}

const RESERVED_AGENT_KEYS = new Set([
  "assistant",
  "eco_explore",
  "explore",
  "general-purpose",
  "main",
  "plan",
  "planner",
  "statusline-setup",
  "system",
  "thinking",
  "tool",
  "user",
]);

export function mainCapabilityFromProfileForm(form: AgentProfileFormState): ToolCapabilityFieldValues {
  return {
    readCodebase: form.mainReadCodebase,
    readScope: form.mainReadScope,
    writeCodebase: form.mainWriteCodebase,
    bash: form.mainBash,
    bashCommandAllowlist: form.mainBashCommandAllowlist,
    bashCommandDenylist: form.mainBashCommandDenylist,
    network: form.mainNetwork,
    skill: form.mainSkill,
    askUser: form.mainAskUser,
    taskProgress: form.mainTaskProgress,
    allowDelegation: form.mainAllowDelegation,
    advancedDisallowedTools: form.mainAdvancedDisallowedTools,
    mcpServers: form.mainMcpServers,
    mcpTools: form.mainMcpTools,
  };
}

export function agentCapabilityFromAgentForm(agent: AgentProfileAgentFormState): AgentProfileAgentCapabilityFields {
  return {
    readCodebase: agent.readCodebase,
    readScope: agent.readScope,
    writeCodebase: agent.writeCodebase,
    bash: agent.bash,
    bashCommandAllowlist: agent.bashCommandAllowlist,
    bashCommandDenylist: agent.bashCommandDenylist,
    network: agent.network,
    skill: agent.skill,
    askUser: agent.askUser,
    taskProgress: agent.taskProgress,
    advancedDisallowedTools: agent.advancedDisallowedTools,
    mcpServers: agent.mcpServers,
    mcpTools: agent.mcpTools,
  };
}

export function mainCapabilityPatchToProfileForm(
  patch: Partial<ToolCapabilityFieldValues>,
): Partial<AgentProfileFormState> {
  const result: Partial<AgentProfileFormState> = {};
  if (patch.readCodebase !== undefined) result.mainReadCodebase = patch.readCodebase;
  if (patch.readScope !== undefined) result.mainReadScope = patch.readScope;
  if (patch.writeCodebase !== undefined) result.mainWriteCodebase = patch.writeCodebase;
  if (patch.bash !== undefined) result.mainBash = patch.bash;
  if (patch.bashCommandAllowlist !== undefined) result.mainBashCommandAllowlist = patch.bashCommandAllowlist;
  if (patch.bashCommandDenylist !== undefined) result.mainBashCommandDenylist = patch.bashCommandDenylist;
  if (patch.network !== undefined) result.mainNetwork = patch.network;
  if (patch.skill !== undefined) result.mainSkill = patch.skill;
  if (patch.askUser !== undefined) result.mainAskUser = patch.askUser;
  if (patch.taskProgress !== undefined) result.mainTaskProgress = patch.taskProgress;
  if (patch.allowDelegation !== undefined) result.mainAllowDelegation = patch.allowDelegation;
  if (patch.advancedDisallowedTools !== undefined) {
    result.mainAdvancedDisallowedTools = patch.advancedDisallowedTools;
  }
  if (patch.mcpServers !== undefined) result.mainMcpServers = patch.mcpServers;
  if (patch.mcpTools !== undefined) result.mainMcpTools = patch.mcpTools;
  return result;
}

export function agentCapabilityPatchToAgentForm(
  patch: Partial<AgentProfileAgentCapabilityFields>,
): Partial<AgentProfileAgentFormState> {
  return patch;
}

export function createBlankAgentProfileForm(options: ProfileFormOptions = {}): AgentProfileFormState {
  const provider = selectDefaultProvider(options.providers ?? []);
  const mainCapability = createDefaultToolCapabilityFields({
    writeCodebase: true,
    bash: true,
    network: true,
    taskProgress: true,
    allowDelegation: true,
    askUser: true,
  });
  return {
    id: createUniqueProfileId("user.custom.profile", options.existingIds ?? []),
    name: createUniqueProfileName("Custom Agent Profile", options.existingNames ?? []),
    preset: "custom",
    source: "user",
    mainName: "Main Agent",
    mainProviderId: provider?.id ?? "",
    mainModelId: provider?.defaultModel ?? "",
    mainThinkingEffort: "",
    mainModelsDevMappingProviderKey: "",
    mainModelsDevMappingModelId: "",
    mainManualSpec: emptyManualSpecForm(),
    mainApiCompat: "",
    mainSystemPromptPreset: "claude_code",
    mainPrompt:
      "Coordinate the task and call specialized agents only when they materially improve the result.",
    ...mainCapabilityToProfileFormFields(mainCapability),
    builtinExploreProviderId: provider?.id ?? "",
    builtinExploreModelId: provider?.defaultModel ?? "",
    builtinExploreThinkingEffort: "",
    builtinExploreModelsDevMappingProviderKey: "",
    builtinExploreModelsDevMappingModelId: "",
    builtinExploreManualSpec: emptyManualSpecForm(),
    builtinExploreApiCompat: "",
    guidancePrompt: "Choose agents autonomously based on the user's task and the available agent roster.",
    agents: [],
  };
}

export function agentProfileToForm(profile: OrchestrationProfile): AgentProfileFormState {
  const mainCapability = toolPolicyToCapabilityFields(profile.mainAgent.tools, {
    allowDelegation: true,
    mcpServers: profile.mainAgent.tools.mcp?.allowedServers,
  });
  return {
    id: profile.id,
    name: profile.name,
    preset: profile.preset,
    source: profile.source === "project" ? "project" : "user",
    mainName: profile.mainAgent.name,
    mainProviderId: profile.mainAgent.modelRef.providerId,
    mainModelId: profile.mainAgent.modelRef.modelId,
    mainThinkingEffort: profile.mainAgent.modelRef.thinkingEffort ?? "",
    mainModelsDevMappingProviderKey: profile.mainAgent.modelRef.modelsDevMapping?.providerKey ?? "",
    mainModelsDevMappingModelId: profile.mainAgent.modelRef.modelsDevMapping?.modelId ?? "",
    mainManualSpec: manualSpecToForm(profile.mainAgent.modelRef.manualSpec),
    mainApiCompat: profile.mainAgent.modelRef.apiCompat ?? "",
    mainSystemPromptPreset: profile.mainAgent.systemPromptPreset,
    mainPrompt: profile.mainAgent.prompt,
    ...mainCapabilityToProfileFormFields(mainCapability),
    builtinExploreProviderId: profile.builtinAgents.explore.modelRef.providerId,
    builtinExploreModelId: profile.builtinAgents.explore.modelRef.modelId,
    builtinExploreThinkingEffort: profile.builtinAgents.explore.modelRef.thinkingEffort ?? "",
    builtinExploreModelsDevMappingProviderKey:
      profile.builtinAgents.explore.modelRef.modelsDevMapping?.providerKey ?? "",
    builtinExploreModelsDevMappingModelId:
      profile.builtinAgents.explore.modelRef.modelsDevMapping?.modelId ?? "",
    builtinExploreManualSpec: manualSpecToForm(profile.builtinAgents.explore.modelRef.manualSpec),
    builtinExploreApiCompat: profile.builtinAgents.explore.modelRef.apiCompat ?? "",
    guidancePrompt: profile.strategy.guidancePrompt ?? "",
    agents: profile.agents.map((agent) => ({
      agentKey: agent.agentKey,
      templateId: agent.templateId,
      displayName: agent.displayName ?? "",
      providerId: agent.modelRef.providerId,
      modelId: agent.modelRef.modelId,
      thinkingEffort: agent.modelRef.thinkingEffort ?? "",
      modelsDevMappingProviderKey: agent.modelRef.modelsDevMapping?.providerKey ?? "",
      modelsDevMappingModelId: agent.modelRef.modelsDevMapping?.modelId ?? "",
      manualSpec: manualSpecToForm(agent.modelRef.manualSpec),
      apiCompat: agent.modelRef.apiCompat ?? "",
      enabled: agent.enabled,
      ...agentCapabilityToAgentForm(
        toolPolicyToCapabilityFields(agent.tools, {
          mcpServers: agent.mcpServers,
        }),
      ),
    })),
  };
}

export function createCopiedAgentProfileForm(
  profile: OrchestrationProfile,
  options: ProfileFormOptions = {},
): AgentProfileFormState {
  const form = agentProfileToForm(profile);
  return {
    ...form,
    id: createUniqueProfileId(userProfileIdFrom(profile.id), options.existingIds ?? []),
    name: createUniqueProfileName(`${profile.name} Copy`, options.existingNames ?? []),
    source: "user",
  };
}

export function createProfileAgentFormFromTemplate(
  template: AgentTemplate,
  options: { provider?: ProviderConfigView; existingAgentKeys?: readonly string[] } = {},
): AgentProfileAgentFormState {
  const capability = toolPolicyToCapabilityFields(template.defaultTools, {
    mcpServers: template.mcpServers,
  });
  return {
    agentKey: createUniqueAgentKey(defaultAgentKeyFromTemplate(template), options.existingAgentKeys ?? []),
    templateId: template.id,
    displayName: template.name,
    providerId: options.provider?.id ?? "",
    modelId: options.provider?.defaultModel ?? "",
    thinkingEffort: "",
    modelsDevMappingProviderKey: "",
    modelsDevMappingModelId: "",
    manualSpec: emptyManualSpecForm(),
    apiCompat: "",
    enabled: true,
    ...agentCapabilityToAgentForm(capability),
  };
}

export function buildOrchestrationProfileFromForm(
  form: AgentProfileFormState,
  options: {
    existing?: OrchestrationProfile;
    templates: readonly AgentTemplate[];
    nowIso?: string;
  },
): OrchestrationProfile {
  const id = form.id.trim();
  const name = form.name.trim();
  if (!id) {
    throw new Error("Agent Profile id 不能为空。");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error("Agent Profile id 只能包含字母、数字、点、下划线和短横线。");
  }
  if (id.startsWith("builtin.")) {
    throw new Error("内置 Agent Profile id 不可用于用户配置。");
  }
  if (!name) {
    throw new Error("Agent Profile 名称不能为空。");
  }
  const mainModelRef = buildModelRef(
    form.mainProviderId,
    form.mainModelId,
    options.existing?.mainAgent.modelRef,
    {
      thinkingEffort: form.mainThinkingEffort,
      modelsDevMappingProviderKey: form.mainModelsDevMappingProviderKey,
      modelsDevMappingModelId: form.mainModelsDevMappingModelId,
      manualSpec: form.mainManualSpec,
      apiCompat: form.mainApiCompat,
    },
  );
  const builtinExploreModelRef = buildModelRef(
    form.builtinExploreProviderId,
    form.builtinExploreModelId,
    options.existing?.builtinAgents.explore.modelRef,
    {
      thinkingEffort: form.builtinExploreThinkingEffort,
      modelsDevMappingProviderKey: form.builtinExploreModelsDevMappingProviderKey,
      modelsDevMappingModelId: form.builtinExploreModelsDevMappingModelId,
      manualSpec: form.builtinExploreManualSpec,
      apiCompat: form.builtinExploreApiCompat,
    },
  );
  const templateById = new Map(options.templates.map((template) => [template.id, template]));
  const existingAgentByKey = new Map(options.existing?.agents.map((agent) => [agent.agentKey, agent]));
  const agentKeys = new Set<string>();
  const agents = form.agents.map((agentForm) => {
    const agentKey = normalizeAgentKey(agentForm.agentKey);
    if (agentKeys.has(agentKey)) {
      throw new Error(`Agent key 重复：${agentKey}`);
    }
    agentKeys.add(agentKey);
    const template = templateById.get(agentForm.templateId);
    if (!template) {
      throw new Error(`找不到 Agent 模板：${agentForm.templateId}`);
    }
    const existingAgent = existingAgentByKey.get(agentForm.agentKey.trim());
    const tools = capabilityFieldsToToolPolicy({
      ...agentCapabilityFromAgentForm(agentForm),
      allowDelegation: template.allowDelegation,
    });
    return {
      agentKey,
      templateId: template.id,
      displayName: agentForm.displayName.trim() || existingAgent?.displayName || template.name,
      modelRef: buildModelRef(agentForm.providerId, agentForm.modelId, existingAgent?.modelRef, {
        thinkingEffort: agentForm.thinkingEffort,
        modelsDevMappingProviderKey: agentForm.modelsDevMappingProviderKey,
        modelsDevMappingModelId: agentForm.modelsDevMappingModelId,
        manualSpec: agentForm.manualSpec,
        apiCompat: agentForm.apiCompat,
      }),
      tools,
      mcpServers: parseList(agentForm.mcpServers),
      skills: [],
      enabled: agentForm.enabled,
    };
  });

  return {
    id,
    name,
    preset: form.preset,
    mainAgent: {
      agentKey: "main",
      name: form.mainName.trim() || "Main Agent",
      domain: form.preset,
      systemPromptPreset: form.mainSystemPromptPreset,
      prompt: form.mainPrompt.trim() || "Coordinate the task and produce the final answer.",
      modelRef: mainModelRef,
      tools: capabilityFieldsToToolPolicy(mainCapabilityFromProfileForm(form)),
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: builtinExploreModelRef,
      },
    },
    agents,
    strategy: buildStrategyFromForm(form),
    version: Math.max(1, options.existing?.version ?? 1),
    updatedAt: options.nowIso ?? new Date().toISOString(),
    source: form.source,
    ...(options.existing?.sourceRouteProfileId && {
      sourceRouteProfileId: options.existing.sourceRouteProfileId,
    }),
  };
}

export function canEditStoredAgentProfile(profile: OrchestrationProfile): boolean {
  return profile.source === "user" || profile.source === "project";
}

function buildStrategyFromForm(
  form: AgentProfileFormState,
): OrchestrationStrategy {
  return {
    kind: "autonomous",
    ...(form.guidancePrompt.trim() ? { guidancePrompt: form.guidancePrompt.trim() } : {}),
  };
}


function agentCapabilityToAgentForm(
  capability: ToolCapabilityFieldValues,
): AgentProfileAgentCapabilityFields {
  return {
    readCodebase: capability.readCodebase,
    readScope: capability.readScope,
    writeCodebase: capability.writeCodebase,
    bash: capability.bash,
    bashCommandAllowlist: capability.bashCommandAllowlist,
    bashCommandDenylist: capability.bashCommandDenylist,
    network: capability.network,
    skill: capability.skill,
    askUser: capability.askUser,
    taskProgress: capability.taskProgress,
    advancedDisallowedTools: capability.advancedDisallowedTools,
    mcpServers: capability.mcpServers,
    mcpTools: capability.mcpTools,
  };
}

function mainCapabilityToProfileFormFields(
  capability: ToolCapabilityFieldValues,
): Pick<
  AgentProfileFormState,
  | "mainReadCodebase"
  | "mainReadScope"
  | "mainWriteCodebase"
  | "mainBash"
  | "mainBashCommandAllowlist"
  | "mainBashCommandDenylist"
  | "mainNetwork"
  | "mainSkill"
  | "mainAskUser"
  | "mainTaskProgress"
  | "mainAllowDelegation"
  | "mainAdvancedDisallowedTools"
  | "mainMcpServers"
  | "mainMcpTools"
> {
  return {
    mainReadCodebase: capability.readCodebase,
    mainReadScope: capability.readScope,
    mainWriteCodebase: capability.writeCodebase,
    mainBash: capability.bash,
    mainBashCommandAllowlist: capability.bashCommandAllowlist,
    mainBashCommandDenylist: capability.bashCommandDenylist,
    mainNetwork: capability.network,
    mainSkill: capability.skill,
    mainAskUser: capability.askUser,
    mainTaskProgress: capability.taskProgress,
    mainAllowDelegation: capability.allowDelegation,
    mainAdvancedDisallowedTools: capability.advancedDisallowedTools,
    mainMcpServers: capability.mcpServers,
    mainMcpTools: capability.mcpTools,
  };
}

function buildModelRef(
  providerId: string,
  modelId: string,
  _existing?: ModelRef,
  options?: {
    thinkingEffort?: string;
    modelsDevMappingProviderKey?: string;
    modelsDevMappingModelId?: string;
    manualSpec?: ManualSpecFormFields;
    apiCompat?: string;
  },
): ModelRef {
  const provider = providerId.trim();
  const model = modelId.trim();
  if (!provider || !model) {
    throw new Error("Agent Profile 中的每个 Agent 都必须配置 provider 和模型。");
  }
  const thinkingEffort = options?.thinkingEffort?.trim();
  const mappingProviderKey = options?.modelsDevMappingProviderKey?.trim();
  const mappingModelId = options?.modelsDevMappingModelId?.trim();
  const hasMapping = Boolean(mappingProviderKey && mappingModelId);
  const apiCompat = options?.apiCompat?.trim();
  const modelRef: ModelRef = {
    providerId: provider,
    modelId: model,
  };
  if (thinkingEffort) {
    modelRef.thinkingEffort = thinkingEffort as ThinkingEffort;
  }
  if (hasMapping) {
    modelRef.modelsDevMapping = {
      providerKey: mappingProviderKey as string,
      modelId: mappingModelId as string,
    };
  }
  if (apiCompat) {
    modelRef.apiCompat = apiCompat as UpstreamApiCompat;
  }
  const manualSpec = formToManualSpec(options?.manualSpec ?? emptyManualSpecForm(), { strict: true });
  if (manualSpec) {
    modelRef.manualSpec = manualSpec;
  }
  return modelRef;
}

export {
  formatManualTokenValue as formatManualContextTokens,
  tryFormToManualSpec,
} from "./agent-profile-manual-spec-form";

function normalizeAgentKey(raw: string): string {
  const agentKey = raw.trim();
  if (!agentKey) {
    throw new Error("Agent key 不能为空。");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentKey)) {
    throw new Error("Agent key 只能包含字母、数字、下划线和短横线，并且必须以字母开头。");
  }
  if (RESERVED_AGENT_KEYS.has(agentKey.toLowerCase())) {
    throw new Error(`Agent key ${agentKey} 是系统保留名称。`);
  }
  return agentKey;
}

function defaultAgentKeyFromTemplate(template: AgentTemplate): string {
  const last = template.id.split(".").pop() ?? template.name;
  return sanitizeAgentKey(last) || "agent";
}

function sanitizeAgentKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createUniqueAgentKey(base: string, existing: readonly string[]): string {
  const normalizedBase = sanitizeAgentKey(base) || "agent";
  const used = new Set(existing);
  if (!used.has(normalizedBase)) {
    return normalizedBase;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${normalizedBase}_${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function createUniqueProfileId(base: string, existing: readonly string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base}_${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function createUniqueProfileName(base: string, existing: readonly string[]): string {
  const used = new Set(existing);
  if (!used.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

function userProfileIdFrom(id: string): string {
  const cleaned = id
    .trim()
    .replace(/^builtin\./, "user.")
    .replace(/^derived\./, "user.")
    .replace(/[^a-zA-Z0-9._-]+/g, "_");
  return cleaned.startsWith("user.") ? cleaned : `user.${cleaned || "profile"}`;
}

function selectDefaultProvider(providers: readonly ProviderConfigView[]): ProviderConfigView | undefined {
  return (
    providers.find((provider) => provider.enabled && provider.defaultModel.trim()) ??
    providers.find((provider) => provider.defaultModel.trim())
  );
}
