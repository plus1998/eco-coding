import { ecoSubagentKeyForRole } from "./subagent-availability.js";

export type EcoAgentDomain = "coding" | "research" | "writing" | "product" | "data" | "ops" | "custom";
export type EcoAgentConfigSource = "built_in" | "user" | "project" | "derived";

export interface EcoModelRef {
  providerId: string;
  modelId: string;
  apiCompat?: string;
  thinkingEffort?: string;
}

export type EcoModelRequirementCapability = "reasoning" | "coding" | "long_context" | "vision" | "tool_use";

export interface EcoModelRequirements {
  capabilities: EcoModelRequirementCapability[];
  preferredLatency?: "fast" | "balanced" | "quality";
  minContextTokens?: number;
}

export interface EcoToolPolicy {
  allowed: string[];
  disallowed: string[];
  bash?: {
    enabled: boolean;
    approval: "always" | "risky" | "never";
    commandAllowlist?: string[];
    commandDenylist?: string[];
  };
  mcp?: {
    allowedServers: string[];
    allowedTools: string[];
  };
  filesystem?: {
    read: "workspace" | "extra_dirs" | "none";
    write: "workspace" | "none";
  };
  network?: {
    webSearch: boolean;
    webFetch: boolean;
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
  modelRequirements?: EcoModelRequirements;
  defaultTools: EcoToolPolicy;
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
  enabled: boolean;
}

export interface EcoBuiltinAgentConfig {
  modelRef: EcoModelRef;
}

export interface EcoBuiltinAgentsConfig {
  explore: EcoBuiltinAgentConfig;
}

export type EcoOrchestrationStrategy = { kind: "autonomous"; guidancePrompt?: string };

export interface EcoOrchestrationProfileConfig {
  id: string;
  name: string;
  preset: EcoAgentDomain;
  mainAgent: EcoMainAgentConfig;
  builtinAgents: EcoBuiltinAgentsConfig;
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

export interface EcoRuntimeToolPermissionEntry {
  allowed: string[];
  disallowed: string[];
  bash?: EcoToolPolicy["bash"];
  filesystem?: EcoToolPolicy["filesystem"];
  network?: EcoToolPolicy["network"];
}

export interface EcoRuntimeToolPermissionPolicy {
  main: EcoRuntimeToolPermissionEntry;
  agents: Record<string, EcoRuntimeToolPermissionEntry>;
}

export const SDK_SKILL_TOOL_NAME = "Skill";
export const SDK_FILESYSTEM_READ_TOOL_NAMES = ["Read", "Glob", "Grep", "LS", "NotebookRead"] as const;
export const SDK_FILESYSTEM_WRITE_TOOL_NAMES = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
export const SDK_DELEGATION_SUPPORT_TOOL_NAMES = ["TaskList", "TaskOutput"] as const;
export const SDK_TASK_PROGRESS_TOOL_NAMES = ["TaskCreate", "TaskUpdate", "TodoWrite"] as const;

const BUILTIN_EXPLORE_TOOL_POLICY: EcoToolPolicy = {
  allowed: ["Read", "Glob", "Grep"],
  disallowed: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

/** Read-only policy for Claude SDK built-in Plan subagent during native Plan Mode. */
export const BUILTIN_PLAN_TOOL_POLICY: EcoToolPolicy = {
  allowed: ["Read", "Glob", "Grep", SDK_SKILL_TOOL_NAME, "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash"],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

export function buildBuiltinPlanToolPermissionEntry(): EcoRuntimeToolPermissionEntry {
  return normalizeToolPermissionEntry(BUILTIN_PLAN_TOOL_POLICY);
}

export interface MainAgentHandsOnCapability {
  canEditFiles: boolean;
  canRunBash: boolean;
}

/**
 * What the main orchestrator can do hands-on under the active profile policy.
 * Mirrors the runtime PreToolUse enforcement: `filesystem.write === "none"` denies write
 * tools, a missing/disabled `bash` entry denies Bash, and bare-name disallow rules deny both.
 * No profile means no Eco policy hook, so the SDK permission mode alone governs.
 */
export function resolveMainAgentHandsOnCapability(
  profile?: EcoOrchestrationProfileConfig,
): MainAgentHandsOnCapability {
  if (!profile) {
    return { canEditFiles: true, canRunBash: true };
  }
  const tools = profile.mainAgent.tools;
  const disallowed = new Set(tools.disallowed.map((pattern) => pattern.trim()));
  const writeDisallowed = SDK_FILESYSTEM_WRITE_TOOL_NAMES.every((tool) => disallowed.has(tool));
  return {
    canEditFiles:
      !writeDisallowed && (tools.filesystem ? tools.filesystem.write !== "none" : true),
    canRunBash: !disallowed.has("Bash") && tools.bash?.enabled === true,
  };
}

export function createAgentDefinitionsFromProfile(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
  options: { agentSkills?: Partial<Record<string, string[]>> } = {},
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
    definitions[sdkKey] = buildSdkAgentDefinition(
      agent,
      template,
      resolveProfileAgentSkills(agent.agentKey, sdkKey, options),
    );
    agentKeys.push(sdkKey);
  }
  return { definitions, agentKeys };
}

export function buildToolPermissionPolicyFromProfile(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
  options: { agentKeys?: readonly string[]; mainAllowedTools?: readonly string[] } = {},
): EcoRuntimeToolPermissionPolicy {
  const explicitAgentKeys = options.agentKeys ? new Set(options.agentKeys) : undefined;
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const agents: Record<string, EcoRuntimeToolPermissionEntry> = {};
  const builtinExploreKey = ecoSubagentKeyForRole("explore");
  if (!explicitAgentKeys || explicitAgentKeys.has(builtinExploreKey)) {
    agents[builtinExploreKey] = normalizeToolPermissionEntry(BUILTIN_EXPLORE_TOOL_POLICY);
  }
  for (const agent of profile.agents) {
    if (!agent.enabled) {
      continue;
    }
    const sdkKey = sdkAgentKeyForProfileAgent(agent.agentKey);
    if (explicitAgentKeys && !explicitAgentKeys.has(sdkKey)) {
      continue;
    }
    const template = templateById.get(agent.templateId);
    if (!template) {
      throw new Error(`Missing agent template for ${agent.agentKey}: ${agent.templateId}`);
    }
    agents[sdkKey] = resolveAgentToolPermission(agent, template);
  }
  const cappedMainAllowedTools =
    options.mainAllowedTools && options.mainAllowedTools.length > 0 ? options.mainAllowedTools : undefined;
  const mainToolPolicy = cappedMainAllowedTools
    ? capMainAgentToolPolicyForPhase(profile.mainAgent.tools, cappedMainAllowedTools)
    : profile.mainAgent.tools;
  return {
    main: normalizeToolPermissionEntry(mainToolPolicy, [
      ...(cappedMainAllowedTools ? [] : (options.mainAllowedTools ?? [])),
      SDK_SKILL_TOOL_NAME,
      ...SDK_TASK_PROGRESS_TOOL_NAMES,
    ]),
    agents,
  };
}

export function buildMainAgentRoster(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
): string {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const lines = [
    [
      `- Agent(${ecoSubagentKeyForRole("explore")}): Explore [built-in]`,
      "  Description: Read-only codebase discovery for gathering context with the configured Explore model.",
      "  Use when: repository context or file discovery is needed before planning, answering, or implementing.",
    ].join("\n"),
    ...profile.agents
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
      }),
  ];
  if (lines.length === 0) {
    return "Available Eco subagents: none.";
  }
  return ["Available Eco subagents:", ...lines].join("\n");
}

export function buildMainAgentStrategySummary(profile: EcoOrchestrationProfileConfig): string {
  const strategy = profile.strategy;
  return [
    "Main-agent delegation guidance.",
    strategy.guidancePrompt?.trim() || "Choose subagents only when they materially improve the result.",
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
  const extras = [SDK_SKILL_TOOL_NAME, ...SDK_TASK_PROGRESS_TOOL_NAMES];
  const phaseExpanded = allowedToolPatternsFromPolicy(
    { allowed: [...phaseAllowedTools], disallowed: [] },
    extras,
  );
  const phaseToolSet = new Set(phaseExpanded);
  const phaseBlocksWrites = !hasAnyToolPattern(phaseToolSet, SDK_FILESYSTEM_WRITE_TOOL_NAMES);
  const phaseBlocksBash = !phaseToolSet.has("Bash");
  const profileExpanded = allowedToolPatternsFromPolicy(profile.mainAgent.tools, extras);
  const profileExtras = profileExpanded.filter((tool) => {
    if (phaseToolSet.has(tool)) {
      return false;
    }
    if (phaseBlocksWrites && hasAnyToolPattern(new Set([tool]), SDK_FILESYSTEM_WRITE_TOOL_NAMES)) {
      return false;
    }
    if (phaseBlocksBash && tool === "Bash") {
      return false;
    }
    return true;
  });
  return uniqueToolPatterns([...phaseExpanded, ...profileExtras]);
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
  extraSkills: readonly string[] = [],
): Record<string, unknown> {
  const toolPolicy = applyDelegationToolPolicy(
    resolveAgentToolPolicy(agent, template),
    template.allowDelegation,
  );
  const mcpServers = [
    ...new Set([...template.mcpServers, ...agent.mcpServers, ...(toolPolicy.mcp?.allowedServers ?? [])]),
  ];
  const skills = [...new Set([...template.skills, ...agent.skills, ...extraSkills])];
  const tools = allowedToolPatternsFromPolicy(toolPolicy, [
    ...mcpServers.map((server) => `mcp__${server}__*`),
    ...(skills.length > 0 ? [SDK_SKILL_TOOL_NAME] : []),
  ]);
  const disallowedTools = toolPolicy.disallowed;
  return {
    description: buildAgentDescription(agent, template),
    ...(tools.length > 0 ? { tools } : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    prompt: template.prompt,
    model: requireModelId(agent.modelRef.modelId, agent.agentKey),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };
}

function resolveProfileAgentSkills(
  agentKey: string,
  sdkKey: string,
  options: { agentSkills?: Partial<Record<string, string[]>> },
): string[] {
  const assignments = options.agentSkills;
  if (!assignments) {
    return [];
  }
  for (const key of [agentKey, sdkKey]) {
    const skills = assignments[key];
    if (skills && skills.length > 0) {
      return skills;
    }
  }
  return [];
}

function resolveAgentToolPermission(
  agent: EcoAgentInstanceConfig,
  template: EcoAgentTemplateConfig,
): EcoRuntimeToolPermissionEntry {
  const tools = applyDelegationToolPolicy(resolveAgentToolPolicy(agent, template), template.allowDelegation);
  const mcpServers = [
    ...new Set([...template.mcpServers, ...agent.mcpServers, ...(tools.mcp?.allowedServers ?? [])]),
  ];
  return normalizeToolPermissionEntry(tools, [
    ...mcpServers.map((server) => `mcp__${server}__*`),
    SDK_SKILL_TOOL_NAME,
  ]);
}

function normalizeToolPermissionEntry(
  policy: EcoToolPolicy,
  extraAllowed: readonly string[] = [],
): EcoRuntimeToolPermissionEntry {
  return {
    allowed: allowedToolPatternsFromPolicy(policy, extraAllowed),
    disallowed: uniqueToolPatterns(policy.disallowed),
    ...(policy.bash && {
      bash: {
        ...policy.bash,
        ...(policy.bash.commandAllowlist && {
          commandAllowlist: uniqueToolPatterns(policy.bash.commandAllowlist),
        }),
        ...(policy.bash.commandDenylist && {
          commandDenylist: uniqueToolPatterns(policy.bash.commandDenylist),
        }),
      },
    }),
    ...(policy.filesystem && { filesystem: { ...policy.filesystem } }),
    ...(policy.network && { network: { ...policy.network } }),
  };
}

function resolveAgentToolPolicy(
  agent: EcoAgentInstanceConfig,
  template: EcoAgentTemplateConfig,
): EcoToolPolicy {
  return agent.tools.allowed.length > 0 || agent.tools.disallowed.length > 0
    ? agent.tools
    : template.defaultTools;
}

function applyDelegationToolPolicy(policy: EcoToolPolicy, allowDelegation: boolean): EcoToolPolicy {
  if (allowDelegation) {
    return policy;
  }
  return {
    ...policy,
    allowed: policy.allowed.filter((tool) => !isDelegationToolPattern(tool)),
    disallowed: uniqueToolPatterns([
      ...policy.disallowed,
      "Agent",
      "Task",
      ...SDK_DELEGATION_SUPPORT_TOOL_NAMES,
    ]),
  };
}

function allowedToolPatternsFromPolicy(
  policy: EcoToolPolicy,
  extraAllowed: readonly string[] = [],
): string[] {
  const base = uniqueToolPatterns([
    ...policy.allowed,
    ...extraAllowed,
    ...(policy.mcp?.allowedTools ?? []),
    ...(policy.mcp?.allowedServers.map((server) => `mcp__${server}__*`) ?? []),
  ]);
  return uniqueToolPatterns([...base, ...relatedClaudeToolPatterns(base)]);
}

function uniqueToolPatterns(patterns: readonly string[]): string[] {
  return [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
}

function relatedClaudeToolPatterns(patterns: readonly string[]): string[] {
  const allowed = new Set(patterns);
  const related: string[] = [];
  if (hasAnyToolPattern(allowed, SDK_FILESYSTEM_READ_TOOL_NAMES)) {
    related.push("LS", "NotebookRead");
  }
  if (hasAnyToolPattern(allowed, SDK_FILESYSTEM_WRITE_TOOL_NAMES)) {
    related.push("MultiEdit", "NotebookEdit");
  }
  if (allowed.has("Agent") || allowed.has("Task")) {
    related.push(...SDK_DELEGATION_SUPPORT_TOOL_NAMES);
  }
  return related;
}

function hasAnyToolPattern(allowed: ReadonlySet<string>, tools: readonly string[]): boolean {
  return tools.some((tool) => allowed.has(tool));
}

function capMainAgentToolPolicyForPhase(
  base: EcoToolPolicy,
  mainAllowedTools: readonly string[],
): EcoToolPolicy {
  const allowedSet = new Set(mainAllowedTools);
  const filesystem = base.filesystem ?? { read: "workspace" as const, write: "workspace" as const };
  return {
    ...base,
    allowed: [...mainAllowedTools],
    ...(hasAnyToolPattern(allowedSet, SDK_FILESYSTEM_WRITE_TOOL_NAMES)
      ? { filesystem }
      : { filesystem: { ...filesystem, write: "none" as const } }),
    ...(base.bash && !allowedSet.has("Bash") ? { bash: { ...base.bash, enabled: false } } : {}),
    ...(base.network
      ? {
          network: {
            webSearch: allowedSet.has("WebSearch") && base.network.webSearch,
            webFetch: allowedSet.has("WebFetch") && base.network.webFetch,
          },
        }
      : {}),
  };
}

function isDelegationToolPattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  return (
    trimmed === "Agent" ||
    trimmed === "Task" ||
    trimmed === "TaskList" ||
    trimmed === "TaskOutput" ||
    trimmed.startsWith("Agent(") ||
    trimmed.startsWith("Task(")
  );
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
