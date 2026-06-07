import type {
  AgentDomain,
  AgentTemplate,
  ModelRef,
  OrchestrationProfile,
  OrchestrationStrategy,
  ProviderConfigView,
  ToolPolicy,
  WorkflowStep,
} from "../shared/ipc";
import type { AgentConfigSource } from "../shared/agent-orchestration";
import { parseList } from "./agent-template-form";

export interface AgentProfileAgentFormState {
  agentKey: string;
  templateId: string;
  displayName: string;
  providerId: string;
  modelId: string;
  enabled: boolean;
  promptOverride: string;
  allowedTools: string;
  disallowedTools: string;
  mcpServers: string;
  skills: string;
}

export interface AgentProfileFormState {
  id: string;
  name: string;
  preset: AgentDomain;
  source: Extract<AgentConfigSource, "user" | "project">;
  mainName: string;
  mainProviderId: string;
  mainModelId: string;
  mainSystemPromptPreset: "claude_code" | "custom";
  mainPrompt: string;
  mainAllowedTools: string;
  mainDisallowedTools: string;
  mainSkills: string;
  strategyKind: OrchestrationStrategy["kind"];
  guidancePrompt: string;
  allowPlannerAdjustments: boolean;
  agents: AgentProfileAgentFormState[];
}

interface ProfileFormOptions {
  existingIds?: readonly string[];
  existingNames?: readonly string[];
  providers?: readonly ProviderConfigView[];
  templates?: readonly AgentTemplate[];
}

