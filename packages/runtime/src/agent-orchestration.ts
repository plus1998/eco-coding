import {
  ecoSubagentKeyForRole,
  SDK_GENERAL_PURPOSE_AGENT_KEY,
  SDK_PLAN_AGENT_KEY,
} from "./subagent-availability.js";
import { normalizeSdkSubagentType } from "./subagent-resume.js";
import {
  SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_FILESYSTEM_READ_TOOL_NAMES,
  SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  SDK_TASK_PROGRESS_TOOL_NAMES,
} from "./sdk-tool-names.js";
import {
  capEcoToolPolicyForPhase,
  materializeEcoToolPolicy,
  resolveMainAgentHandsOnFromPolicy,
} from "./tool-permission-policy.js";

export {
  SDK_DELEGATION_SUPPORT_TOOL_NAMES,
  SDK_FILESYSTEM_READ_TOOL_NAMES,
  SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  SDK_SKILL_TOOL_NAME,
  SDK_TASK_PROGRESS_TOOL_NAMES,
} from "./sdk-tool-names.js";

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
  themeColor?: string;
  modelRef: EcoModelRef;
  tools: EcoToolPolicy;
  mcpServers: string[];
  skills: string[];
  enabled: boolean;
}

export interface EcoBuiltinAgentConfig {
  modelRef: EcoModelRef;
  themeColor?: string;
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
  /** Sanitized MCP server names assigned to this actor; any tool from these servers is allowed. */
  mcpServers: string[];
  bash?: EcoToolPolicy["bash"];
  filesystem?: EcoToolPolicy["filesystem"];
  network?: EcoToolPolicy["network"];
}

export function sanitizeMcpServerName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "mcp-server";
}

export function parseMcpToolServerName(toolName: string): string | undefined {
  if (!toolName.startsWith("mcp__")) {
    return undefined;
  }
  const rest = toolName.slice(5);
  const separatorIndex = rest.indexOf("__");
  if (separatorIndex <= 0) {
    return undefined;
  }
  return rest.slice(0, separatorIndex);
}

export function mcpAutoApprovePatternsForServers(servers: readonly string[]): string[] {
  return uniqueToolPatterns(servers.map((server) => `mcp__${sanitizeMcpServerName(server)}__*`));
}

export function resolveAssignedMcpServers(
  policy: EcoToolPolicy,
  extraServerNames: readonly string[] = [],
): string[] {
  const fromTools = (policy.mcp?.allowedTools ?? [])
    .map((pattern) => parseMcpToolServerName(pattern))
    .filter((server): server is string => Boolean(server));
  const servers = [...(policy.mcp?.allowedServers ?? []), ...fromTools, ...extraServerNames];
  return [...new Set(servers.map((server) => sanitizeMcpServerName(server)).filter(Boolean))];
}

export function resolveEffectiveBashPolicy(
  policy: EcoToolPolicy,
): NonNullable<EcoToolPolicy["bash"]> {
  const disallowed = new Set(policy.disallowed.map((entry) => entry.trim()));
  const bashLists = {
    ...(policy.bash?.commandAllowlist && { commandAllowlist: [...policy.bash.commandAllowlist] }),
    ...(policy.bash?.commandDenylist && { commandDenylist: [...policy.bash.commandDenylist] }),
  };

  if (disallowed.has("Bash") || policy.bash?.enabled === false) {
    return { enabled: false, ...bashLists };
  }

  return { enabled: true, ...bashLists };
}

export function collectProfileAssignedMcpServers(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
): string[] {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const servers = new Set<string>();

  for (const server of resolveAssignedMcpServers(profile.mainAgent.tools)) {
    servers.add(server);
  }

  for (const agent of profile.agents) {
    if (!agent.enabled) {
      continue;
    }
    for (const server of resolveAssignedMcpServers(agent.tools, agent.mcpServers)) {
      servers.add(server);
    }
    const template = templateById.get(agent.templateId);
    if (template) {
      for (const server of template.mcpServers.map((name) => sanitizeMcpServerName(name))) {
        servers.add(server);
      }
    }
  }

  return [...servers];
}

export interface EcoRuntimeToolPermissionPolicy {
  main: EcoRuntimeToolPermissionEntry;
  agents: Record<string, EcoRuntimeToolPermissionEntry>;
}

const EXPLORE_DISALLOWED_TOOLS = [
  "Agent",
  "Task",
  "TaskList",
  "TaskOutput",
  "Skill",
  "Bash",
  ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
  "WebSearch",
  "WebFetch",
  "AskUserQuestion",
  ...SDK_TASK_PROGRESS_TOOL_NAMES,
] as const;

