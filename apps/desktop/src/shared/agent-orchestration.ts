import type { UpstreamApiCompat } from "./api-compat";
import type {
  ModelsDevMapping,
  OrchestrationModeSetting,
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
}

export interface ToolPolicy {
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

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  domain: AgentDomain;
  prompt: string;
  whenToUse: string;
  outputContract?: string;
  defaultTools: ToolPolicy;
  defaultModelRef?: ModelRef;
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
  modelRef: ModelRef;
  tools: ToolPolicy;
  mcpServers: string[];
  skills: string[];
  promptOverride?: string;
  enabled: boolean;
}

export interface WorkflowStep {
  id: string;
  agentKey: string;
  promptTemplate: string;
  dependsOn: string[];
  runMode: "sequential" | "parallel";
  required: boolean;
  outputKey: string;
  failurePolicy: "stop" | "retry" | "skip" | "ask_user";
}

export type OrchestrationStrategy =
  | { kind: "autonomous"; guidancePrompt?: string }
  | { kind: "hybrid"; recommendedSteps: WorkflowStep[]; allowPlannerAdjustments: boolean }
  | { kind: "fixed"; steps: WorkflowStep[]; finalAggregator?: WorkflowStep };

export interface OrchestrationProfile {
  id: string;
  name: string;
  preset: AgentDomain;
  mainAgent: MainAgentConfig;
  agents: AgentInstanceConfig[];
  strategy: OrchestrationStrategy;
  version: number;
  updatedAt: string;
  source: AgentConfigSource;
  sourceRouteProfileId?: string;
}

export const CODING_AGENT_TEMPLATE_IDS = {
  explorer: "builtin.coding.explorer",
  architect: "builtin.coding.architect",
  coder: "builtin.coding.coder",
  reviewer: "builtin.coding.reviewer",
  tester: "builtin.coding.tester",
} as const;

export const RESEARCH_AGENT_TEMPLATE_IDS = {
  researcher: "builtin.research.researcher",
  sourceVerifier: "builtin.research.source_verifier",
  synthesizer: "builtin.research.synthesizer",
} as const;

export const WRITING_AGENT_TEMPLATE_IDS = {
  editor: "builtin.writing.editor",
  styleCritic: "builtin.writing.style_critic",
  factChecker: "builtin.writing.fact_checker",
} as const;

export const PRODUCT_AGENT_TEMPLATE_IDS = {
  pmAnalyst: "builtin.product.pm_analyst",
  uxReviewer: "builtin.product.ux_reviewer",
  specWriter: "builtin.product.spec_writer",
} as const;

export const DATA_OPS_AGENT_TEMPLATE_IDS = {
  dataAnalyst: "builtin.data.data_analyst",
  sqlReviewer: "builtin.data.sql_reviewer",
  incidentTriage: "builtin.ops.incident_triage",
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

const READ_ONLY_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit"],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

const READ_ONLY_BASH_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit"],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

const RESEARCH_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit", "Bash"],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

const WRITING_TOOLS: ToolPolicy = {
  allowed: ["Read", "Write", "Edit", "WebSearch", "WebFetch"],
  disallowed: ["Bash"],
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: true, webFetch: true },
};

const PRODUCT_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch"],
  disallowed: ["Bash"],
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: true, webFetch: true },
};

const DATA_ANALYSIS_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "Bash"],
  disallowed: ["Write", "Edit"],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

const INCIDENT_TRIAGE_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit"],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

const CODER_TOOLS: ToolPolicy = {
  allowed: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
  disallowed: [],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: false, webFetch: false },
};

const MAIN_CODING_TOOLS: ToolPolicy = {
  allowed: ["Agent", "Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebSearch", "WebFetch"],
  disallowed: [],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: true, webFetch: true },
};

