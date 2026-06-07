export type EcoAgentDomain = "coding" | "research" | "writing" | "product" | "data" | "ops" | "custom";
export type EcoAgentConfigSource = "built_in" | "user" | "project" | "derived";

export interface EcoModelRef {
  providerId: string;
  modelId: string;
  apiCompat?: string;
  thinkingEffort?: string;
}

export interface EcoToolPolicy {
  allowed: string[];
  disallowed: string[];
  mcp?: {
    allowedServers: string[];
    allowedTools: string[];
  };
}

export interface EcoAgentTemplateConfig {
  id: string;
  name: string;
  description: string;
  domain: EcoAgentDomain;
  prompt: string;
  whenToUse: string;
  outputContract?: string;
  defaultTools: EcoToolPolicy;
  defaultModelRef?: EcoModelRef;
  mcpServers: string[];
  skills: string[];
  allowDelegation: boolean;
  builtIn: boolean;
  source: EcoAgentConfigSource;
  version: number;
  updatedAt: string;
}

export interface EcoMainAgentConfig {
  agentKey: string;
  name: string;
  domain: EcoAgentDomain;
  systemPromptPreset: "claude_code" | "custom";
  prompt: string;
  modelRef: EcoModelRef;
  tools: EcoToolPolicy;
  skills: string[];
}

export interface EcoAgentInstanceConfig {
  agentKey: string;
  templateId: string;
  displayName?: string;
  modelRef: EcoModelRef;
  tools: EcoToolPolicy;
  mcpServers: string[];
  skills: string[];
  promptOverride?: string;
  enabled: boolean;
}

export type EcoOrchestrationStrategy =
  | { kind: "autonomous"; guidancePrompt?: string }
  | { kind: "hybrid"; recommendedSteps: EcoWorkflowStep[]; allowPlannerAdjustments: boolean }
  | { kind: "fixed"; steps: EcoWorkflowStep[]; finalAggregator?: EcoWorkflowStep };

export interface EcoWorkflowStep {
  id: string;
  agentKey: string;
  promptTemplate: string;
  dependsOn: string[];
  runMode: "sequential" | "parallel";
  required: boolean;
  outputKey: string;
  failurePolicy: "stop" | "retry" | "skip" | "ask_user";
}

export interface EcoOrchestrationProfileConfig {
  id: string;
  name: string;
  preset: EcoAgentDomain;
  mainAgent: EcoMainAgentConfig;
  agents: EcoAgentInstanceConfig[];
  strategy: EcoOrchestrationStrategy;
  version: number;
  updatedAt: string;
  source: EcoAgentConfigSource;
  sourceRouteProfileId?: string;
}

export interface EcoAgentRuntimeConfig {
  templates: EcoAgentTemplateConfig[];
  profile: EcoOrchestrationProfileConfig;
}

export interface EcoResolvedAgentDefinitionSet {
  definitions: Record<string, unknown>;
  agentKeys: string[];
}

export function createAgentDefinitionsFromProfile(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
): EcoResolvedAgentDefinitionSet {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const definitions: Record<string, unknown> = {};
  const agentKeys: string[] = [];
  for (const agent of profile.agents) {
    if (!agent.enabled) {
      continue;
    }
    const template = templateById.get(agent.templateId);
    if (!template) {
      throw new Error(`Missing agent template for ${agent.agentKey}: ${agent.templateId}`);
    }
    const sdkKey = sdkAgentKeyForProfileAgent(agent.agentKey);
    definitions[sdkKey] = buildSdkAgentDefinition(agent, template);
    agentKeys.push(sdkKey);
  }
  return { definitions, agentKeys };
}

export function buildMainAgentRoster(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
): string {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const lines = profile.agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const template = templateById.get(agent.templateId);
      if (!template) {
        return `- Agent(${sdkAgentKeyForProfileAgent(agent.agentKey)}): missing template ${agent.templateId}`;
      }
      const displayName = agent.displayName?.trim() || template.name;
      const output = template.outputContract?.trim() ? ` Output: ${template.outputContract.trim()}` : "";
      return [
        `- Agent(${sdkAgentKeyForProfileAgent(agent.agentKey)}): ${displayName} [${template.domain}]`,
        `  Description: ${template.description.trim()}`,
        `  Use when: ${template.whenToUse.trim()}.${output}`,
      ].join("\n");
    });
  if (lines.length === 0) {
    return "Available Eco subagents: none.";
  }
  return ["Available Eco subagents:", ...lines].join("\n");
}

