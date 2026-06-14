import type { AgentConfigSource } from "../shared/agent-orchestration";
import type {
  AgentDomain,
  AgentTemplate,
  ModelRef,
  OrchestrationProfile,
  OrchestrationStrategy,
  ProviderConfigView,
  RouteManualSpec,
  ToolPolicy,
  ThinkingEffort,
  UpstreamApiCompat,
} from "../shared/ipc";
import { parseList } from "./agent-template-form";

export interface AgentProfileAgentFormState {
  agentKey: string;
  templateId: string;
  displayName: string;
  providerId: string;
  modelId: string;
  thinkingEffort: string;
  modelsDevMappingProviderKey: string;
  modelsDevMappingModelId: string;
  manualContextTokens: string;
  enabled: boolean;
  disallowedTools: string;
  mcpServers: string;
  mcpTools: string;
  bashEnabled: boolean;
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  filesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  filesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  networkWebSearch: boolean;
  networkWebFetch: boolean;
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
  mainManualContextTokens: string;
  mainApiCompat: string;
  mainSystemPromptPreset: "claude_code" | "custom";
  mainPrompt: string;
  mainDisallowedTools: string;
  mainMcpServers: string;
  mainMcpTools: string;
  mainBashEnabled: boolean;
  mainBashCommandAllowlist: string;
  mainBashCommandDenylist: string;
  mainFilesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  mainFilesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  mainNetworkWebSearch: boolean;
  mainNetworkWebFetch: boolean;
  builtinExploreProviderId: string;
  builtinExploreModelId: string;
  builtinExploreThinkingEffort: string;
  builtinExploreModelsDevMappingProviderKey: string;
  builtinExploreModelsDevMappingModelId: string;
  builtinExploreManualContextTokens: string;
  guidancePrompt: string;
  agents: AgentProfileAgentFormState[];
}

interface ProfileFormOptions {
  existingIds?: readonly string[];
  existingNames?: readonly string[];
  providers?: readonly ProviderConfigView[];
  templates?: readonly AgentTemplate[];
}

interface ToolPolicyFormFields {
  mcpServers: string;
  mcpTools: string;
  bashEnabled: boolean;
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  filesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  filesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  networkWebSearch: boolean;
  networkWebFetch: boolean;
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

export function createBlankAgentProfileForm(options: ProfileFormOptions = {}): AgentProfileFormState {
  const provider = selectDefaultProvider(options.providers ?? []);
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
    mainManualContextTokens: "",
    mainApiCompat: "",
    mainSystemPromptPreset: "custom",
    mainPrompt:
      "Coordinate the task and call specialized agents only when they materially improve the result.",
    mainDisallowedTools: "",
    mainMcpServers: "",
    mainMcpTools: "",
    mainBashEnabled: true,
    mainBashCommandAllowlist: "",
    mainBashCommandDenylist: "",
    mainFilesystemRead: "workspace",
    mainFilesystemWrite: "workspace",
    mainNetworkWebSearch: true,
    mainNetworkWebFetch: true,
    builtinExploreProviderId: provider?.id ?? "",
    builtinExploreModelId: provider?.defaultModel ?? "",
    builtinExploreThinkingEffort: "",
    builtinExploreModelsDevMappingProviderKey: "",
    builtinExploreModelsDevMappingModelId: "",
    builtinExploreManualContextTokens: "",
    guidancePrompt: "Choose agents autonomously based on the user's task and the available agent roster.",
    agents: [],
  };
}

