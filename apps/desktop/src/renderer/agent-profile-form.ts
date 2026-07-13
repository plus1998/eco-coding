import {
  type AgentConfigSource,
  CODING_AGENT_TEMPLATE_IDS,
  createBuiltInAgentTemplates,
  listOrchestrationProfileAgents,
} from "../shared/agent-orchestration";
import type {
  AgentDomain,
  AgentTemplate,
  ModelRef,
  OrchestrationProfile,
  OrchestrationStrategy,
  ProviderConfigView,
  ThinkingEffort,
  UpstreamApiCompat,
} from "../shared/ipc";
import { defaultThemeColorForAgentKey, normalizeThemeColorHex } from "../shared/subagent-theme";
import { parseList } from "./agent-template-form-utils";
import {
  capabilityFieldsToToolPolicy,
  createDefaultToolCapabilityFields,
  type ToolCapabilityFieldValues,
  toolPolicyToCapabilityFields,
} from "./tool-capability-groups";

export type AgentProfileAgentCapabilityFields = Omit<ToolCapabilityFieldValues, "allowDelegation">;

export interface AgentProfileAgentFormState extends AgentProfileAgentCapabilityFields {
  agentKey: string;
  templateId: string;
  displayName: string;
  themeColor: string;
  providerId: string;
  modelId: string;
  thinkingEffort: string;
  apiCompat: string;
  enabled: boolean;
  candidateModelId: string;
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
  mainApiCompat: string;
  mainCandidateModelId: string;
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

export function agentCapabilityFromAgentForm(
  agent: AgentProfileAgentFormState,
): AgentProfileAgentCapabilityFields {
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
  const templates = [...(options.templates ?? []), ...createBuiltInAgentTemplates()];
  const exploreTemplate = templates.find((template) => template.id === CODING_AGENT_TEMPLATE_IDS.explore);
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
    name: createUniqueProfileName("自定义智能体配置", options.existingNames ?? []),
    preset: "custom",
    source: "user",
    mainName: "Main Agent",
    mainProviderId: provider?.id ?? "",
    mainModelId: provider?.defaultModel ?? "",
    mainThinkingEffort: "",
    mainApiCompat: "",
    mainCandidateModelId: "",
    mainSystemPromptPreset: "claude_code",
    mainPrompt:
      "Coordinate the task and call specialized agents only when they materially improve the result.",
    ...mainCapabilityToProfileFormFields(mainCapability),
    guidancePrompt: "Choose agents autonomously based on the user's task and the available agent roster.",
    agents: exploreTemplate
      ? [createProfileAgentFormFromTemplate(exploreTemplate, { ...(provider && { provider }) })]
      : [],
  };
}