const BUILTIN_EXPLORE_TOOL_POLICY: EcoToolPolicy = {
  allowed: [],
  disallowed: [...EXPLORE_DISALLOWED_TOOLS],
  bash: { enabled: false },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

/** Read-only policy for Claude SDK built-in Plan subagent during native Plan Mode. */
export const BUILTIN_PLAN_TOOL_POLICY: EcoToolPolicy = {
  allowed: [],
  disallowed: [
    "Agent",
    "Task",
    "TaskList",
    "TaskOutput",
    "Bash",
    ...SDK_FILESYSTEM_WRITE_TOOL_NAMES,
    ...SDK_TASK_PROGRESS_TOOL_NAMES,
    "AskUserQuestion",
  ],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

export function buildBuiltinPlanToolPermissionEntry(): EcoRuntimeToolPermissionEntry {
  return normalizeToolPermissionEntry(BUILTIN_PLAN_TOOL_POLICY);
}

type SdkBuiltinToolPolicyRule = "inherit_main" | "plan_readonly";

/** Allowed SDK built-in subagents that need explicit tool policy resolution (not Profile-generated). */
const SDK_BUILTIN_TOOL_POLICY_RULES: Record<string, SdkBuiltinToolPolicyRule> = {
  [SDK_GENERAL_PURPOSE_AGENT_KEY]: "inherit_main",
  [SDK_PLAN_AGENT_KEY]: "plan_readonly",
};

function resolveEcoAgentToolPermissionEntry(
  policy: EcoRuntimeToolPermissionPolicy,
  actor: string,
): EcoRuntimeToolPermissionEntry | undefined {
  const directEntry = policy.agents[actor];
  if (directEntry) {
    return directEntry;
  }
  if (!actor.startsWith("eco_")) {
    const dynamicEntry = policy.agents[`eco_${actor}`];
    if (dynamicEntry) {
      return dynamicEntry;
    }
  }
  const normalizedRole = normalizeSdkSubagentType(actor);
  return normalizedRole ? policy.agents[`eco_${normalizedRole}`] : undefined;
}

export function resolveToolPermissionEntryForActor(
  policy: EcoRuntimeToolPermissionPolicy,
  actor: "main" | string,
): EcoRuntimeToolPermissionEntry | undefined {
  if (actor === "main") {
    return policy.main;
  }

  const ecoEntry = resolveEcoAgentToolPermissionEntry(policy, actor);
  if (ecoEntry) {
    return ecoEntry;
  }

  const rule = SDK_BUILTIN_TOOL_POLICY_RULES[actor];
  if (rule === "inherit_main") {
    return policy.main;
  }
  if (rule === "plan_readonly") {
    return buildBuiltinPlanToolPermissionEntry();
  }

  return undefined;
}

export interface MainAgentHandsOnCapability {
  canEditFiles: boolean;
  canRunBash: boolean;
}

/**
 * What the main orchestrator can do hands-on under the active profile tool policy.
 * Mirrors PreToolUse enforcement: only explicit disallow rules or structured flags apply.
 */
export function resolveMainAgentHandsOnCapability(
  profile?: EcoOrchestrationProfileConfig,
): MainAgentHandsOnCapability {
  if (!profile) {
    return { canEditFiles: true, canRunBash: true };
  }
  return resolveMainAgentHandsOnFromPolicy(profile.mainAgent.tools);
}

export function createAgentDefinitionsFromProfile(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
  options: {
    agentSkills?: Partial<Record<string, string[]>>;
    /**
     * Maps a profile agent's raw model id to the id the SDK should request (e.g. the local
     * proxy role alias), so usage billing can attribute requests to the right agent role.
     */
    resolveModelId?: (agentKey: string, modelId: string) => string;
  } = {},
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
      options.resolveModelId,
    );
    agentKeys.push(sdkKey);
  }
  return { definitions, agentKeys };
}

export function buildToolPermissionPolicyFromProfile(
  profile: EcoOrchestrationProfileConfig,
  templates: readonly EcoAgentTemplateConfig[],
  options: {
    agentKeys?: readonly string[];
    /** Phase read-only cap list (plan/question). Not the merged SDK auto-approve list. */
    phaseAllowedTools?: readonly string[];
    mainAllowedTools?: readonly string[];
    /** Composer/runtime MCP selection merged into main agent MCP allowlist. */
    runtimeMcpServers?: readonly string[];
  } = {},
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
  const phaseCapTools =
    options.phaseAllowedTools && options.phaseAllowedTools.length > 0
      ? options.phaseAllowedTools
      : undefined;
  const mainToolPolicy = phaseCapTools
    ? capEcoToolPolicyForPhase(profile.mainAgent.tools, phaseCapTools)
    : materializeEcoToolPolicy(profile.mainAgent.tools);
  const runtimeMcp = (options.runtimeMcpServers ?? []).map((server) => sanitizeMcpServerName(server));
  const mainAssignedMcp = [
    ...new Set([...resolveAssignedMcpServers(mainToolPolicy), ...runtimeMcp]),
  ];
  return {
    main: normalizeToolPermissionEntry(
      mainToolPolicy,
      resolveMainToolPermissionExtraAllowed(phaseCapTools, options.mainAllowedTools),
      mainAssignedMcp,
    ),
    agents,
  };
}

