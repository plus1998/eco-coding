import type { UpstreamApiCompat } from "./api-compat";
import type {
  ModelsDevMapping,
  RoleRouteConfig,
  RouteManualSpec,
  RouteProfileView,
  SubagentEnabledSettings,
  ThinkingEffort,
} from "./ipc";

export type AgentDomain = "coding" | "research" | "writing" | "product" | "data" | "ops" | "custom";
export type AgentConfigSource = "built_in" | "user" | "project" | "derived";

export interface ModelRef {
  providerId: string;
  modelId: string;
  apiCompat?: UpstreamApiCompat;
  thinkingEffort?: ThinkingEffort;
  modelsDevMapping?: ModelsDevMapping;
  manualSpec?: RouteManualSpec;
  /** 引用 Provider 的候选模型 ID（软引用，不存在时降级为手动模式） */
  candidateModelId?: string;
}

export type ModelRequirementCapability = "reasoning" | "coding" | "long_context" | "vision" | "tool_use";

export interface ModelRequirements {
  capabilities: ModelRequirementCapability[];
  preferredLatency?: "fast" | "balanced" | "quality";
  minContextTokens?: number;
}

export interface ToolPolicy {
  allowed: string[];
  disallowed: string[];
  bash?: {
    enabled: boolean;
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
  confirmation?: "always" | "on_risk" | "never";
  skills?: { enabled: boolean };
  interaction?: { askUser: boolean };
  taskProgress?: { enabled: boolean };
  delegation?: { enabled: boolean; allowedAgents?: string[] };
  coreOverrides?: {
    claude?: { disallowedTools: string[] };
    codex?: {
      sandboxMode?: "read-only";
      approvalPolicy?: "untrusted";
    };
  };
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
  prompt: string;
  whenToUse: string;
  outputContract?: string;
  modelRequirements?: ModelRequirements;
  defaultTools: ToolPolicy;
  mcpServers: string[];
  skills: string[];
  allowDelegation: boolean;
  builtIn: boolean;
  source: AgentConfigSource;
  updatedAt: string;
}

/** Materialized main-agent block consumed by Claude/Codex runtime. */
export interface MainAgentConfig {
  agentKey: string;
  name: string;
  domain: AgentDomain;
  systemPromptPreset: "core_native" | "custom_append";
  prompt: string;
  modelRef: ModelRef;
  tools: ToolPolicy;
  skills: string[];
}

/** Model + capability policy for the main agent. No prompt text. */
export interface MainAgentConfigResource {
  id: string;
  name: string;
  agentKey: string;
  domain: AgentDomain;
  modelRef: ModelRef;
  tools: ToolPolicy;
  skills: string[];
  updatedAt: string;
  source: AgentConfigSource;
}

/** Independent prompt append resource. `builtin` means no custom append. */
export type MainAgentPromptMode = "builtin" | "custom_append";

export interface MainAgentPromptResource {
  id: string;
  name: string;
  mode: MainAgentPromptMode;
  /** Custom append text. Empty when mode is `builtin`. */
  prompt: string;
  updatedAt: string;
  source: AgentConfigSource;
}

export type MainAgentPromptSelection =
  | { mode: "builtin" }
  | { mode: "custom_append"; promptId: string };

export type SubagentSelection =
  | { mode: "none" }
  | { mode: "orchestration"; orchestrationId: string };

/** Live component references resolved when creating or switching a thread. */
export interface OrchestrationSelection {
  mainAgentConfigId: string;
  mainPrompt: MainAgentPromptSelection;
  subagents: SubagentSelection;
}

/** Subagent roster + strategy + domain resource. */
export interface SubagentOrchestrationResource {
  id: string;
  name: string;
  domain: AgentDomain;
  agents: AgentInstanceConfig[];
  strategy: OrchestrationStrategy;
  updatedAt: string;
  source: AgentConfigSource;
}

/**
 * Materialised orchestration snapshot for a thread runtime.
 * Retains component content, display names, and the original selection.
 */
export interface ResolvedOrchestrationSnapshot {
  selection: OrchestrationSelection;
  mainAgentConfigName: string;
  mainPromptDisplayName: string;
  subagentOrchestrationDisplayName?: string;
  mainAgent: MainAgentConfig;
  agents: AgentInstanceConfig[];
  strategy: OrchestrationStrategy;
  resolvedAt: string;
}

/** Runtime execution config passed to Claude/Codex orchestration. */
export interface EcoOrchestrationConfig {
  mainAgent: MainAgentConfig;
  agents: AgentInstanceConfig[];
  strategy: OrchestrationStrategy;
}

export interface OrchestrationResourceLookup {
  mainAgentConfigs: readonly MainAgentConfigResource[];
  mainAgentPrompts: readonly MainAgentPromptResource[];
  subagentOrchestrations: readonly SubagentOrchestrationResource[];
}

export interface PresetResourceBundle {
  mainAgentConfig: MainAgentConfigResource;
  mainAgentPrompt?: MainAgentPromptResource;
  subagentOrchestration: SubagentOrchestrationResource;
  selection: OrchestrationSelection;
}

export interface AgentInstanceConfig {
  agentKey: string;
  templateId: string;
  displayName?: string;
  themeColor?: string;
  modelRef: ModelRef;
  tools: ToolPolicy;
  mcpServers: string[];
  skills: string[];
  enabled: boolean;
}

export type OrchestrationStrategy = { kind: "autonomous"; guidancePrompt?: string };

export const CODING_AGENT_TEMPLATE_IDS = {
  explore: "builtin.coding.explore",
  architect: "builtin.coding.architect",
  coder: "builtin.coding.coder",
  reviewer: "builtin.coding.reviewer",
  tester: "builtin.coding.tester",
} as const;

export const CODING_AGENT_KEYS = {
  main: "main",
  explore: "explore",
  architect: "architect",
  coder: "coder",
  reviewer: "reviewer",
  tester: "tester",
} as const;

const BUILT_IN_TEMPLATE_UPDATED_AT = "2026-06-07T00:00:00.000Z";

const CLAUDE_WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
const CLAUDE_TASK_PROGRESS_TOOLS = ["TaskCreate", "TaskUpdate", "TodoWrite"] as const;

const ARCHITECT_TOOLS: ToolPolicy = {
  allowed: [],
  disallowed: [...CLAUDE_WRITE_TOOLS, "Bash", ...CLAUDE_TASK_PROGRESS_TOOLS],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

const EXPLORE_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep"],
  disallowed: [...CLAUDE_WRITE_TOOLS, "Bash", ...CLAUDE_TASK_PROGRESS_TOOLS],
  bash: { enabled: false },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

const CODER_TOOLS: ToolPolicy = {
  allowed: [],
  disallowed: [],
  bash: { enabled: true },
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: false, webFetch: false },
};

const REVIEW_TOOLS: ToolPolicy = {
  allowed: [],
  disallowed: [...CLAUDE_WRITE_TOOLS, ...CLAUDE_TASK_PROGRESS_TOOLS],
  bash: { enabled: true },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

const TESTER_TOOLS: ToolPolicy = {
  allowed: [],
  disallowed: [],
  bash: { enabled: true },
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: false, webFetch: false },
};

const MAIN_CODING_TOOLS: ToolPolicy = {
  allowed: [],
  disallowed: [],
  bash: { enabled: true },
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: true, webFetch: true },
};

