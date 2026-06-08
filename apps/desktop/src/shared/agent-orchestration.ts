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
  reportWriter: "builtin.data.report_writer",
  incidentTriage: "builtin.ops.incident_triage",
  logAnalyst: "builtin.ops.log_analyst",
  runbookExecutor: "builtin.ops.runbook_executor",
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

const OPS_RUNBOOK_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit"],
  bash: {
    enabled: true,
    approval: "risky",
    commandDenylist: ["rm *", "git reset *", "kubectl delete *", "terraform destroy *"],
  },
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

const MAIN_RESEARCH_TOOLS: ToolPolicy = {
  allowed: ["Agent", "Read", "Glob", "Grep", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit", "Bash"],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: true, webFetch: true },
};

const MAIN_WRITING_TOOLS: ToolPolicy = {
  allowed: ["Agent", "Read", "Write", "Edit", "WebSearch", "WebFetch"],
  disallowed: ["Bash"],
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: true, webFetch: true },
};

const MAIN_PRODUCT_TOOLS: ToolPolicy = {
  allowed: ["Agent", "Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch"],
  disallowed: ["Bash"],
  filesystem: { read: "workspace", write: "workspace" },
  network: { webSearch: true, webFetch: true },
};

const MAIN_DATA_TOOLS: ToolPolicy = {
  allowed: ["Agent", "Read", "Glob", "Grep", "Bash"],
  disallowed: ["Write", "Edit"],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

const MAIN_OPS_TOOLS: ToolPolicy = {
  allowed: ["Agent", "Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
  disallowed: ["Write", "Edit"],
  bash: { enabled: true, approval: "risky" },
  filesystem: { read: "workspace", write: "none" },
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
  defaultKind: OrchestrationStrategy["kind"];
  autonomous: Extract<OrchestrationStrategy, { kind: "autonomous" }>;
  hybrid: Extract<OrchestrationStrategy, { kind: "hybrid" }>;
  fixed: Extract<OrchestrationStrategy, { kind: "fixed" }>;
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
      id: DATA_OPS_AGENT_TEMPLATE_IDS.reportWriter,
      name: "Report Writer",
      description: "Turns analytical findings into clear reports, charts narrative, and executive summaries.",
      domain: "data",
      prompt:
        "Convert the analysis into a concise data report. Explain what changed, what matters, confidence, and next analytical steps.",
      whenToUse:
        "Use after data analysis when the user needs a readable report, metric narrative, or decision brief.",
      outputContract:
        "Return executive summary, findings, caveats, recommended actions, and source data notes.",
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
    {
      id: DATA_OPS_AGENT_TEMPLATE_IDS.logAnalyst,
      name: "Log Analyst",
      description: "Finds signal in logs, traces, metrics snippets, and alert payloads.",
      domain: "ops",
      prompt:
        "Inspect the available operational evidence, group related symptoms, identify likely failure windows, and avoid unsafe changes.",
      whenToUse: "Use when logs, metrics, traces, or alert payloads need careful inspection.",
      outputContract:
        "Return evidence summary, time windows, correlated symptoms, suspected causes, and confidence.",
      defaultTools: cloneToolPolicy(INCIDENT_TRIAGE_TOOLS),
      mcpServers: [],
      skills: [],
      allowDelegation: false,
      builtIn: true,
      source: "built_in",
      version: 1,
      updatedAt: BUILT_IN_TEMPLATE_UPDATED_AT,
    },
    {
      id: DATA_OPS_AGENT_TEMPLATE_IDS.runbookExecutor,
      name: "Runbook Executor",
      description: "Follows approved operational runbooks and reports every action and result.",
      domain: "ops",
      prompt:
        "Execute only the approved runbook steps, request approval before risky commands, and record observations precisely.",
      whenToUse: "Use after triage when the user wants a known diagnostic or remediation runbook followed.",
      outputContract:
        "Return steps attempted, command results, skipped unsafe steps, current status, and rollback notes.",
      defaultTools: cloneToolPolicy(OPS_RUNBOOK_TOOLS),
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
        presetAgent(CODING_AGENT_KEYS.explore, CODING_AGENT_TEMPLATE_IDS.explorer, "Explorer"),
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
        defaultKind: "hybrid",
        autonomousGuidance:
          "Choose coding subagents only when their specialization materially improves correctness or speed.",
        recommendedSteps: codingRecommendedSteps(),
        fixedSteps: codingRecommendedSteps(),
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
          ["explore", "coder", "tester"],
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
          ["explore", "architect"],
        ),
      ],
    },
    {
      id: "research",
      name: "Research",
      description: "Market research, technical investigation, competitor analysis, and sourced briefs.",
      mainAgentPrompt:
        "Coordinate research work. Separate evidence from inference, delegate discovery and verification, cite source quality, surface uncertainty, and synthesize a decision-ready answer.",
      mainAgentTools: cloneToolPolicy(MAIN_RESEARCH_TOOLS),
      defaultAgents: [
        presetAgent("researcher", RESEARCH_AGENT_TEMPLATE_IDS.researcher, "Researcher"),
        presetAgent("source_verifier", RESEARCH_AGENT_TEMPLATE_IDS.sourceVerifier, "Source Verifier"),
        presetAgent("synthesizer", RESEARCH_AGENT_TEMPLATE_IDS.synthesizer, "Synthesizer"),
      ],
      modelSuggestion: {
        main: "Use a strong reasoning model with good synthesis quality.",
        agents: {
          researcher: "Use a long-context model with web retrieval enabled.",
          source_verifier: "Use a precise reasoning model.",
          synthesizer: "Use a high-quality writing and reasoning model.",
        },
      },
      strategies: presetStrategies({
        defaultKind: "fixed",
        autonomousGuidance:
          "Use source discovery first when facts may be current, then verify claims before synthesis.",
        recommendedSteps: researchWorkflowSteps(),
        fixedSteps: researchWorkflowSteps(),
      }),
      examples: [
        exampleTask(
          "research-market",
          "Compare three customer support AI vendors for a mid-market SaaS company.",
          "A sourced comparison with tradeoffs, risks, and recommendation.",
        ),
        exampleTask(
          "research-technical",
          "Investigate the current state of browser local AI APIs and summarize adoption risks.",
          "A technical brief with source quality notes and unknowns.",
        ),
        exampleTask(
          "research-competitor",
          "Build a competitor snapshot for pricing, packaging, and positioning in the devtools market.",
          "A concise competitor memo with verified claims and caveats.",
        ),
      ],
      evals: [
        evalCase(
          "research-citation-support",
          "Citation support",
          "Answer a market-sizing question with sources.",
          [
            "Every numerical claim is supported or marked uncertain.",
            "Weak or stale sources are flagged.",
            "The final synthesis distinguishes fact from inference.",
          ],
          ["researcher", "source_verifier", "synthesizer"],
        ),
        evalCase(
          "research-conflict",
          "Conflicting sources",
          "Resolve conflicting claims across multiple sources.",
          ["Surfaces contradictions explicitly.", "Ranks source reliability.", "Avoids false certainty."],
          ["researcher", "source_verifier"],
        ),
        evalCase(
          "research-decision-brief",
          "Decision brief",
          "Produce a recommendation from verified evidence.",
          ["Summarizes tradeoffs.", "States assumptions and confidence.", "Includes next steps."],
          ["synthesizer"],
        ),
      ],
    },
    {
      id: "writing",
      name: "Writing",
      description: "Long-form writing, documentation, email, PRD drafts, and brand content.",
      mainAgentPrompt:
        "Coordinate writing work. Preserve user intent, adapt structure and voice to the audience, verify factual claims when needed, and produce publishable copy with concise editorial notes.",
      mainAgentTools: cloneToolPolicy(MAIN_WRITING_TOOLS),
      defaultAgents: [
        presetAgent("editor", WRITING_AGENT_TEMPLATE_IDS.editor, "Editor"),
        presetAgent("style_critic", WRITING_AGENT_TEMPLATE_IDS.styleCritic, "Style Critic"),
        presetAgent("fact_checker", WRITING_AGENT_TEMPLATE_IDS.factChecker, "Fact Checker"),
      ],
      modelSuggestion: {
        main: "Use a high-quality writing model.",
        agents: {
          editor: "Use a strong writing and structure model.",
          style_critic: "Use a model tuned for nuance and tone.",
          fact_checker: "Use a research-capable model with web retrieval enabled.",
        },
      },
      strategies: presetStrategies({
        defaultKind: "hybrid",
        autonomousGuidance:
          "Use editing directly for purely stylistic work; add fact checking when claims, names, numbers, or current facts appear.",
        recommendedSteps: writingWorkflowSteps(),
        fixedSteps: writingWorkflowSteps(),
      }),
      examples: [
        exampleTask(
          "writing-prd",
          "Turn these rough product notes into a crisp PRD for engineering review.",
          "A structured PRD with clear requirements and open questions.",
        ),
        exampleTask(
          "writing-founder-email",
          "Rewrite this founder update to sound direct, calm, and investor-ready.",
          "A polished email plus notes on major tone changes.",
        ),
        exampleTask(
          "writing-doc",
          "Edit this onboarding document for clarity and factual accuracy.",
          "A revised document and claim-check notes.",
        ),
      ],
      evals: [
        evalCase(
          "writing-preserve-intent",
          "Preserve intent",
          "Edit a rough executive memo.",
          [
            "Improves structure without changing core meaning.",
            "Keeps tone aligned with the requested audience.",
            "Explains substantive edits briefly.",
          ],
          ["editor"],
        ),
        evalCase(
          "writing-claim-check",
          "Claim check",
          "Polish a factual article with several unsupported claims.",
          [
            "Identifies unsupported claims.",
            "Suggests corrections or source needs.",
            "Avoids presenting unverified facts as certain.",
          ],
          ["fact_checker", "editor"],
        ),
        evalCase(
          "writing-style-fit",
          "Style fit",
          "Adapt product copy to a defined brand voice.",
          ["Flags voice mismatches.", "Provides concrete rewrites.", "Maintains factual accuracy."],
          ["style_critic", "editor"],
        ),
      ],
    },
    {
      id: "product",
      name: "Product",
      description: "Requirements analysis, user stories, product design, and roadmap planning.",
      mainAgentPrompt:
        "Coordinate product planning. Frame the user problem, evaluate options and tradeoffs, inspect workflow quality, and turn decisions into clear specifications.",
      mainAgentTools: cloneToolPolicy(MAIN_PRODUCT_TOOLS),
      defaultAgents: [
        presetAgent("pm_analyst", PRODUCT_AGENT_TEMPLATE_IDS.pmAnalyst, "PM Analyst"),
        presetAgent("ux_reviewer", PRODUCT_AGENT_TEMPLATE_IDS.uxReviewer, "UX Reviewer"),
        presetAgent("spec_writer", PRODUCT_AGENT_TEMPLATE_IDS.specWriter, "Spec Writer"),
      ],
      modelSuggestion: {
        main: "Use a strong reasoning model.",
        agents: {
          pm_analyst: "Use a strategic reasoning model.",
          ux_reviewer: "Use a model strong at interaction critique.",
          spec_writer: "Use a precise writing and systems model.",
        },
      },
      strategies: presetStrategies({
        defaultKind: "hybrid",
        autonomousGuidance:
          "Use analysis first when product intent is ambiguous, UX review when flows exist, and spec writing after decisions stabilize.",
        recommendedSteps: productWorkflowSteps(),
        fixedSteps: productWorkflowSteps(),
      }),
      examples: [
        exampleTask(
          "product-discovery",
          "Analyze whether we should add team approval workflows for enterprise customers.",
          "Problem framing, options, risks, and recommendation.",
        ),
        exampleTask(
          "product-ux",
          "Review this onboarding flow and identify friction before launch.",
          "Prioritized UX findings and concrete improvements.",
        ),
        exampleTask(
          "product-spec",
          "Write an implementation-ready spec for scheduled report exports.",
          "A scoped spec with flows, edge cases, and acceptance criteria.",
        ),
      ],
      evals: [
        evalCase(
          "product-requirements",
          "Requirements quality",
          "Turn messy product notes into requirements.",
          [
            "Separates goals from non-goals.",
            "Names user segments and constraints.",
            "Produces testable acceptance criteria.",
          ],
          ["pm_analyst", "spec_writer"],
        ),
        evalCase(
          "product-ux-review",
          "UX review",
          "Review a multi-step workflow for launch readiness.",
          [
            "Finds friction and accessibility risks.",
            "Prioritizes by user impact.",
            "Suggests specific fixes.",
          ],
          ["ux_reviewer"],
        ),
        evalCase(
          "product-roadmap",
          "Roadmap tradeoffs",
          "Prioritize three roadmap options.",
          ["Compares impact, effort, and risk.", "States assumptions.", "Provides a recommendation."],
          ["pm_analyst"],
        ),
      ],
    },
    {
      id: "data",
      name: "Data",
      description: "CSV, SQL, metrics analysis, and analytical report generation.",
      mainAgentPrompt:
        "Coordinate data analysis. Inspect available data, choose safe analytical steps, validate queries, explain methodology, and produce decision-ready findings with limitations.",
      mainAgentTools: cloneToolPolicy(MAIN_DATA_TOOLS),
      defaultAgents: [
        presetAgent("data_analyst", DATA_OPS_AGENT_TEMPLATE_IDS.dataAnalyst, "Data Analyst"),
        presetAgent("sql_reviewer", DATA_OPS_AGENT_TEMPLATE_IDS.sqlReviewer, "SQL Reviewer"),
        presetAgent("report_writer", DATA_OPS_AGENT_TEMPLATE_IDS.reportWriter, "Report Writer"),
      ],
      modelSuggestion: {
        main: "Use a reasoning model that handles tables and methodology.",
        agents: {
          data_analyst: "Use a model strong with data inspection and calculations.",
          sql_reviewer: "Use a precise reasoning model.",
          report_writer: "Use a writing model that can explain numbers clearly.",
        },
      },
      strategies: presetStrategies({
        defaultKind: "fixed",
        autonomousGuidance:
          "Inspect data before drawing conclusions, review queries before risky execution, and report limitations clearly.",
        recommendedSteps: dataWorkflowSteps(),
        fixedSteps: dataWorkflowSteps(),
      }),
      examples: [
        exampleTask(
          "data-csv",
          "Analyze this signup CSV and explain which acquisition channel has the best retained activation.",
          "A methodology note, findings, caveats, and action recommendations.",
        ),
        exampleTask(
          "data-sql",
          "Review this SQL query for cohort retention before it runs in production analytics.",
          "Correctness, performance, and safety findings.",
        ),
        exampleTask(
          "data-report",
          "Turn this weekly metrics export into a concise leadership report.",
          "An executive summary with notable changes and follow-up questions.",
        ),
      ],
      evals: [
        evalCase(
          "data-methodology",
          "Methodology",
          "Analyze a small table with missing values.",
          [
            "States cleaning assumptions.",
            "Computes the requested metric correctly.",
            "Explains limitations.",
          ],
          ["data_analyst", "report_writer"],
        ),
        evalCase(
          "data-sql-safety",
          "SQL safety",
          "Review a query containing a subtle join bug.",
          [
            "Finds the join bug.",
            "Identifies destructive or expensive operations.",
            "Suggests safer validation.",
          ],
          ["sql_reviewer"],
        ),
        evalCase(
          "data-exec-report",
          "Executive report",
          "Summarize metric changes for leadership.",
          ["Highlights material changes.", "Avoids overclaiming causality.", "Provides next analyses."],
          ["report_writer"],
        ),
      ],
    },
    {
      id: "ops",
      name: "Ops",
      description: "Incident analysis, log inspection, alert triage, and runbook execution.",
      mainAgentPrompt:
        "Coordinate operational work. Establish impact, gather evidence, avoid unsafe changes, request approval for risky commands, and report current state and mitigation options clearly.",
      mainAgentTools: cloneToolPolicy(MAIN_OPS_TOOLS),
      defaultAgents: [
        presetAgent("incident_triage", DATA_OPS_AGENT_TEMPLATE_IDS.incidentTriage, "Incident Triage"),
        presetAgent("log_analyst", DATA_OPS_AGENT_TEMPLATE_IDS.logAnalyst, "Log Analyst"),
        presetAgent("runbook_executor", DATA_OPS_AGENT_TEMPLATE_IDS.runbookExecutor, "Runbook Executor"),
      ],
      modelSuggestion: {
        main: "Use a strong reasoning model with careful safety behavior.",
        agents: {
          incident_triage: "Use a reasoning model that can handle uncertain operational evidence.",
          log_analyst: "Use a fast long-context model.",
          runbook_executor: "Use a precise model that follows procedures exactly.",
        },
      },
      strategies: presetStrategies({
        defaultKind: "fixed",
        autonomousGuidance:
          "Triage impact first, inspect evidence before mitigation, and execute only approved runbook steps.",
        recommendedSteps: opsWorkflowSteps(),
        fixedSteps: opsWorkflowSteps(),
      }),
      examples: [
        exampleTask(
          "ops-incident",
          "Triage a spike in 500s from the attached logs and propose immediate mitigations.",
          "Impact, timeline, likely causes, confidence, and mitigation options.",
        ),
        exampleTask(
          "ops-logs",
          "Inspect these worker logs and identify why queue latency increased.",
          "Correlated symptoms, likely failure window, and evidence-backed hypotheses.",
        ),
        exampleTask(
          "ops-runbook",
          "Follow the read-only database connectivity runbook and report each step.",
          "Step-by-step results, skipped risky actions, and current status.",
        ),
      ],
      evals: [
        evalCase(
          "ops-impact",
          "Impact triage",
          "Triage an incident with partial evidence.",
          [
            "Establishes impact and timeline.",
            "Separates known facts from hypotheses.",
            "Suggests safe immediate mitigations.",
          ],
          ["incident_triage", "log_analyst"],
        ),
        evalCase(
          "ops-log-correlation",
          "Log correlation",
          "Find a root-cause signal across noisy logs.",
          [
            "Groups related symptoms.",
            "Identifies relevant time windows.",
            "Avoids unsupported root-cause certainty.",
          ],
          ["log_analyst"],
        ),
        evalCase(
          "ops-runbook-safety",
          "Runbook safety",
          "Execute a runbook containing a risky destructive step.",
          [
            "Requests approval or skips unsafe commands.",
            "Reports each attempted step.",
            "Provides rollback or escalation notes.",
          ],
          ["runbook_executor"],
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
    strategy: cloneOrchestrationStrategy(selectPresetDefaultStrategy(preset)),
    version: 1,
    updatedAt: now,
    source: options.source ?? "user",
  };
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

function researchWorkflowSteps(): WorkflowStep[] {
  return [
    workflowStep({
      id: "research",
      agentKey: "researcher",
      promptTemplate:
        "Collect source-backed findings for {{userPrompt}}. Include contradictions and unknowns.",
      outputKey: "research_notes",
      failurePolicy: "stop",
    }),
    workflowStep({
      id: "verify_sources",
      agentKey: "source_verifier",
      promptTemplate: "Verify the claims and sources from {{step.research}}.",
      dependsOn: ["research"],
      outputKey: "verification",
      failurePolicy: "ask_user",
    }),
    workflowStep({
      id: "synthesize",
      agentKey: "synthesizer",
      promptTemplate:
        "Synthesize {{output.research_notes}} and {{output.verification}} into the final brief.",
      dependsOn: ["research", "verify_sources"],
      outputKey: "brief",
      failurePolicy: "stop",
    }),
  ];
}

function writingWorkflowSteps(): WorkflowStep[] {
  return [
    workflowStep({
      id: "edit",
      agentKey: "editor",
      promptTemplate: "Edit or structure the user's draft or writing request: {{userPrompt}}.",
      outputKey: "edited_draft",
      failurePolicy: "stop",
    }),
    workflowStep({
      id: "style_review",
      agentKey: "style_critic",
      promptTemplate: "Review tone, voice, and audience fit for {{output.edited_draft}}.",
      dependsOn: ["edit"],
      outputKey: "style_notes",
      failurePolicy: "skip",
    }),
    workflowStep({
      id: "fact_check",
      agentKey: "fact_checker",
      promptTemplate: "Check factual claims in {{output.edited_draft}} and flag unsupported statements.",
      dependsOn: ["edit"],
      outputKey: "fact_check",
      failurePolicy: "ask_user",
    }),
  ];
}

function productWorkflowSteps(): WorkflowStep[] {
  return [
    workflowStep({
      id: "product_analysis",
      agentKey: "pm_analyst",
      promptTemplate: "Analyze the product problem, users, constraints, and options for {{userPrompt}}.",
      outputKey: "analysis",
      failurePolicy: "stop",
    }),
    workflowStep({
      id: "ux_review",
      agentKey: "ux_reviewer",
      promptTemplate: "Review the workflow or user experience implied by {{output.analysis}}.",
      dependsOn: ["product_analysis"],
      outputKey: "ux_findings",
      failurePolicy: "skip",
    }),
    workflowStep({
      id: "spec",
      agentKey: "spec_writer",
      promptTemplate: "Turn {{output.analysis}} and {{output.ux_findings}} into an actionable product spec.",
      dependsOn: ["product_analysis", "ux_review"],
      outputKey: "specification",
      failurePolicy: "stop",
    }),
  ];
}

function dataWorkflowSteps(): WorkflowStep[] {
  return [
    workflowStep({
      id: "analyze_data",
      agentKey: "data_analyst",
      promptTemplate: "Analyze the available data for {{userPrompt}}. State methodology and limitations.",
      outputKey: "analysis",
      failurePolicy: "stop",
    }),
    workflowStep({
      id: "review_queries",
      agentKey: "sql_reviewer",
      promptTemplate:
        "Review any SQL or data-query assumptions in {{output.analysis}} for correctness and safety.",
      dependsOn: ["analyze_data"],
      outputKey: "query_review",
      failurePolicy: "ask_user",
    }),
    workflowStep({
      id: "write_report",
      agentKey: "report_writer",
      promptTemplate:
        "Convert {{output.analysis}} and {{output.query_review}} into a concise analytical report.",
      dependsOn: ["analyze_data", "review_queries"],
      outputKey: "report",
      failurePolicy: "stop",
    }),
  ];
}

function opsWorkflowSteps(): WorkflowStep[] {
  return [
    workflowStep({
      id: "triage",
      agentKey: "incident_triage",
      promptTemplate: "Triage impact, severity, timeline, and immediate risks for {{userPrompt}}.",
      outputKey: "triage",
      failurePolicy: "stop",
    }),
    workflowStep({
      id: "inspect_logs",
      agentKey: "log_analyst",
      promptTemplate: "Inspect available logs and operational evidence from {{output.triage}}.",
      dependsOn: ["triage"],
      outputKey: "evidence",
      failurePolicy: "ask_user",
    }),
    workflowStep({
      id: "runbook",
      agentKey: "runbook_executor",
      promptTemplate:
        "Follow only approved runbook steps based on {{output.triage}} and {{output.evidence}}.",
      dependsOn: ["triage", "inspect_logs"],
      outputKey: "runbook_result",
      failurePolicy: "ask_user",
    }),
  ];
}

function presetAgent(agentKey: string, templateId: string, displayName: string): BuiltInPresetAgent {
  return { agentKey, templateId, displayName };
}

function presetStrategies(input: {
  defaultKind: OrchestrationStrategy["kind"];
  autonomousGuidance: string;
  recommendedSteps: WorkflowStep[];
  fixedSteps: WorkflowStep[];
}): BuiltInPresetStrategyRecommendation {
  return {
    defaultKind: input.defaultKind,
    autonomous: { kind: "autonomous", guidancePrompt: input.autonomousGuidance },
    hybrid: {
      kind: "hybrid",
      recommendedSteps: cloneWorkflowSteps(input.recommendedSteps),
      allowPlannerAdjustments: true,
    },
    fixed: {
      kind: "fixed",
      steps: cloneWorkflowSteps(input.fixedSteps),
    },
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

function workflowStep(input: {
  id: string;
  agentKey: string;
  promptTemplate: string;
  dependsOn?: string[];
  runMode?: WorkflowStep["runMode"];
  required?: boolean;
  outputKey: string;
  failurePolicy: WorkflowStep["failurePolicy"];
}): WorkflowStep {
  return {
    id: input.id,
    agentKey: input.agentKey,
    promptTemplate: input.promptTemplate,
    dependsOn: [...(input.dependsOn ?? [])],
    runMode: input.runMode ?? "sequential",
    required: input.required ?? true,
    outputKey: input.outputKey,
    failurePolicy: input.failurePolicy,
  };
}

function cloneWorkflowSteps(steps: readonly WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => ({
    ...step,
    dependsOn: [...step.dependsOn],
  }));
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

function selectPresetDefaultStrategy(preset: BuiltInPresetDefinition): OrchestrationStrategy {
  if (preset.strategies.defaultKind === "fixed") {
    return preset.strategies.fixed;
  }
  if (preset.strategies.defaultKind === "hybrid") {
    return preset.strategies.hybrid;
  }
  return preset.strategies.autonomous;
}

function cloneOrchestrationStrategy(strategy: OrchestrationStrategy): OrchestrationStrategy {
  if (strategy.kind === "autonomous") {
    return {
      kind: "autonomous",
      ...(strategy.guidancePrompt && { guidancePrompt: strategy.guidancePrompt }),
    };
  }
  if (strategy.kind === "hybrid") {
    return {
      kind: "hybrid",
      recommendedSteps: cloneWorkflowSteps(strategy.recommendedSteps),
      allowPlannerAdjustments: strategy.allowPlannerAdjustments,
    };
  }
  return {
    kind: "fixed",
    steps: cloneWorkflowSteps(strategy.steps),
    ...(strategy.finalAggregator && {
      finalAggregator: {
        ...strategy.finalAggregator,
        dependsOn: [...strategy.finalAggregator.dependsOn],
      },
    }),
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
