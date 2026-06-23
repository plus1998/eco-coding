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
  version: number;
  updatedAt: string;
}

export interface MainAgentConfig {
  agentKey: string;
  name: string;
  domain: AgentDomain;
  systemPromptPreset: "claude_code" | "custom";
  prompt: string;
  modelRef: ModelRef;
  tools: ToolPolicy;
  skills: string[];
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

export interface BuiltinAgentConfig {
  modelRef: ModelRef;
  themeColor?: string;
}

export interface BuiltinAgentsConfig {
  explore: BuiltinAgentConfig;
}

export type OrchestrationStrategy = { kind: "autonomous"; guidancePrompt?: string };

export interface OrchestrationProfile {
  id: string;
  name: string;
  preset: AgentDomain;
  mainAgent: MainAgentConfig;
  builtinAgents: BuiltinAgentsConfig;
  agents: AgentInstanceConfig[];
  strategy: OrchestrationStrategy;
  version: number;
  updatedAt: string;
  source: AgentConfigSource;
  sourceRouteProfileId?: string;
}

export const CODING_AGENT_TEMPLATE_IDS = {
  architect: "builtin.coding.architect",
  coder: "builtin.coding.coder",
  reviewer: "builtin.coding.reviewer",
  tester: "builtin.coding.tester",
} as const;

export const CODING_AGENT_KEYS = {
  main: "main",
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

export interface BuiltInPresetEvalCase {
  id: string;
  title: string;
  prompt: string;
  successCriteria: string[];
  expectedAgentKeys: string[];
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
  evals: BuiltInPresetEvalCase[];
}

export function createBuiltInAgentTemplates(): AgentTemplate[] {
  return [
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
      version: 1,
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
      version: 1,
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
      version: 1,
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
      outputContract:
        "Return commands run, requirement coverage, and a PASS or FAIL verdict.",
      defaultTools: cloneToolPolicy(TESTER_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
  ];
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
      evals: [
        evalCase(
          "coding-regression",
          "Regression fix",
          "Fix a real failing unit test without broad rewrites.",
          [
            "Identifies the failing behavior before editing.",
            "Changes only the relevant implementation and test files.",
            "Reports exact verification commands and results.",
          ],
          ["coder", "tester"],
        ),
        evalCase(
          "coding-review-quality",
          "Review quality",
          "Review a branch containing one security bug and one test gap.",
          [
            "Finds the security bug.",
            "Separates blocking issues from polish.",
            "Does not invent unrelated changes.",
          ],
          ["reviewer"],
        ),
        evalCase(
          "coding-cross-module-plan",
          "Cross-module plan",
          "Plan a cross-module API migration.",
          ["Maps affected modules.", "Names sequencing and rollback risks.", "Produces implementable tasks."],
          ["architect"],
        ),
      ],
    },
  ];
}

export function createUserPresetProfileId(presetId: AgentDomain, existingIds: readonly string[]): string {
  return uniquePresetProfileValue(
    `user.${presetId}.profile`,
    existingIds,
    (base, index) => `${base}.${index}`,
  );
}

export function createUserPresetProfileName(presetName: string, existingNames: readonly string[]): string {
  return uniquePresetProfileValue(
    `${presetName} Profile`,
    existingNames,
    (base, index) => `${base} ${index}`,
  );
}

export function buildOrchestrationProfileFromPreset(
  preset: BuiltInPresetDefinition,
  options: {
    id: string;
    name: string;
    modelRef: ModelRef;
    templates?: readonly AgentTemplate[];
    source?: Extract<AgentConfigSource, "user" | "project">;
    updatedAt?: string;
  },
): OrchestrationProfile {
  const modelRef = cloneModelRef(options.modelRef);
  if (!modelRef.providerId || !modelRef.modelId) {
    throw new Error("复制场景预设需要可用的默认模型。");
  }
  const templateById = new Map(
    (options.templates ?? createBuiltInAgentTemplates()).map((template) => [template.id, template]),
  );
  const now = options.updatedAt ?? new Date().toISOString();
  return {
    id: options.id.trim(),
    name: options.name.trim(),
    preset: preset.id,
    mainAgent: {
      agentKey: "main",
      name: `${preset.name} Main Agent`,
      domain: preset.id,
      systemPromptPreset: preset.id === "coding" ? "claude_code" : "custom",
      prompt: preset.mainAgentPrompt.trim(),
      modelRef,
      tools: cloneToolPolicy(preset.mainAgentTools),
      skills: [],
    },
    builtinAgents: createBuiltinAgents(modelRef),
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
    version: 1,
    updatedAt: now,
    source: options.source ?? "user",
  };
}

export function buildCodingOrchestrationProfileFromRouteProfile(
  routeProfile: RouteProfileView,
  options: {
    subagentEnabled?: Partial<SubagentEnabledSettings>;
  } = {},
): OrchestrationProfile {
  const routeByRole = new Map(routeProfile.routes.map((route) => [route.role, route]));
  const plannerRoute = requireRoute(routeByRole, "planner", routeProfile.id);
  const exploreRoute = requireRoute(routeByRole, "explore", routeProfile.id);
  const updatedAt = routeProfile.updatedAt;
  return {
    id: routeProfile.id,
    name: routeProfile.name,
    preset: "coding",
    mainAgent: {
      agentKey: CODING_AGENT_KEYS.main,
      name: "Main Agent",
      domain: "coding",
      systemPromptPreset: "claude_code",
      prompt: "Coordinate the coding task, choose useful subagents, and produce a concise final result.",
      modelRef: routeToModelRef(plannerRoute),
      tools: cloneToolPolicy(MAIN_CODING_TOOLS),
      skills: [],
    },
    builtinAgents: createBuiltinAgents(routeToModelRef(exploreRoute)),
    agents: [
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
    version: 1,
    updatedAt,
    source: "derived",
    sourceRouteProfileId: routeProfile.id,
  };
}

export function buildCodingOrchestrationProfilesFromRouteProfiles(
  routeProfiles: readonly RouteProfileView[],
  options: {
    subagentEnabled?: Partial<SubagentEnabledSettings>;
  } = {},
): OrchestrationProfile[] {
  return routeProfiles.map((profile) => buildCodingOrchestrationProfileFromRouteProfile(profile, options));
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

function createBuiltinAgents(modelRef: ModelRef): BuiltinAgentsConfig {
  return {
    explore: {
      modelRef: cloneModelRef(modelRef),
    },
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
    guidancePrompt: "Choose coding subagents only when their specialization materially improves correctness or speed.",
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
    throw new Error(`Coding orchestration profile ${profileId} is missing ${role} model route.`);
  }
  return route;
}

function presetAgent(agentKey: string, templateId: string, displayName: string): BuiltInPresetAgent {
  return { agentKey, templateId, displayName };
}

function presetStrategies(input: {
  autonomousGuidance: string;
}): BuiltInPresetStrategyRecommendation {
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

function evalCase(
  id: string,
  title: string,
  prompt: string,
  successCriteria: string[],
  expectedAgentKeys: string[],
): BuiltInPresetEvalCase {
  return {
    id,
    title,
    prompt,
    successCriteria: [...successCriteria],
    expectedAgentKeys: [...expectedAgentKeys],
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

function cloneOrchestrationStrategy(strategy: OrchestrationStrategy): OrchestrationStrategy {
  return {
    kind: "autonomous",
    ...(strategy.guidancePrompt && { guidancePrompt: strategy.guidancePrompt }),
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

function cloneToolPolicy(policy: ToolPolicy): ToolPolicy {
  return {
    allowed: [...policy.allowed],
    disallowed: [...policy.disallowed],
    ...(policy.bash && {
      bash: {
        ...policy.bash,
        ...(policy.bash.commandAllowlist && { commandAllowlist: [...policy.bash.commandAllowlist] }),
        ...(policy.bash.commandDenylist && { commandDenylist: [...policy.bash.commandDenylist] }),
      },
    }),
    ...(policy.mcp && {
      mcp: {
        allowedServers: [...policy.mcp.allowedServers],
        allowedTools: [...policy.mcp.allowedTools],
      },
    }),
    ...(policy.filesystem && { filesystem: { ...policy.filesystem } }),
    ...(policy.network && { network: { ...policy.network } }),
  };
}