export interface BuiltInPresetAgent {
  agentKey: string;
  templateId: string;
  displayName: string;
}

export interface BuiltInPresetModelSuggestion {
  main: string;
  agents: Record<string, string>;
}

export interface BuiltInPresetStrategyRecommendation {
  autonomous: Extract<OrchestrationStrategy, { kind: "autonomous" }>;
}

export interface BuiltInPresetExampleTask {
  id: string;
  title: string;
  prompt: string;
  expectedOutcome: string;
}

export interface BuiltInPresetDefinition {
  id: AgentDomain;
  name: string;
  description: string;
  mainAgentPrompt: string;
  mainAgentTools: ToolPolicy;
  defaultAgents: BuiltInPresetAgent[];
  modelSuggestion: BuiltInPresetModelSuggestion;
  strategies: BuiltInPresetStrategyRecommendation;
  examples: BuiltInPresetExampleTask[];
}

export function createBuiltInAgentTemplates(): AgentTemplate[] {
  return [
    {
      id: CODING_AGENT_TEMPLATE_IDS.explore,
      name: "Explore",
      description: "Read-only codebase discovery agent for locating files, symbols, and relevant context.",
      domain: "coding",
      prompt:
        "Explore the codebase read-only. Locate relevant files and symbols, trace relationships, and return concise findings with paths. Do not edit files or run commands.",
      whenToUse: "Use when the main agent needs codebase context before answering, planning, or editing.",
      outputContract: "Return relevant paths, symbols, relationships, and remaining context gaps.",
      defaultTools: cloneToolPolicy(EXPLORE_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: CODING_AGENT_TEMPLATE_IDS.architect,
      name: "Architect",
      description: "Structure and task breakdown agent for coding work.",
      domain: "coding",
      prompt: "Refine architecture, identify module boundaries, and break work into implementable tasks.",
      whenToUse: "Use for cross-module changes or when task boundaries are unclear.",
      outputContract: "Return architecture notes and a concrete task breakdown.",
      defaultTools: cloneToolPolicy(ARCHITECT_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: CODING_AGENT_TEMPLATE_IDS.coder,
      name: "Coder",
      description: "Focused implementation agent with surgical diffs and narrow verification.",
      domain: "coding",
      prompt:
        "Implement the assigned subtask only, obey AGENTS.md for touched files, verify narrowly, and report changed files.",
      whenToUse: "Use after the task scope is clear and code edits are required.",
      outputContract:
        "Return files changed, implementation summary, verification result, and blockers or follow-ups.",
      defaultTools: cloneToolPolicy(CODER_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: CODING_AGENT_TEMPLATE_IDS.reviewer,
      name: "Reviewer",
      description: "Review agent for this session's changed files.",
      domain: "coding",
      prompt:
        "Review only this session's changes, classify actionable findings by severity with confidence and line ranges, and do not implement fixes.",
      whenToUse: "Use after implementation when correctness, safety, or regression risk is meaningful.",
      outputContract:
        "Return P0/P1/P2 sections with confidence and code locations, then PASS or BLOCKERS with overall correctness.",
      defaultTools: cloneToolPolicy(REVIEW_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: CODING_AGENT_TEMPLATE_IDS.tester,
      name: "Tester",
      description: "Verification agent for coding changes.",
      domain: "coding",
      prompt:
        "Run the narrowest useful verification for the completed work, map each plan gate to evidence, and report failures clearly.",
      whenToUse: "Use after implementation and review when automated verification is useful.",
      outputContract: "Return commands run, requirement coverage, and a PASS or FAIL verdict.",
      defaultTools: cloneToolPolicy(TESTER_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
  ];
}

/** Merge store/user templates with built-ins without duplicate ids. User entries win. */
export function resolveAgentTemplateCatalog(
  templates: readonly AgentTemplate[] = [],
): AgentTemplate[] {
  const byId = new Map<string, AgentTemplate>();
  for (const template of templates) {
    byId.set(template.id, template);
  }
  for (const template of createBuiltInAgentTemplates()) {
    if (!byId.has(template.id)) {
      byId.set(template.id, template);
    }
  }
  return [...byId.values()];
}

export function createBuiltInPresetCatalog(): BuiltInPresetDefinition[] {
  return [
    {
      id: "coding",
      name: "Coding",
      description: "Software development, code modification, review, and verification.",
      mainAgentPrompt:
        "Coordinate software engineering work. Clarify scope, inspect the repository, delegate specialized work when useful, keep edits focused, and finish with verification evidence.",
      mainAgentTools: cloneToolPolicy(MAIN_CODING_TOOLS),
      defaultAgents: [
        presetAgent(CODING_AGENT_KEYS.explore, CODING_AGENT_TEMPLATE_IDS.explore, "Explore"),
        presetAgent(CODING_AGENT_KEYS.architect, CODING_AGENT_TEMPLATE_IDS.architect, "Architect"),
        presetAgent(CODING_AGENT_KEYS.coder, CODING_AGENT_TEMPLATE_IDS.coder, "Coder"),
        presetAgent(CODING_AGENT_KEYS.reviewer, CODING_AGENT_TEMPLATE_IDS.reviewer, "Reviewer"),
        presetAgent(CODING_AGENT_KEYS.tester, CODING_AGENT_TEMPLATE_IDS.tester, "Tester"),
      ],
      modelSuggestion: {
        main: "Use the strongest reasoning model available for planning and integration.",
        agents: {
          explore: "Use a fast long-context model.",
          architect: "Use a strong reasoning model.",
          coder: "Use a strong coding model.",
          reviewer: "Use a strong reasoning model with code review skill.",
          tester: "Use a fast model that can run and interpret verification.",
        },
      },
      strategies: presetStrategies({
        autonomousGuidance:
          "Choose coding subagents only when their specialization materially improves correctness or speed.",
      }),
      examples: [
        exampleTask(
          "coding-bugfix",
          "Fix a failing checkout total calculation and add the narrowest useful regression test.",
          "A scoped code change, regression test, and verification result.",
        ),
        exampleTask(
          "coding-review",
          "Review the current branch for correctness, security, and missing tests.",
          "Severity-ranked findings with file references and a PASS or BLOCKERS verdict.",
        ),
        exampleTask(
          "coding-refactor",
          "Refactor the billing projector to expose a smaller public API without changing behavior.",
          "Implementation notes, changed files, and focused verification output.",
        ),
      ],
    },
  ];
}

export function createUserPresetResourceId(presetId: AgentDomain, existingIds: readonly string[]): string {
  return uniquePresetProfileValue(
    `user.${presetId}.main_config`,
    existingIds,
    (base, index) => `${base}.${index}`,
  );
}

export function createUserPresetResourceName(presetName: string, existingNames: readonly string[]): string {
  return uniquePresetProfileValue(
    `${presetName} Main Config`,
    existingNames,
    (base, index) => `${base} ${index}`,
  );
}

export function buildPresetResourcesFromDefinition(
  preset: BuiltInPresetDefinition,
  options: {
    mainAgentConfigId: string;
    mainAgentConfigName: string;
    subagentOrchestrationId: string;
    subagentOrchestrationName: string;
    mainAgentPromptId?: string;
    mainAgentPromptName?: string;
    modelRef: ModelRef;
    templates?: readonly AgentTemplate[];
    source?: Extract<AgentConfigSource, "user" | "project">;
    updatedAt?: string;
  },
): PresetResourceBundle {
  const modelRef = cloneModelRef(options.modelRef);
  if (!modelRef.providerId || !modelRef.modelId) {
    throw new Error("复制场景预设需要可用的默认模型。");
  }
  const templateById = new Map(
    (options.templates ?? createBuiltInAgentTemplates()).map((template) => [template.id, template]),
  );
  const now = options.updatedAt ?? new Date().toISOString();
  const source = options.source ?? "user";
  const usesCustomPrompt = preset.id !== "coding";
  const mainAgentConfig: MainAgentConfigResource = {
    id: options.mainAgentConfigId.trim(),
    name: options.mainAgentConfigName.trim(),
    agentKey: "main",
    domain: preset.id,
    modelRef,
    tools: cloneToolPolicy(preset.mainAgentTools),
    skills: [],
    updatedAt: now,
    source,
  };
  const mainAgentPrompt: MainAgentPromptResource | undefined = usesCustomPrompt
    ? {
        id: (options.mainAgentPromptId ?? `${options.mainAgentConfigId}.prompt`).trim(),
        name: (options.mainAgentPromptName ?? `${preset.name} Prompt`).trim(),
        mode: "custom_append",
        prompt: preset.mainAgentPrompt.trim(),
        updatedAt: now,
        source,
      }
    : undefined;
  const subagentOrchestration: SubagentOrchestrationResource = {
    id: options.subagentOrchestrationId.trim(),
    name: options.subagentOrchestrationName.trim(),
    domain: preset.id,
    agents: preset.defaultAgents.map((agent) => {
      const template = templateById.get(agent.templateId);
      if (!template) {
        throw new Error(`场景预设 ${preset.name} 缺少子代理模板：${agent.templateId}`);
      }
      return {
        agentKey: agent.agentKey,
        templateId: agent.templateId,
        displayName: agent.displayName,
        modelRef: cloneModelRef(modelRef),
        tools: cloneToolPolicy(template.defaultTools),
        mcpServers: [...template.mcpServers],
        skills: [...template.skills],
        enabled: true,
      };
    }),
    strategy: cloneOrchestrationStrategy(preset.strategies.autonomous),
    updatedAt: now,
    source,
  };
  const selection: OrchestrationSelection = {
    mainAgentConfigId: mainAgentConfig.id,
    mainPrompt: mainAgentPrompt
      ? { mode: "custom_append", promptId: mainAgentPrompt.id }
      : { mode: "builtin" },
    subagents: { mode: "orchestration", orchestrationId: subagentOrchestration.id },
  };
  return {
    mainAgentConfig,
    ...(mainAgentPrompt ? { mainAgentPrompt } : {}),
    subagentOrchestration,
    selection,
  };
}

export function buildPresetResourcesFromRouteProfile(
  routeProfile: RouteProfileView,
  options: {
    mainAgentConfigId: string;
    subagentOrchestrationId: string;
    subagentEnabled?: Partial<SubagentEnabledSettings>;
    updatedAt?: string;
  },
): PresetResourceBundle {
  const routeByRole = new Map(routeProfile.routes.map((route) => [route.role, route]));
  const plannerRoute = requireRoute(routeByRole, "planner", routeProfile.id);
  const exploreRoute = requireRoute(routeByRole, "explore", routeProfile.id);
  const updatedAt = options.updatedAt ?? routeProfile.updatedAt;
  const mainAgentConfig: MainAgentConfigResource = {
    id: options.mainAgentConfigId.trim(),
    name: `${routeProfile.name} Main Config`,
    agentKey: CODING_AGENT_KEYS.main,
    domain: "coding",
    modelRef: routeToModelRef(plannerRoute),
    tools: cloneToolPolicy(MAIN_CODING_TOOLS),
    skills: [],
    updatedAt,
    source: "derived",
  };
  const subagentOrchestration: SubagentOrchestrationResource = {
    id: options.subagentOrchestrationId.trim(),
    name: `${routeProfile.name} Subagents`,
    domain: "coding",
    agents: [
      buildCodingAgentInstance(
        CODING_AGENT_KEYS.explore,
        CODING_AGENT_TEMPLATE_IDS.explore,
        exploreRoute,
        subagentEnabledFor("explore", options.subagentEnabled),
      ),
      buildCodingAgentInstance(
        CODING_AGENT_KEYS.architect,
        CODING_AGENT_TEMPLATE_IDS.architect,
        requireRoute(routeByRole, "architect", routeProfile.id),
        subagentEnabledFor("architect", options.subagentEnabled),
      ),
      buildCodingAgentInstance(
        CODING_AGENT_KEYS.coder,
        CODING_AGENT_TEMPLATE_IDS.coder,
        requireRoute(routeByRole, "coder", routeProfile.id),
        true,
      ),
      buildCodingAgentInstance(
        CODING_AGENT_KEYS.reviewer,
        CODING_AGENT_TEMPLATE_IDS.reviewer,
        requireRoute(routeByRole, "reviewer", routeProfile.id),
        subagentEnabledFor("reviewer", options.subagentEnabled),
      ),
      buildCodingAgentInstance(
        CODING_AGENT_KEYS.tester,
        CODING_AGENT_TEMPLATE_IDS.tester,
        requireRoute(routeByRole, "tester", routeProfile.id),
        subagentEnabledFor("tester", options.subagentEnabled),
      ),
    ],
    strategy: codingDefaultStrategy(),
    updatedAt,
    source: "derived",
  };
  const selection: OrchestrationSelection = {
    mainAgentConfigId: mainAgentConfig.id,
    mainPrompt: { mode: "builtin" },
    subagents: { mode: "orchestration", orchestrationId: subagentOrchestration.id },
  };
  return { mainAgentConfig, subagentOrchestration, selection };
}

function buildCodingAgentInstance(
  agentKey: string,
  templateId: string,
  route: RoleRouteConfig,
  enabled: boolean,
): AgentInstanceConfig {
  const template = createBuiltInAgentTemplates().find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new Error(`Missing built-in agent template: ${templateId}`);
  }
  return {
    agentKey,
    templateId,
    displayName: template.name,
    modelRef: routeToModelRef(route),
    tools: cloneToolPolicy(template.defaultTools),
    mcpServers: [],
    skills: [],
    enabled,
  };
}

function subagentEnabledFor(
  key: keyof SubagentEnabledSettings,
  settings: Partial<SubagentEnabledSettings> | undefined,
): boolean {
  return settings?.[key] ?? true;
}

function codingDefaultStrategy(): OrchestrationStrategy {
  return {
    kind: "autonomous",
    guidancePrompt:
      "Choose coding subagents only when their specialization materially improves correctness or speed.",
  };
}

function routeToModelRef(route: RoleRouteConfig): ModelRef {
  return {
    providerId: route.providerId,
    modelId: route.modelId,
    ...(route.apiCompat && { apiCompat: route.apiCompat }),
    ...(route.thinkingEffort && { thinkingEffort: route.thinkingEffort }),
    ...(route.modelsDevMapping && { modelsDevMapping: route.modelsDevMapping }),
    ...(route.manualSpec && { manualSpec: route.manualSpec }),
  };
}

function requireRoute(
  routeByRole: ReadonlyMap<string, RoleRouteConfig>,
  role: string,
  profileId: string,
): RoleRouteConfig {
  const route = routeByRole.get(role);
  if (!route) {
    throw new Error(`Coding route profile ${profileId} is missing ${role} model route.`);
  }
  return route;
}

function presetAgent(agentKey: string, templateId: string, displayName: string): BuiltInPresetAgent {
  return { agentKey, templateId, displayName };
}

function presetStrategies(input: { autonomousGuidance: string }): BuiltInPresetStrategyRecommendation {
  return {
    autonomous: { kind: "autonomous", guidancePrompt: input.autonomousGuidance },
  };
}

function exampleTask(id: string, prompt: string, expectedOutcome: string): BuiltInPresetExampleTask {
  return {
    id,
    title: prompt,
    prompt,
    expectedOutcome,
  };
}

function uniquePresetProfileValue(
  base: string,
  existingValues: readonly string[],
  buildCandidate: (base: string, index: number) => string,
): string {
  const existing = new Set(existingValues.map((value) => value.trim()).filter(Boolean));
  if (!existing.has(base)) {
    return base;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = buildCandidate(base, index);
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`无法为 ${base} 生成唯一名称。`);
}


export function isOrchestrationSelection(value: unknown): value is OrchestrationSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.mainAgentConfigId !== "string" || !record.mainAgentConfigId.trim()) {
    return false;
  }
  if (!isMainAgentPromptSelection(record.mainPrompt)) {
    return false;
  }
  return isSubagentSelection(record.subagents);
}

export function isSubagentSelection(value: unknown): value is SubagentSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.mode === "none") {
    return true;
  }
  return (
    record.mode === "orchestration" &&
    typeof record.orchestrationId === "string" &&
    Boolean(record.orchestrationId.trim())
  );
}

export function isMainAgentPromptSelection(value: unknown): value is MainAgentPromptSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.mode === "builtin") {
    return true;
  }
  return (
    record.mode === "custom_append" &&
    typeof record.promptId === "string" &&
    Boolean(record.promptId.trim())
  );
}