export function createBuiltInAgentTemplates(): AgentTemplate[] {
  return [
    {
      id: CODING_AGENT_TEMPLATE_IDS.explorer,
      name: "Explorer",
      description: "Read-only context discovery agent for coding tasks.",
      domain: "coding",
      prompt: "Explore the relevant workspace context and report concise findings. Do not edit files.",
      whenToUse: "Use before planning or answering when broad codebase context is needed.",
      outputContract: "Return relevant files, facts, risks, and open questions.",
      defaultTools: cloneToolPolicy(READ_ONLY_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
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
      defaultTools: cloneToolPolicy(READ_ONLY_TOOLS),
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
      description: "Focused implementation agent for coding tasks.",
      domain: "coding",
      prompt:
        "Implement the assigned subtask only, verify the narrowest useful scope, and report changed files.",
      whenToUse: "Use after the task scope is clear and code edits are required.",
      outputContract: "Return files changed, implementation summary, verification result, and blockers.",
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
      prompt: "Review only this session's changes, classify issues by severity, and do not implement fixes.",
      whenToUse: "Use after implementation when correctness, safety, or regression risk is meaningful.",
      outputContract: "Return P0/P1/P2 sections and a PASS or BLOCKERS verdict.",
      defaultTools: cloneToolPolicy(READ_ONLY_BASH_TOOLS),
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
      prompt: "Run the narrowest useful verification for the completed work and report failures clearly.",
      whenToUse: "Use after implementation and review when automated verification is useful.",
      outputContract: "Return commands run, results, and a PASS or FAIL verdict.",
      defaultTools: cloneToolPolicy(READ_ONLY_BASH_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: RESEARCH_AGENT_TEMPLATE_IDS.researcher,
      name: "Researcher",
      description: "Collects relevant evidence, sources, and competing views for research tasks.",
      domain: "research",
      prompt:
        "Research the requested topic broadly, collect credible sources, and separate facts from uncertainty.",
      whenToUse: "Use when a task needs external facts, background, market context, or source discovery.",
      outputContract: "Return key findings, source notes, confidence, contradictions, and open questions.",
      defaultTools: cloneToolPolicy(RESEARCH_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: RESEARCH_AGENT_TEMPLATE_IDS.sourceVerifier,
      name: "Source Verifier",
      description: "Checks source quality, citation accuracy, and claim support.",
      domain: "research",
      prompt: "Verify whether the provided claims are supported by reliable sources and flag weak evidence.",
      whenToUse: "Use before finalizing research, strategy, factual writing, or sourced recommendations.",
      outputContract: "Return verified claims, unsupported claims, source quality notes, and risk level.",
      defaultTools: cloneToolPolicy(RESEARCH_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: RESEARCH_AGENT_TEMPLATE_IDS.synthesizer,
      name: "Synthesizer",
      description: "Turns research material into a clear answer, brief, or decision memo.",
      domain: "research",
      prompt: "Synthesize the provided findings into a clear, balanced response with caveats and next steps.",
      whenToUse: "Use after discovery and verification when the user needs a coherent conclusion.",
      outputContract: "Return a concise synthesis, assumptions, tradeoffs, and recommended next actions.",
      defaultTools: cloneToolPolicy(RESEARCH_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: WRITING_AGENT_TEMPLATE_IDS.editor,
      name: "Editor",
      description: "Improves structure, clarity, and flow for writing tasks.",
      domain: "writing",
      prompt: "Edit the draft for clarity, structure, and audience fit while preserving the author's intent.",
      whenToUse: "Use when a draft exists and needs stronger organization, readability, or polish.",
      outputContract: "Return the revised draft plus brief notes on substantive changes.",
      defaultTools: cloneToolPolicy(WRITING_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: WRITING_AGENT_TEMPLATE_IDS.styleCritic,
      name: "Style Critic",
      description: "Reviews tone, voice, consistency, and audience fit.",
      domain: "writing",
      prompt:
        "Critique the writing style, identify mismatches with the target audience, and suggest improvements.",
      whenToUse: "Use before publication or handoff when tone and brand fit matter.",
      outputContract: "Return style issues, examples, severity, and concrete rewrite suggestions.",
      defaultTools: cloneToolPolicy(WRITING_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: WRITING_AGENT_TEMPLATE_IDS.factChecker,
      name: "Fact Checker",
      description: "Checks factual claims in writing and flags unsupported statements.",
      domain: "writing",
      prompt: "Check factual claims in the draft, verify support, and distinguish facts from interpretation.",
      whenToUse: "Use for factual articles, reports, product copy, or any writing with external claims.",
      outputContract: "Return checked claims, corrections, missing sources, and confidence levels.",
      defaultTools: cloneToolPolicy(RESEARCH_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: PRODUCT_AGENT_TEMPLATE_IDS.pmAnalyst,
      name: "PM Analyst",
      description: "Analyzes product opportunities, requirements, users, and tradeoffs.",
      domain: "product",
      prompt: "Analyze the product problem, user segments, constraints, risks, and decision tradeoffs.",
      whenToUse: "Use for product discovery, prioritization, roadmap, or requirement analysis.",
      outputContract: "Return problem framing, user needs, options, risks, and recommendation.",
      defaultTools: cloneToolPolicy(PRODUCT_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: PRODUCT_AGENT_TEMPLATE_IDS.uxReviewer,
      name: "UX Reviewer",
      description: "Reviews workflows, usability, copy, and interaction quality.",
      domain: "product",
      prompt: "Review the user experience for clarity, friction, accessibility, and workflow completeness.",
      whenToUse: "Use for UX critique, product UI review, onboarding, and workflow validation.",
      outputContract: "Return UX findings, severity, affected users, and concrete improvement ideas.",
      defaultTools: cloneToolPolicy(PRODUCT_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: PRODUCT_AGENT_TEMPLATE_IDS.specWriter,
      name: "Spec Writer",
      description: "Converts product intent into implementation-ready specifications.",
      domain: "product",
      prompt:
        "Write a precise product specification with scope, behavior, edge cases, and acceptance criteria.",
      whenToUse: "Use after product direction is clear and the team needs an actionable spec.",
      outputContract: "Return goals, requirements, non-goals, flows, edge cases, and acceptance criteria.",
      defaultTools: cloneToolPolicy(PRODUCT_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: DATA_OPS_AGENT_TEMPLATE_IDS.dataAnalyst,
      name: "Data Analyst",
      description: "Reads data artifacts, computes summaries, and explains analytical findings.",
      domain: "data",
      prompt:
        "Analyze the available data, explain methodology, surface patterns, and state limitations clearly.",
      whenToUse: "Use for spreadsheets, logs, metrics, exploratory analysis, and reporting.",
      outputContract: "Return method, findings, caveats, and suggested follow-up analysis.",
      defaultTools: cloneToolPolicy(DATA_ANALYSIS_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: DATA_OPS_AGENT_TEMPLATE_IDS.sqlReviewer,
      name: "SQL Reviewer",
      description: "Reviews SQL for correctness, performance, and data safety.",
      domain: "data",
      prompt:
        "Review SQL or data queries for correctness, edge cases, performance, and destructive behavior.",
      whenToUse: "Use before running or shipping SQL, analytics queries, or schema-affecting statements.",
      outputContract: "Return issues, risk level, safer alternatives, and verification suggestions.",
      defaultTools: cloneToolPolicy(DATA_ANALYSIS_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: DATA_OPS_AGENT_TEMPLATE_IDS.incidentTriage,
      name: "Incident Triage",
      description: "Investigates incidents, logs, symptoms, impact, and likely causes.",
      domain: "ops",
      prompt:
        "Triage the incident, establish impact, gather evidence, propose mitigations, and avoid unsafe changes.",
      whenToUse: "Use for production incidents, operational failures, alert analysis, or debugging reports.",
      outputContract: "Return timeline, impact, suspected causes, mitigation options, and confidence.",
      defaultTools: cloneToolPolicy(INCIDENT_TRIAGE_TOOLS),
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

export function buildCodingOrchestrationProfileFromRouteProfile(
  routeProfile: RouteProfileView,
  options: {
    subagentEnabled?: Partial<SubagentEnabledSettings>;
    orchestrationMode?: OrchestrationModeSetting;
  } = {},
): OrchestrationProfile {
  const routeByRole = new Map(routeProfile.routes.map((route) => [route.role, route]));
  const plannerRoute = requireRoute(routeByRole, "planner", routeProfile.id);
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
    agents: [
      buildCodingAgentInstance(
        CODING_AGENT_KEYS.explore,
        CODING_AGENT_TEMPLATE_IDS.explorer,
        requireRoute(routeByRole, "explore", routeProfile.id),
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
    strategy: codingStrategyFromMode(options.orchestrationMode),
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
    orchestrationMode?: OrchestrationModeSetting;
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

function subagentEnabledFor(
  key: keyof SubagentEnabledSettings,
  settings: Partial<SubagentEnabledSettings> | undefined,
): boolean {
  return settings?.[key] ?? true;
}

function codingStrategyFromMode(mode: OrchestrationModeSetting | undefined): OrchestrationStrategy {
  if (mode === "autonomous") {
    return {
      kind: "autonomous",
      guidancePrompt:
        "Use the available coding subagents only when their specialization improves the result.",
    };
  }
  if (mode === "manual") {
    return {
      kind: "fixed",
      steps: codingRecommendedSteps(),
    };
  }
  return {
    kind: "hybrid",
    recommendedSteps: codingRecommendedSteps(),
    allowPlannerAdjustments: true,
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

function codingRecommendedSteps(): WorkflowStep[] {
  return [
    {
      id: "explore",
      agentKey: CODING_AGENT_KEYS.explore,
      promptTemplate: "Explore the workspace context needed for the user request.",
      dependsOn: [],
      runMode: "sequential",
      required: false,
      outputKey: "exploration",
      failurePolicy: "ask_user",
    },
    {
      id: "architect",
      agentKey: CODING_AGENT_KEYS.architect,
      promptTemplate: "Turn the approved direction into clear implementation tasks.",
      dependsOn: ["explore"],
      runMode: "sequential",
      required: false,
      outputKey: "tasks",
      failurePolicy: "skip",
    },
    {
      id: "coder",
      agentKey: CODING_AGENT_KEYS.coder,
      promptTemplate: "Implement the assigned task and verify the narrowest useful scope.",
      dependsOn: ["architect"],
      runMode: "parallel",
      required: true,
      outputKey: "implementation",
      failurePolicy: "stop",
    },
    {
      id: "reviewer",
      agentKey: CODING_AGENT_KEYS.reviewer,
      promptTemplate: "Review this session's changed files for blockers.",
      dependsOn: ["coder"],
      runMode: "sequential",
      required: false,
      outputKey: "review",
      failurePolicy: "ask_user",
    },
    {
      id: "tester",
      agentKey: CODING_AGENT_KEYS.tester,
      promptTemplate: "Run final verification for the completed coding task.",
      dependsOn: ["reviewer"],
      runMode: "sequential",
      required: false,
      outputKey: "verification",
      failurePolicy: "ask_user",
    },
  ];
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