const RESERVED_AGENT_KEYS = new Set(["assistant", "main", "planner", "system", "thinking", "tool", "user"]);

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
    mainSystemPromptPreset: "custom",
    mainPrompt: "Coordinate the task and call specialized agents only when they materially improve the result.",
    mainAllowedTools: "Agent, Read, Glob, Grep, WebSearch, WebFetch, AskUserQuestion",
    mainDisallowedTools: "",
    mainSkills: "",
    strategyKind: "autonomous",
    guidancePrompt: "Choose agents autonomously based on the user's task and the available agent roster.",
    allowPlannerAdjustments: true,
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
    mainSystemPromptPreset: profile.mainAgent.systemPromptPreset,
    mainPrompt: profile.mainAgent.prompt,
    mainAllowedTools: formatList(profile.mainAgent.tools.allowed),
    mainDisallowedTools: formatList(profile.mainAgent.tools.disallowed),
    mainSkills: formatList(profile.mainAgent.skills),
    strategyKind: profile.strategy.kind,
    guidancePrompt: strategyGuidance(profile.strategy),
    allowPlannerAdjustments:
      profile.strategy.kind === "hybrid" ? profile.strategy.allowPlannerAdjustments : true,
    agents: profile.agents.map((agent) => ({
      agentKey: agent.agentKey,
      templateId: agent.templateId,
      displayName: agent.displayName ?? "",
      providerId: agent.modelRef.providerId,
      modelId: agent.modelRef.modelId,
      enabled: agent.enabled,
      promptOverride: agent.promptOverride ?? "",
      allowedTools: formatList(agent.tools.allowed),
      disallowedTools: formatList(agent.tools.disallowed),
      mcpServers: formatList(agent.mcpServers),
      skills: formatList(agent.skills),
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
    providerId: template.defaultModelRef?.providerId ?? options.provider?.id ?? "",
    modelId: template.defaultModelRef?.modelId ?? options.provider?.defaultModel ?? "",
    enabled: true,
    promptOverride: "",
    allowedTools: formatList(template.defaultTools.allowed),
    disallowedTools: formatList(template.defaultTools.disallowed),
    mcpServers: formatList(template.mcpServers),
    skills: formatList(template.skills),
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
  const mainModelRef = buildModelRef(form.mainProviderId, form.mainModelId, options.existing?.mainAgent.modelRef);
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
    return {
      agentKey,
      templateId: template.id,
      ...(agentForm.displayName.trim() ? { displayName: agentForm.displayName.trim() } : {}),
      modelRef: buildModelRef(agentForm.providerId, agentForm.modelId, existingAgent?.modelRef ?? template.defaultModelRef),
      tools: buildToolPolicyFromLists(
        existingAgent?.tools ?? template.defaultTools,
        agentForm.allowedTools,
        agentForm.disallowedTools,
      ),
      mcpServers: parseList(agentForm.mcpServers),
      skills: parseList(agentForm.skills),
      ...(agentForm.promptOverride.trim() ? { promptOverride: agentForm.promptOverride.trim() } : {}),
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
      tools: buildToolPolicyFromLists(
        options.existing?.mainAgent.tools ?? emptyToolPolicy(),
        form.mainAllowedTools,
        form.mainDisallowedTools,
      ),
      skills: parseList(form.mainSkills),
    },
    agents,
    strategy: buildStrategyFromForm(form, agents, options.existing?.strategy),
    version: Math.max(1, options.existing?.version ?? 1),
    updatedAt: options.nowIso ?? new Date().toISOString(),
    source: form.source,
    ...(options.existing?.sourceRouteProfileId && { sourceRouteProfileId: options.existing.sourceRouteProfileId }),
  };
}

export function canEditStoredAgentProfile(profile: OrchestrationProfile): boolean {
  return profile.source === "user" || profile.source === "project";
}

function buildStrategyFromForm(
  form: AgentProfileFormState,
  agents: readonly { agentKey: string; displayName?: string; enabled: boolean }[],
  existing?: OrchestrationStrategy,
): OrchestrationStrategy {
  if (form.strategyKind === "autonomous") {
    return {
      kind: "autonomous",
      ...(form.guidancePrompt.trim() ? { guidancePrompt: form.guidancePrompt.trim() } : {}),
    };
  }
  const steps = buildStepsFromAgents(agents, existing);
  if (steps.length === 0) {
    throw new Error("固定或混合编排至少需要启用一个子 Agent。");
  }
  if (form.strategyKind === "fixed") {
    return { kind: "fixed", steps };
  }
  return {
    kind: "hybrid",
    recommendedSteps: steps,
    allowPlannerAdjustments: form.allowPlannerAdjustments,
  };
}

function buildStepsFromAgents(
  agents: readonly { agentKey: string; displayName?: string; enabled: boolean }[],
  existing?: OrchestrationStrategy,
): WorkflowStep[] {
  const existingSteps =
    existing?.kind === "fixed"
      ? existing.steps
      : existing?.kind === "hybrid"
        ? existing.recommendedSteps
        : [];
  const existingByAgent = new Map(existingSteps.map((step) => [step.agentKey, step]));
  let previousId: string | undefined;
  return agents
    .filter((agent) => agent.enabled)
    .map((agent, index) => {
      const existingStep = existingByAgent.get(agent.agentKey);
      const id = sanitizeStepId(existingStep?.id ?? agent.agentKey);
      const step: WorkflowStep = {
        id,
        agentKey: agent.agentKey,
        promptTemplate:
          existingStep?.promptTemplate ??
          `Run the ${agent.displayName?.trim() || agent.agentKey} step for {{userPrompt}}.`,
        dependsOn: existingStep?.dependsOn ?? (previousId ? [previousId] : []),
        runMode: existingStep?.runMode ?? "sequential",
        required: existingStep?.required ?? true,
        outputKey: existingStep?.outputKey ?? `${id}_output`,
        failurePolicy: existingStep?.failurePolicy ?? (index === 0 ? "stop" : "ask_user"),
      };
      previousId = id;
      return step;
    });
}

function buildModelRef(providerId: string, modelId: string, existing?: ModelRef): ModelRef {
  const provider = providerId.trim();
  const model = modelId.trim();
  if (!provider || !model) {
    throw new Error("Agent Profile 中的每个 Agent 都必须配置 provider 和模型。");
  }
  return {
    ...(existing ?? {}),
    providerId: provider,
    modelId: model,
  };
}

function buildToolPolicyFromLists(base: ToolPolicy, allowedRaw: string, disallowedRaw: string): ToolPolicy {
  return {
    ...base,
    allowed: parseList(allowedRaw),
    disallowed: parseList(disallowedRaw),
  };
}

function emptyToolPolicy(): ToolPolicy {
  return { allowed: [], disallowed: [] };
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

function sanitizeStepId(value: string): string {
  return sanitizeAgentKey(value) || "step";
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

function strategyGuidance(strategy: OrchestrationStrategy): string {
  return strategy.kind === "autonomous" ? (strategy.guidancePrompt ?? "") : "";
}

function formatList(values: readonly string[] | undefined): string {
  return (values ?? []).join(", ");
}