export function isResolvedOrchestrationSnapshot(value: unknown): value is ResolvedOrchestrationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isOrchestrationSelection(record.selection) &&
    typeof record.mainAgentConfigName === "string" &&
    typeof record.mainPromptDisplayName === "string" &&
    Boolean(record.mainAgent && typeof record.mainAgent === "object") &&
    Array.isArray(record.agents) &&
    Boolean(record.strategy && typeof record.strategy === "object") &&
    typeof record.resolvedAt === "string"
  );
}

const BUILTIN_MAIN_PROMPT_DISPLAY_NAME = "内置提示词";

export function resolveMainPromptDisplayName(
  selection: MainAgentPromptSelection,
  prompts: readonly MainAgentPromptResource[],
): string {
  if (selection.mode === "builtin") {
    return BUILTIN_MAIN_PROMPT_DISPLAY_NAME;
  }
  const prompt = prompts.find((entry) => entry.id === selection.promptId);
  if (!prompt) {
    throw new Error(`找不到主 Agent 提示词：${selection.promptId}`);
  }
  return prompt.name;
}

export function materializeMainAgentConfig(
  config: MainAgentConfigResource,
  promptSelection: MainAgentPromptSelection,
  prompts: readonly MainAgentPromptResource[] = [],
): MainAgentConfig {
  if (promptSelection.mode === "builtin") {
    return {
      agentKey: config.agentKey,
      name: config.name,
      domain: config.domain,
      systemPromptPreset: "core_native",
      prompt: "",
      modelRef: cloneModelRef(config.modelRef),
      tools: cloneToolPolicy(config.tools),
      skills: [...config.skills],
    };
  }
  const prompt = prompts.find((entry) => entry.id === promptSelection.promptId);
  if (!prompt) {
    throw new Error(`找不到主 Agent 提示词：${promptSelection.promptId}`);
  }
  if (prompt.mode === "builtin") {
    throw new Error(`主 Agent 提示词「${prompt.id}」不是有效的自定义追加资源。`);
  }
  return {
    agentKey: config.agentKey,
    name: config.name,
    domain: config.domain,
    systemPromptPreset: "custom_append",
    prompt: prompt.prompt,
    modelRef: cloneModelRef(config.modelRef),
    tools: cloneToolPolicy(config.tools),
    skills: [...config.skills],
  };
}