export function agentProfileToForm(profile: OrchestrationProfile): AgentProfileFormState {
  const mainCapability = toolPolicyToCapabilityFields(profile.mainAgent.tools, {
    allowDelegation: true,
    ...(profile.mainAgent.tools.mcp?.allowedServers
      ? { mcpServers: profile.mainAgent.tools.mcp.allowedServers }
      : {}),
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
    mainApiCompat: profile.mainAgent.modelRef.apiCompat ?? "",
    mainCandidateModelId: profile.mainAgent.modelRef.candidateModelId ?? "",
    mainSystemPromptPreset: profile.mainAgent.systemPromptPreset,
    mainPrompt: profile.mainAgent.prompt,
    ...mainCapabilityToProfileFormFields(mainCapability),
    guidancePrompt: profile.strategy.guidancePrompt ?? "",
    agents: listOrchestrationProfileAgents(profile).map((agent) => ({
      agentKey: agent.agentKey,
      templateId: agent.templateId,
      displayName: agent.displayName ?? "",
      themeColor: agent.themeColor ?? defaultThemeColorForAgentKey(agent.agentKey),
      providerId: agent.modelRef.providerId,
      modelId: agent.modelRef.modelId,
      thinkingEffort: agent.modelRef.thinkingEffort ?? "",
      apiCompat: agent.modelRef.apiCompat ?? "",
      enabled: agent.enabled,
      candidateModelId: agent.modelRef.candidateModelId ?? "",
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
    themeColor: defaultThemeColorForAgentKey(defaultAgentKeyFromTemplate(template)),
    providerId: options.provider?.id ?? "",
    modelId: options.provider?.defaultModel ?? "",
    thinkingEffort: "",
    apiCompat: "",
    enabled: true,
    candidateModelId: "",
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
    throw new Error("智能体配置 id 不能为空。");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error("智能体配置 id 只能包含字母、数字、点、下划线和短横线。");
  }
  if (id.startsWith("builtin.")) {
    throw new Error("内置智能体配置 id 不可用于用户配置。");
  }
  if (!name) {
    throw new Error("智能体配置名称不能为空。");
  }
  assertCandidateModelSelected("主 Agent", form.mainCandidateModelId);
  const mainModelRef = buildModelRef(form.mainProviderId, form.mainModelId, {
    thinkingEffort: form.mainThinkingEffort,
    apiCompat: form.mainApiCompat,
    candidateModelId: form.mainCandidateModelId,
  });
  const templateById = new Map(
    [...options.templates, ...createBuiltInAgentTemplates()].map((template) => [template.id, template]),
  );
  const existingAgentByKey = new Map(options.existing?.agents.map((agent) => [agent.agentKey, agent]));
  const agentKeys = new Set<string>();
  const agents = form.agents.map((agentForm) => {
    const agentKey = normalizeAgentKey(
      agentForm.agentKey,
      agentForm.templateId === CODING_AGENT_TEMPLATE_IDS.explore,
    );
    if (agentKeys.has(agentKey)) {
      throw new Error(`Agent key 重复：${agentKey}`);
    }
    agentKeys.add(agentKey);
    const template = templateById.get(agentForm.templateId);
    if (!template) {
      throw new Error(`找不到 Agent 模板：${agentForm.templateId}`);
    }
    const existingAgent = existingAgentByKey.get(agentForm.agentKey.trim());
    const displayName = agentForm.displayName.trim() || existingAgent?.displayName || template.name;
    if (agentForm.enabled) {
      assertCandidateModelSelected(displayName, agentForm.candidateModelId);
    }
    const themeColor = resolveStoredThemeColor(
      displayName,
      agentForm.themeColor,
      defaultThemeColorForAgentKey(agentKey),
    );
    const tools = capabilityFieldsToToolPolicy({
      ...agentCapabilityFromAgentForm(agentForm),
      allowDelegation: template.allowDelegation,
    });
    return {
      agentKey,
      templateId: template.id,
      displayName,
      ...(themeColor && { themeColor }),
      modelRef: buildModelRef(agentForm.providerId, agentForm.modelId, {
        thinkingEffort: agentForm.thinkingEffort,
        apiCompat: agentForm.apiCompat,
        candidateModelId: agentForm.candidateModelId,
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
    agents,
    strategy: buildStrategyFromForm(form),
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

function buildStrategyFromForm(form: AgentProfileFormState): OrchestrationStrategy {
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

function assertCandidateModelSelected(label: string, candidateModelId: string): void {
  if (!candidateModelId.trim()) {
    throw new Error(`${label} 必须选择候选模型。`);
  }
}

function resolveStoredThemeColor(label: string, value: string, defaultColor: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toUpperCase() === defaultColor.toUpperCase()) {
    return undefined;
  }
  try {
    return normalizeThemeColorHex(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} ${message}`);
  }
}

function buildModelRef(
  providerId: string,
  modelId: string,
  options?: {
    thinkingEffort?: string;
    apiCompat?: string;
    candidateModelId?: string;
  },
): ModelRef {
  const provider = providerId.trim();
  const model = modelId.trim();
  if (!provider || !model) {
    throw new Error("智能体配置中的每个 Agent 都必须配置 provider 和模型。");
  }
  const thinkingEffort = options?.thinkingEffort?.trim();
  const apiCompat = options?.apiCompat?.trim();
  const candidateModelId = options?.candidateModelId?.trim();
  const modelRef: ModelRef = {
    providerId: provider,
    modelId: model,
  };
  if (thinkingEffort) {
    modelRef.thinkingEffort = thinkingEffort as ThinkingEffort;
  }
  if (apiCompat) {
    modelRef.apiCompat = apiCompat as UpstreamApiCompat;
  }
  if (candidateModelId) {
    modelRef.candidateModelId = candidateModelId;
  }
  return modelRef;
}

export { tryFormToManualSpec } from "./agent-profile-manual-spec-form";

function normalizeAgentKey(raw: string, allowExplore = false): string {
  const agentKey = raw.trim();
  if (!agentKey) {
    throw new Error("Agent key 不能为空。");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentKey)) {
    throw new Error("Agent key 只能包含字母、数字、下划线和短横线，并且必须以字母开头。");
  }
  if (RESERVED_AGENT_KEYS.has(agentKey.toLowerCase()) && !(allowExplore && agentKey === "explore")) {
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