export function agentProfileToForm(profile: OrchestrationProfile): AgentProfileFormState {
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
    mainManualContextTokens: formatManualContextTokens(profile.mainAgent.modelRef.manualSpec?.contextTokens),
    mainApiCompat: profile.mainAgent.modelRef.apiCompat ?? "",
    mainSystemPromptPreset: profile.mainAgent.systemPromptPreset,
    mainPrompt: profile.mainAgent.prompt,
    mainDisallowedTools: formatList(profile.mainAgent.tools.disallowed),
    ...mainToolPolicyFormFields(profile.mainAgent.tools),
    builtinExploreProviderId: profile.builtinAgents.explore.modelRef.providerId,
    builtinExploreModelId: profile.builtinAgents.explore.modelRef.modelId,
    builtinExploreThinkingEffort: profile.builtinAgents.explore.modelRef.thinkingEffort ?? "",
    builtinExploreModelsDevMappingProviderKey:
      profile.builtinAgents.explore.modelRef.modelsDevMapping?.providerKey ?? "",
    builtinExploreModelsDevMappingModelId:
      profile.builtinAgents.explore.modelRef.modelsDevMapping?.modelId ?? "",
    builtinExploreManualContextTokens: formatManualContextTokens(
      profile.builtinAgents.explore.modelRef.manualSpec?.contextTokens,
    ),
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
      manualContextTokens: formatManualContextTokens(agent.modelRef.manualSpec?.contextTokens),
      enabled: agent.enabled,
      disallowedTools: formatList(agent.tools.disallowed),
      ...toolPolicyFormFields(agent.tools, agent.mcpServers),
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
  return {
    agentKey: createUniqueAgentKey(defaultAgentKeyFromTemplate(template), options.existingAgentKeys ?? []),
    templateId: template.id,
    displayName: template.name,
    providerId: options.provider?.id ?? "",
    modelId: options.provider?.defaultModel ?? "",
    thinkingEffort: "",
    modelsDevMappingProviderKey: "",
    modelsDevMappingModelId: "",
    manualContextTokens: "",
    enabled: true,
    disallowedTools: formatList(template.defaultTools.disallowed),
    ...toolPolicyFormFields(template.defaultTools, template.mcpServers),
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
      manualContextTokens: form.mainManualContextTokens,
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
      manualContextTokens: form.builtinExploreManualContextTokens,
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
    const sourceTools = existingAgent?.tools ?? template.defaultTools;
    const sourceMcpServers = existingAgent?.mcpServers ?? template.mcpServers;
    return {
      agentKey,
      templateId: template.id,
      displayName: existingAgent?.displayName ?? template.name,
      modelRef: buildModelRef(agentForm.providerId, agentForm.modelId, existingAgent?.modelRef, {
        thinkingEffort: agentForm.thinkingEffort,
        modelsDevMappingProviderKey: agentForm.modelsDevMappingProviderKey,
        modelsDevMappingModelId: agentForm.modelsDevMappingModelId,
        manualContextTokens: agentForm.manualContextTokens,
      }),
      tools: cloneToolPolicy(sourceTools),
      mcpServers: [...sourceMcpServers],
      skills: [],
      enabled: true,
    };
  });
  const sourceMainAgent = options.existing?.mainAgent;

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
      tools: buildToolPolicyFromFormFields(
        sourceMainAgent?.tools ?? emptyToolPolicy(),
        form.mainDisallowedTools,
        {
          mcpServers: form.mainMcpServers,
          mcpTools: form.mainMcpTools,
          bashEnabled: form.mainBashEnabled,
          bashCommandAllowlist: form.mainBashCommandAllowlist,
          bashCommandDenylist: form.mainBashCommandDenylist,
          filesystemRead: form.mainFilesystemRead,
          filesystemWrite: form.mainFilesystemWrite,
          networkWebSearch: form.mainNetworkWebSearch,
          networkWebFetch: form.mainNetworkWebFetch,
        },
      ),
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

function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
  return structuredClone(policy) as ToolPolicy;
}

function buildStrategyFromForm(
  form: AgentProfileFormState,
): OrchestrationStrategy {
  return {
    kind: "autonomous",
    ...(form.guidancePrompt.trim() ? { guidancePrompt: form.guidancePrompt.trim() } : {}),
  };
}

export function formatManualContextTokens(value?: number): string {
  return value !== undefined && value > 0 ? String(value) : "";
}

export function parseManualContextTokensInput(value: string): number | undefined {
  const trimmed = value.trim().replace(/[_,\s]/g, "");
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("手动上下文上限必须是正整数。");
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("手动上下文上限必须是正整数。");
  }
  return parsed;
}

