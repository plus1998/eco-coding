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
  mcpTools: string;
  bashApproval: NonNullable<ToolPolicy["bash"]>["approval"];
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  filesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  filesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  networkWebSearch: boolean;
  networkWebFetch: boolean;
  skills: string;
}

export interface AgentProfileWorkflowStepFormState {
  id: string;
  agentKey: string;
  promptTemplate: string;
  dependsOn: string;
  runMode: WorkflowStep["runMode"];
  required: boolean;
  outputKey: string;
  failurePolicy: WorkflowStep["failurePolicy"];
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
  mainMcpServers: string;
  mainMcpTools: string;
  mainBashApproval: NonNullable<ToolPolicy["bash"]>["approval"];
  mainBashCommandAllowlist: string;
  mainBashCommandDenylist: string;
  mainFilesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  mainFilesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  mainNetworkWebSearch: boolean;
  mainNetworkWebFetch: boolean;
  mainSkills: string;
  strategyKind: OrchestrationStrategy["kind"];
  guidancePrompt: string;
  allowPlannerAdjustments: boolean;
  workflowSteps: AgentProfileWorkflowStepFormState[];
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
  bashApproval: NonNullable<ToolPolicy["bash"]>["approval"];
  bashCommandAllowlist: string;
  bashCommandDenylist: string;
  filesystemRead: NonNullable<ToolPolicy["filesystem"]>["read"];
  filesystemWrite: NonNullable<ToolPolicy["filesystem"]>["write"];
  networkWebSearch: boolean;
  networkWebFetch: boolean;
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
    mainMcpServers: "",
    mainMcpTools: "",
    mainBashApproval: "risky",
    mainBashCommandAllowlist: "",
    mainBashCommandDenylist: "",
    mainFilesystemRead: "workspace",
    mainFilesystemWrite: "none",
    mainNetworkWebSearch: true,
    mainNetworkWebFetch: true,
    mainSkills: "",
    strategyKind: "autonomous",
    guidancePrompt: "Choose agents autonomously based on the user's task and the available agent roster.",
    allowPlannerAdjustments: true,
    workflowSteps: [],
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
    ...mainToolPolicyFormFields(profile.mainAgent.tools),
    mainSkills: formatList(profile.mainAgent.skills),
    strategyKind: profile.strategy.kind,
    guidancePrompt: strategyGuidance(profile.strategy),
    allowPlannerAdjustments:
      profile.strategy.kind === "hybrid" ? profile.strategy.allowPlannerAdjustments : true,
    workflowSteps: workflowStepFormsFromStrategy(profile.strategy),
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
      ...toolPolicyFormFields(agent.tools, agent.mcpServers),
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
    ...toolPolicyFormFields(template.defaultTools, template.mcpServers),
    skills: formatList(template.skills),
  };
}

export function createProfileWorkflowStepFormFromAgent(
  agent: Pick<AgentProfileAgentFormState, "agentKey" | "displayName">,
  options: {
    existingStepIds?: readonly string[];
    previousStepId?: string;
  } = {},
): AgentProfileWorkflowStepFormState {
  const id = createUniqueStepId(sanitizeStepId(agent.agentKey), options.existingStepIds ?? []);
  return {
    id,
    agentKey: agent.agentKey,
    promptTemplate: `Run the ${agent.displayName.trim() || agent.agentKey} step for {{userPrompt}}.`,
    dependsOn: options.previousStepId ?? "",
    runMode: "sequential",
    required: true,
    outputKey: `${id}_output`,
    failurePolicy: options.previousStepId ? "ask_user" : "stop",
  };
}