/** Strict resolver: missing references throw instead of returning undefined. */
export function resolveOrchestrationSnapshot(
  selection: OrchestrationSelection,
  lookup: OrchestrationResourceLookup,
): ResolvedOrchestrationSnapshot {
  const resolvedSelection = cloneOrchestrationSelection(selection);
  const mainAgentConfig = lookup.mainAgentConfigs.find(
    (entry) => entry.id === resolvedSelection.mainAgentConfigId,
  );
  if (!mainAgentConfig) {
    throw new Error(`找不到主 Agent 配置：${resolvedSelection.mainAgentConfigId}`);
  }

  const mainAgent = materializeMainAgentConfig(
    mainAgentConfig,
    resolvedSelection.mainPrompt,
    lookup.mainAgentPrompts,
  );
  const mainPromptDisplayName = resolveMainPromptDisplayName(
    resolvedSelection.mainPrompt,
    lookup.mainAgentPrompts,
  );

  if (resolvedSelection.subagents.mode === "none") {
    return {
      selection: resolvedSelection,
      mainAgentConfigName: mainAgentConfig.name,
      mainPromptDisplayName,
      mainAgent,
      agents: [],
      strategy: defaultNoSubagentsStrategy(),
      resolvedAt: new Date().toISOString(),
    };
  }

  const subagentOrchestrationId = resolvedSelection.subagents.orchestrationId;
  const subagentOrchestration = lookup.subagentOrchestrations.find(
    (entry) => entry.id === subagentOrchestrationId,
  );
  if (!subagentOrchestration) {
    throw new Error(`找不到子代理编排：${subagentOrchestrationId}`);
  }

  return {
    selection: resolvedSelection,
    mainAgentConfigName: mainAgentConfig.name,
    mainPromptDisplayName,
    subagentOrchestrationDisplayName: subagentOrchestration.name,
    mainAgent,
    agents: subagentOrchestration.agents.map(cloneAgentInstance),
    strategy: cloneOrchestrationStrategy(subagentOrchestration.strategy),
    resolvedAt: new Date().toISOString(),
  };
}