function resolveMainToolPermissionExtraAllowed(
  phaseAllowedTools: readonly string[] | undefined,
  mainAllowedTools: readonly string[] | undefined,
): string[] {
  const extras = [SDK_SKILL_TOOL_NAME, ...SDK_TASK_PROGRESS_TOOL_NAMES];
  if (!phaseAllowedTools) {
    return [...(mainAllowedTools ?? []), ...extras];
  }
  const phaseAllowed = new Set(phaseAllowedTools);
  return extras.filter((tool) => phaseAllowed.has(tool));
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
  _templates: readonly EcoAgentTemplateConfig[],
): string {
  return [
    `Eco orchestration profile: ${profile.name} (${profile.preset}).`,
    buildMainAgentStrategySummary(profile),
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
  const mainMcpAutoApprove = mcpAutoApprovePatternsForServers(
    resolveAssignedMcpServers(profile.mainAgent.tools),
  );
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
  return uniqueToolPatterns([...phaseExpanded, ...profileExtras, ...mainMcpAutoApprove]);
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
  sessionSkills: readonly string[] = [],
  resolveModelId?: (agentKey: string, modelId: string) => string,
): Record<string, unknown> {
  const toolPolicy = materializeEcoToolPolicy(
    applyDelegationToolPolicy(resolveAgentToolPolicy(agent, template), template.allowDelegation),
  );
  const mcpServers = resolveAssignedMcpServers(toolPolicy, [...template.mcpServers, ...agent.mcpServers]);
  const tools =
    toolPolicy.allowed.length > 0 ? allowedToolPatternsFromPolicy(toolPolicy) : [];
  const disallowedTools = toolPolicy.disallowed;
  const skills = sessionSkills.length > 0 ? [...sessionSkills] : [];
  return {
    description: buildAgentDescription(agent, template),
    ...(tools.length > 0 ? { tools } : {}),
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
    prompt: template.prompt,
    model: resolveModelId
      ? resolveModelId(agent.agentKey, requireModelId(agent.modelRef.modelId, agent.agentKey))
      : requireModelId(agent.modelRef.modelId, agent.agentKey),
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
  return normalizeToolPermissionEntry(
    tools,
    [SDK_SKILL_TOOL_NAME],
    resolveAssignedMcpServers(tools, [...template.mcpServers, ...agent.mcpServers]),
  );
}

function normalizeToolPermissionEntry(
  policy: EcoToolPolicy,
  extraAllowed: readonly string[] = [],
  assignedMcpServers: readonly string[] = [],
): EcoRuntimeToolPermissionEntry {
  const materialized = materializeEcoToolPolicy(policy);
  const effectiveBash = resolveEffectiveBashPolicy(materialized);
  return {
    allowed: allowedToolPatternsFromPolicy(materialized, extraAllowed),
    disallowed: uniqueToolPatterns(materialized.disallowed),
    mcpServers: resolveAssignedMcpServers(policy, assignedMcpServers),
    bash: {
      ...effectiveBash,
      ...(effectiveBash.commandAllowlist && {
        commandAllowlist: uniqueToolPatterns(effectiveBash.commandAllowlist),
      }),
      ...(effectiveBash.commandDenylist && {
        commandDenylist: uniqueToolPatterns(effectiveBash.commandDenylist),
      }),
    },
    ...(materialized.filesystem && { filesystem: { ...materialized.filesystem } }),
    ...(materialized.network && { network: { ...materialized.network } }),
  };
}

function hasConfiguredToolPolicy(policy: EcoToolPolicy): boolean {
  return (
    policy.allowed.length > 0 ||
    policy.disallowed.length > 0 ||
    policy.bash !== undefined ||
    policy.filesystem !== undefined ||
    policy.network !== undefined ||
    (policy.mcp?.allowedServers.length ?? 0) > 0 ||
    (policy.mcp?.allowedTools.length ?? 0) > 0
  );
}

function resolveAgentToolPolicy(
  agent: EcoAgentInstanceConfig,
  template: EcoAgentTemplateConfig,
): EcoToolPolicy {
  return hasConfiguredToolPolicy(agent.tools) ? agent.tools : template.defaultTools;
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
  const base = uniqueToolPatterns([...policy.allowed, ...extraAllowed]);
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