export function createWorkflowStepFormsFromAgents(
  agents: readonly Pick<AgentProfileAgentFormState, "agentKey" | "displayName" | "enabled">[],
  existingSteps: readonly AgentProfileWorkflowStepFormState[] = [],
): AgentProfileWorkflowStepFormState[] {
  const existingByAgent = new Map(existingSteps.map((step) => [step.agentKey.trim(), step]));
  const stepIds = new Set(existingSteps.map((step) => step.id.trim()).filter(Boolean));
  let previousStepId: string | undefined;
  return agents
    .filter((agent) => agent.enabled)
    .map((agent) => {
      const existingStep = existingByAgent.get(agent.agentKey.trim());
      if (existingStep) {
        previousStepId = existingStep.id.trim();
        return { ...existingStep };
      }
      const step = createProfileWorkflowStepFormFromAgent(agent, {
        existingStepIds: [...stepIds],
        ...(previousStepId ? { previousStepId } : {}),
      });
      stepIds.add(step.id);
      previousStepId = step.id;
      return step;
    });
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
      tools: buildToolPolicyFromFormFields(
        existingAgent?.tools ?? template.defaultTools,
        agentForm.allowedTools,
        agentForm.disallowedTools,
        {
          mcpServers: agentForm.mcpServers,
          mcpTools: agentForm.mcpTools,
          bashApproval: agentForm.bashApproval,
          bashCommandAllowlist: agentForm.bashCommandAllowlist,
          bashCommandDenylist: agentForm.bashCommandDenylist,
          filesystemRead: agentForm.filesystemRead,
          filesystemWrite: agentForm.filesystemWrite,
          networkWebSearch: agentForm.networkWebSearch,
          networkWebFetch: agentForm.networkWebFetch,
        },
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
      tools: buildToolPolicyFromFormFields(
        options.existing?.mainAgent.tools ?? emptyToolPolicy(),
        form.mainAllowedTools,
        form.mainDisallowedTools,
        {
          mcpServers: form.mainMcpServers,
          mcpTools: form.mainMcpTools,
          bashApproval: form.mainBashApproval,
          bashCommandAllowlist: form.mainBashCommandAllowlist,
          bashCommandDenylist: form.mainBashCommandDenylist,
          filesystemRead: form.mainFilesystemRead,
          filesystemWrite: form.mainFilesystemWrite,
          networkWebSearch: form.mainNetworkWebSearch,
          networkWebFetch: form.mainNetworkWebFetch,
        },
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
  const steps =
    form.workflowSteps.length > 0
      ? buildStepsFromWorkflowForm(form.workflowSteps, agents)
      : buildStepsFromAgents(agents, existing);
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

function workflowStepFormsFromStrategy(strategy: OrchestrationStrategy): AgentProfileWorkflowStepFormState[] {
  const steps =
    strategy.kind === "fixed" ? strategy.steps : strategy.kind === "hybrid" ? strategy.recommendedSteps : [];
  return steps.map((step) => ({
    id: step.id,
    agentKey: step.agentKey,
    promptTemplate: step.promptTemplate,
    dependsOn: formatList(step.dependsOn),
    runMode: step.runMode,
    required: step.required,
    outputKey: step.outputKey,
    failurePolicy: step.failurePolicy,
  }));
}

function buildStepsFromWorkflowForm(
  stepForms: readonly AgentProfileWorkflowStepFormState[],
  agents: readonly { agentKey: string; enabled: boolean }[],
): WorkflowStep[] {
  const enabledAgentKeys = new Set(agents.filter((agent) => agent.enabled).map((agent) => agent.agentKey));
  const stepIds = new Set<string>();
  const steps = stepForms.map((stepForm) => {
    const id = normalizeStepId(stepForm.id);
    if (stepIds.has(id)) {
      throw new Error(`Workflow step id 重复：${id}`);
    }
    stepIds.add(id);
    const agentKey = normalizeAgentKey(stepForm.agentKey);
    if (!enabledAgentKeys.has(agentKey)) {
      throw new Error(`Workflow step ${id} 引用了未启用的 Agent：${agentKey}`);
    }
    const outputKey = normalizeStepOutputKey(stepForm.outputKey);
    const promptTemplate = stepForm.promptTemplate.trim();
    if (!promptTemplate) {
      throw new Error(`Workflow step ${id} 的提示词不能为空。`);
    }
    return {
      id,
      agentKey,
      promptTemplate,
      dependsOn: parseList(stepForm.dependsOn),
      runMode: stepForm.runMode,
      required: stepForm.required,
      outputKey,
      failurePolicy: stepForm.failurePolicy,
    };
  });
  validateWorkflowStepDependencies(steps);
  return steps;
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

function emptyToolPolicy(): ToolPolicy {
  return { allowed: [], disallowed: [] };
}

function mainToolPolicyFormFields(policy: ToolPolicy): Pick<
  AgentProfileFormState,
  | "mainMcpServers"
  | "mainMcpTools"
  | "mainBashApproval"
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
    mainBashApproval: fields.bashApproval,
    mainBashCommandAllowlist: fields.bashCommandAllowlist,
    mainBashCommandDenylist: fields.bashCommandDenylist,
    mainFilesystemRead: fields.filesystemRead,
    mainFilesystemWrite: fields.filesystemWrite,
    mainNetworkWebSearch: fields.networkWebSearch,
    mainNetworkWebFetch: fields.networkWebFetch,
  };
}

function toolPolicyFormFields(policy: ToolPolicy, mcpServers: readonly string[] = []): ToolPolicyFormFields {
  const allowed = new Set(policy.allowed);
  const disallowed = new Set(policy.disallowed);
  return {
    mcpServers: formatList(mcpServers.length > 0 ? mcpServers : (policy.mcp?.allowedServers ?? [])),
    mcpTools: formatList(policy.mcp?.allowedTools ?? []),
    bashApproval: policy.bash?.approval ?? "risky",
    bashCommandAllowlist: formatList(policy.bash?.commandAllowlist ?? []),
    bashCommandDenylist: formatList(policy.bash?.commandDenylist ?? []),
    filesystemRead:
      policy.filesystem?.read ??
      (hasAllowedTool(allowed, disallowed, ["Read", "Glob", "Grep", "Bash"])
        ? "workspace"
        : "none"),
    filesystemWrite:
      policy.filesystem?.write ??
      (hasAllowedTool(allowed, disallowed, ["Write", "Edit", "MultiEdit", "NotebookEdit"])
        ? "workspace"
        : "none"),
    networkWebSearch: policy.network?.webSearch ?? (allowed.has("WebSearch") && !disallowed.has("WebSearch")),
    networkWebFetch: policy.network?.webFetch ?? (allowed.has("WebFetch") && !disallowed.has("WebFetch")),
  };
}

function buildToolPolicyFromFormFields(
  _base: ToolPolicy,
  allowedRaw: string,
  disallowedRaw: string,
  fields: ToolPolicyFormFields,
): ToolPolicy {
  const allowed = parseList(allowedRaw);
  const disallowed = parseList(disallowedRaw);
  const mcpServers = parseList(fields.mcpServers);
  const mcpTools = parseList(fields.mcpTools);
  const bashEnabled = allowed.includes("Bash") && !disallowed.includes("Bash");
  return {
    allowed,
    disallowed,
    ...(bashEnabled
      ? {
          bash: {
            enabled: true,
            approval: fields.bashApproval,
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

function hasAllowedTool(
  allowed: ReadonlySet<string>,
  disallowed: ReadonlySet<string>,
  candidates: readonly string[],
): boolean {
  return candidates.some((candidate) => allowed.has(candidate) && !disallowed.has(candidate));
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

function normalizeStepId(raw: string): string {
  const id = raw.trim();
  if (!id) {
    throw new Error("Workflow step id 不能为空。");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
    throw new Error(`Workflow step id ${id} 只能包含字母、数字、下划线和短横线，并且必须以字母开头。`);
  }
  return id;
}

function normalizeStepOutputKey(raw: string): string {
  const outputKey = raw.trim();
  if (!outputKey) {
    throw new Error("Workflow step output key 不能为空。");
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(outputKey)) {
    throw new Error(
      `Workflow step output key ${outputKey} 只能包含字母、数字、下划线和短横线，并且必须以字母开头。`,
    );
  }
  return outputKey;
}

function validateWorkflowStepDependencies(steps: readonly WorkflowStep[]): void {
  const stepIds = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        throw new Error(`Workflow step ${step.id} 依赖不存在的 step：${dependency}`);
      }
      if (dependency === step.id) {
        throw new Error(`Workflow step ${step.id} 不能依赖自己。`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  const visit = (step: WorkflowStep) => {
    if (visited.has(step.id)) {
      return;
    }
    if (visiting.has(step.id)) {
      throw new Error("Workflow step 依赖存在循环。");
    }
    visiting.add(step.id);
    for (const dependency of step.dependsOn) {
      const dependencyStep = byId.get(dependency);
      if (dependencyStep) {
        visit(dependencyStep);
      }
    }
    visiting.delete(step.id);
    visited.add(step.id);
  };
  for (const step of steps) {
    visit(step);
  }
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

function createUniqueStepId(base: string, existing: readonly string[]): string {
  const normalizedBase = sanitizeStepId(base);
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