export function orchestrationConfigFromSnapshot(
  snapshot: ResolvedOrchestrationSnapshot,
): EcoOrchestrationConfig {
  return {
    mainAgent: cloneMainAgentConfig(snapshot.mainAgent),
    agents: snapshot.agents.map(cloneAgentInstance),
    strategy: cloneOrchestrationStrategy(snapshot.strategy),
  };
}

function cloneOrchestrationSelection(selection: OrchestrationSelection): OrchestrationSelection {
  return {
    mainAgentConfigId: selection.mainAgentConfigId.trim(),
    mainPrompt:
      selection.mainPrompt.mode === "builtin"
        ? { mode: "builtin" }
        : { mode: "custom_append", promptId: selection.mainPrompt.promptId.trim() },
    subagents:
      selection.subagents.mode === "none"
        ? { mode: "none" }
        : { mode: "orchestration", orchestrationId: selection.subagents.orchestrationId.trim() },
  };
}

function cloneMainAgentConfig(config: MainAgentConfig): MainAgentConfig {
  return {
    agentKey: config.agentKey,
    name: config.name,
    domain: config.domain,
    systemPromptPreset: config.systemPromptPreset,
    prompt: config.prompt,
    modelRef: cloneModelRef(config.modelRef),
    tools: cloneToolPolicy(config.tools),
    skills: [...config.skills],
  };
}