export function buildMainAgentStrategySummary(profile: EcoOrchestrationProfileConfig): string {
  const strategy = profile.strategy;
  if (strategy.kind === "autonomous") {
    return [
      "Orchestration strategy: autonomous.",
      strategy.guidancePrompt?.trim() || "Choose subagents only when they materially improve the result.",
    ].join("\n");
  }
  if (strategy.kind === "fixed") {
    return [
      "Orchestration strategy: fixed.",
      ...strategy.steps.map((step) => `- ${step.id}: Agent(${sdkAgentKeyForProfileAgent(step.agentKey)})`),
    ].join("\n");
  }
  return [
    "Orchestration strategy: hybrid.",
    strategy.allowPlannerAdjustments
      ? "Recommended steps may be skipped, added, or reordered when justified."
      : "Follow recommended steps unless blocked.",
    ...strategy.recommendedSteps.map(
      (step) => `- ${step.id}: Agent(${sdkAgentKeyForProfileAgent(step.agentKey)})`,
    ),
  ].join("\n");
}

export function buildMainAgentProfileAppend(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
): string {
  return [
    `Eco orchestration profile: ${profile.name} (${profile.preset}).`,
    buildMainAgentStrategySummary(profile),
    buildMainAgentRoster(profile, templates),
  ].join("\n\n");
}

export function buildMainAgentSystemPrompt(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
  phaseAppend: string,
  options: { excludeDynamicSections?: boolean } = {},
): string | Record<string, unknown> {
  const append = [phaseAppend, buildMainAgentProfileAppend(profile, templates)]
    .filter((entry) => entry.trim())
    .join("\n\n");
  if (profile.mainAgent.systemPromptPreset === "custom") {
    return [profile.mainAgent.prompt.trim(), append].filter(Boolean).join("\n\n");
  }
  return {
    type: "preset",
    preset: "claude_code",
    append,
    ...(options.excludeDynamicSections ? { excludeDynamicSections: true } : {}),
  };
}

export function resolveMainAgentAllowedTools(
  profile: EcoOrchestrationProfileConfig,
  phaseAllowedTools: readonly string[],
): string[] {
  const tools =
    profile.preset === "coding"
      ? [...phaseAllowedTools, ...profile.mainAgent.tools.allowed]
      : profile.mainAgent.tools.allowed;
  return [...new Set(tools)];
}

export function sdkAgentKeyForProfileAgent(agentKey: string): string {
  const sanitized = agentKey
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!sanitized) {
    throw new Error("Agent key cannot be empty.");
  }
  return sanitized.startsWith("eco_") ? sanitized : `eco_${sanitized}`;
}

function buildSdkAgentDefinition(
  agent: EcoAgentInstanceConfig,
  template: EcoAgentTemplateConfig,
): Record<string, unknown> {
  const tools = agent.tools.allowed.length > 0 ? agent.tools.allowed : template.defaultTools.allowed;
  const disallowedTools =
    agent.tools.disallowed.length > 0 ? agent.tools.disallowed : template.defaultTools.disallowed;
  const skills = [...new Set([...template.skills, ...agent.skills])];
  const mcpServers = [...new Set([...template.mcpServers, ...agent.mcpServers])];
  return {
    description: buildAgentDescription(agent, template),
    ...(tools.length > 0 ? { tools } : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    prompt: agent.promptOverride?.trim() || template.prompt,
    model: requireModelId(agent.modelRef.modelId, agent.agentKey),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };
}

function buildAgentDescription(agent: EcoAgentInstanceConfig, template: EcoAgentTemplateConfig): string {
  const displayName = agent.displayName?.trim() || template.name;
  return [
    `${displayName}: ${template.description.trim()}`,
    `Use when: ${template.whenToUse.trim()}`,
    template.outputContract?.trim() ? `Output: ${template.outputContract.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function requireModelId(modelId: string | undefined, agentKey: string): string {
  const resolved = modelId?.trim();
  if (!resolved) {
    throw new Error(`Missing model id for ${agentKey} agent. Agents must use explicit models.`);
  }
  return resolved;
}