/** Lenient parse for live capability lookup while the user is editing. */
export function tryParseManualContextTokens(value: string): number | undefined {
  const trimmed = value.trim().replace(/[_,\s]/g, "");
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function buildModelRef(
  providerId: string,
  modelId: string,
  existing?: ModelRef,
  options?: {
    thinkingEffort?: string;
    modelsDevMappingProviderKey?: string;
    modelsDevMappingModelId?: string;
    manualContextTokens?: string;
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
  const manualSpec = mergeManualSpec(
    parseManualContextTokensInput(options?.manualContextTokens ?? ""),
    existing?.manualSpec,
  );
  if (manualSpec) {
    modelRef.manualSpec = manualSpec;
  }
  return modelRef;
}

function mergeManualSpec(
  contextTokens: number | undefined,
  existing?: RouteManualSpec,
): RouteManualSpec | undefined {
  const next: RouteManualSpec = {
    ...(existing?.inputPerM !== undefined && { inputPerM: existing.inputPerM }),
    ...(existing?.outputPerM !== undefined && { outputPerM: existing.outputPerM }),
    ...(existing?.cacheReadPerM !== undefined && { cacheReadPerM: existing.cacheReadPerM }),
    ...(existing?.cacheWritePerM !== undefined && { cacheWritePerM: existing.cacheWritePerM }),
    ...(contextTokens !== undefined && { contextTokens }),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function emptyToolPolicy(): ToolPolicy {
  return { allowed: [], disallowed: [] };
}

function mainToolPolicyFormFields(
  policy: ToolPolicy,
): Pick<
  AgentProfileFormState,
  | "mainMcpServers"
  | "mainMcpTools"
  | "mainBashEnabled"
  | "mainBashCommandAllowlist"
  | "mainBashCommandDenylist"
  | "mainFilesystemRead"
  | "mainFilesystemWrite"
  | "mainNetworkWebSearch"
  | "mainNetworkWebFetch"
> {
  const fields = toolPolicyFormFields(policy);
  return {
    mainMcpServers: fields.mcpServers,
    mainMcpTools: fields.mcpTools,
    mainBashEnabled: fields.bashEnabled,
    mainBashCommandAllowlist: fields.bashCommandAllowlist,
    mainBashCommandDenylist: fields.bashCommandDenylist,
    mainFilesystemRead: fields.filesystemRead,
    mainFilesystemWrite: fields.filesystemWrite,
    mainNetworkWebSearch: fields.networkWebSearch,
    mainNetworkWebFetch: fields.networkWebFetch,
  };
}

function toolPolicyFormFields(policy: ToolPolicy, mcpServers: readonly string[] = []): ToolPolicyFormFields {
  const disallowed = new Set(policy.disallowed);
  return {
    mcpServers: formatList(mcpServers.length > 0 ? mcpServers : (policy.mcp?.allowedServers ?? [])),
    mcpTools: formatList(policy.mcp?.allowedTools ?? []),
    bashEnabled: policy.bash?.enabled === true && !disallowed.has("Bash"),
    bashCommandAllowlist: formatList(policy.bash?.commandAllowlist ?? []),
    bashCommandDenylist: formatList(policy.bash?.commandDenylist ?? []),
    filesystemRead: policy.filesystem?.read ?? "workspace",
    filesystemWrite: policy.filesystem?.write ?? "none",
    networkWebSearch: policy.network?.webSearch ?? false,
    networkWebFetch: policy.network?.webFetch ?? false,
  };
}

function buildToolPolicyFromFormFields(
  _base: ToolPolicy,
  disallowedRaw: string,
  fields: ToolPolicyFormFields,
): ToolPolicy {
  const disallowed = parseList(disallowedRaw);
  const mcpServers = parseList(fields.mcpServers);
  const mcpTools = parseList(fields.mcpTools);
  return {
    allowed: [],
    disallowed,
    ...(fields.bashEnabled && !disallowed.includes("Bash")
      ? {
          bash: {
            enabled: true,
            ...(parseList(fields.bashCommandAllowlist).length > 0
              ? { commandAllowlist: parseList(fields.bashCommandAllowlist) }
              : {}),
            ...(parseList(fields.bashCommandDenylist).length > 0
              ? { commandDenylist: parseList(fields.bashCommandDenylist) }
              : {}),
          },
        }
      : {}),
    ...(mcpServers.length > 0 || mcpTools.length > 0
      ? { mcp: { allowedServers: mcpServers, allowedTools: mcpTools } }
      : {}),
    filesystem: {
      read: fields.filesystemRead,
      write: fields.filesystemWrite,
    },
    network: {
      webSearch: fields.networkWebSearch,
      webFetch: fields.networkWebFetch,
    },
  };
}

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

function formatList(values: readonly string[] | undefined): string {
  return (values ?? []).join(", ");
}