function defaultNoSubagentsStrategy(): OrchestrationStrategy {
  return { kind: "autonomous" };
}

function cloneOrchestrationStrategy(strategy: OrchestrationStrategy): OrchestrationStrategy {
  return {
    kind: "autonomous",
    ...(strategy.guidancePrompt && { guidancePrompt: strategy.guidancePrompt }),
  };
}

function cloneAgentInstance(agent: AgentInstanceConfig): AgentInstanceConfig {
  return {
    agentKey: agent.agentKey,
    templateId: agent.templateId,
    ...(agent.displayName ? { displayName: agent.displayName } : {}),
    ...(agent.themeColor ? { themeColor: agent.themeColor } : {}),
    modelRef: cloneModelRef(agent.modelRef),
    tools: cloneToolPolicy(agent.tools),
    mcpServers: [...agent.mcpServers],
    skills: [...agent.skills],
    enabled: agent.enabled,
  };
}

function cloneModelRef(modelRef: ModelRef): ModelRef {
  return {
    providerId: modelRef.providerId.trim(),
    modelId: modelRef.modelId.trim(),
    ...(modelRef.apiCompat && { apiCompat: modelRef.apiCompat }),
    ...(modelRef.thinkingEffort && { thinkingEffort: modelRef.thinkingEffort }),
    ...(modelRef.modelsDevMapping && { modelsDevMapping: { ...modelRef.modelsDevMapping } }),
    ...(modelRef.manualSpec && { manualSpec: { ...modelRef.manualSpec } }),
    ...(modelRef.candidateModelId && { candidateModelId: modelRef.candidateModelId }),
  };
}

function cloneStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
  return {
    allowed: cloneStringList(policy.allowed),
    disallowed: cloneStringList(policy.disallowed),
    ...(policy.bash && {
      bash: { enabled: policy.bash.enabled },
    }),
    ...(policy.mcp && {
      mcp: {
        allowedServers: cloneStringList(policy.mcp.allowedServers),
        allowedTools: cloneStringList(policy.mcp.allowedTools),
      },
    }),
    ...(policy.filesystem && { filesystem: { ...policy.filesystem } }),
    ...(policy.network && { network: { ...policy.network } }),
    ...(policy.confirmation && { confirmation: policy.confirmation }),
    ...(policy.skills && { skills: { ...policy.skills } }),
    ...(policy.interaction && { interaction: { ...policy.interaction } }),
    ...(policy.taskProgress && { taskProgress: { ...policy.taskProgress } }),
    ...(policy.delegation && {
      delegation: {
        ...policy.delegation,
        ...(policy.delegation.allowedAgents && {
          allowedAgents: cloneStringList(policy.delegation.allowedAgents),
        }),
      },
    }),
    ...(policy.coreOverrides && {
      coreOverrides: {
        ...(policy.coreOverrides.claude && {
          claude: { disallowedTools: cloneStringList(policy.coreOverrides.claude.disallowedTools) },
        }),
        ...(policy.coreOverrides.codex && { codex: { ...policy.coreOverrides.codex } }),
      },
    }),
  };
}
