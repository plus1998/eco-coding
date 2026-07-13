import type { ModelRef } from "../shared/agent-orchestration";
import type {
  AgentDomain,
  AgentInstanceConfig,
  AgentTemplate,
  ModelSettingsSnapshot,
  OrchestrationProfile,
  SubagentRole,
  ThreadRuntimeConfig,
  ToolPolicy,
} from "../shared/ipc";
import { SUBAGENT_ROLES } from "../shared/ipc";
import { type AgentTemplatePermissionChip, buildAgentTemplatePermissionChips } from "./agent-template-form";

export interface AgentProfileMainSummary {
  name: string;
  modelLabel: string;
  modelId: string;
  thinkingEffort?: ModelRef["thinkingEffort"];
  riskLabels: string[];
  permissionChips: AgentTemplatePermissionChip[];
}

export interface AgentProfileAgentSummary {
  agentKey: string;
  name: string;
  templateName?: string | undefined;
  modelLabel: string;
  modelId: string;
  thinkingEffort?: ModelRef["thinkingEffort"];
  enabled: boolean;
  riskLabels: string[];
  permissionChips: AgentTemplatePermissionChip[];
}

export interface AgentProfileSummary {
  profile: OrchestrationProfile;
  selectionId?: string | undefined;
  name: string;
  presetLabel: string;
  sourceLabel: string;
  main: AgentProfileMainSummary;
  agents: AgentProfileAgentSummary[];
  enabledAgents: AgentProfileAgentSummary[];
  disabledAgentCount: number;
  highRiskLabels: string[];
}

const SUBAGENT_ROLE_SET = new Set<string>(SUBAGENT_ROLES);
const EXPLORE_TOOLS: ToolPolicy = {
  allowed: ["Read", "Glob", "Grep", "LS", "NotebookRead"],
  disallowed: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"],
  filesystem: { read: "workspace", write: "none" },
  network: { webSearch: false, webFetch: false },
};

export function listSelectableAgentProfileSummaries(
  settings: ModelSettingsSnapshot,
  runtimeConfig?: ThreadRuntimeConfig | undefined,
): AgentProfileSummary[] {
  return settings.orchestrationProfiles
    .map((profile) => buildAgentProfileSummary(settings, profile, runtimeConfig))
    .filter((summary): summary is AgentProfileSummary & { selectionId: string } =>
      Boolean(summary.selectionId),
    )
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function findSelectableAgentProfileSummary(
  settings: ModelSettingsSnapshot,
  selectionId: string | undefined,
  runtimeConfig?: ThreadRuntimeConfig | undefined,
): AgentProfileSummary | undefined {
  if (!selectionId) {
    return undefined;
  }
  return listSelectableAgentProfileSummaries(settings, runtimeConfig).find(
    (summary) => summary.selectionId === selectionId,
  );
}

export function buildAgentProfileSummary(
  settings: ModelSettingsSnapshot,
  profile: OrchestrationProfile,
  runtimeConfig?: ThreadRuntimeConfig | undefined,
): AgentProfileSummary {
  const templatesById = new Map(settings.agentTemplates.map((template) => [template.id, template]));
  const mainRiskLabels = summarizeToolRiskLabels(profile.mainAgent.tools);
  const mainModelRef = profile.mainAgent.modelRef;
  const main: AgentProfileMainSummary = {
    name: profile.mainAgent.name.trim() || "主 Agent",
    modelLabel: formatModelLabel(mainModelRef.providerId, mainModelRef.modelId, mainModelRef),
    modelId: mainModelRef.modelId,
    ...(mainModelRef.thinkingEffort ? { thinkingEffort: mainModelRef.thinkingEffort } : {}),
    riskLabels: mainRiskLabels,
    permissionChips: buildAgentTemplatePermissionChips({
      defaultTools: profile.mainAgent.tools,
      mcpServers: [],
      allowDelegation: false,
    }),
  };
  const agents = [
    buildExploreSummary(profile),
    ...profile.agents.map((agent) =>
      buildAgentSummary(agent, templatesById.get(agent.templateId), runtimeConfig),
    ),
  ];
  const enabledAgents = agents.filter((agent) => agent.enabled);
  return {
    profile,
    selectionId: profile.id,
    name: profile.name,
    presetLabel: formatAgentDomainLabel(profile.preset),
    sourceLabel: formatProfileSourceLabel(profile),
    main,
    agents,
    enabledAgents,
    disabledAgentCount: agents.length - enabledAgents.length,
    highRiskLabels: dedupeRiskLabels([
      ...mainRiskLabels,
      ...enabledAgents.flatMap((agent) => agent.riskLabels),
    ]),
  };
}

function buildExploreSummary(profile: OrchestrationProfile): AgentProfileAgentSummary {
  const exploreRef = profile.builtinAgents.explore.modelRef;
  return {
    agentKey: "explore",
    name: "Explore",
    modelLabel: formatModelLabel(exploreRef.providerId, exploreRef.modelId, exploreRef),
    modelId: exploreRef.modelId,
    ...(exploreRef.thinkingEffort ? { thinkingEffort: exploreRef.thinkingEffort } : {}),
    enabled: true,
    riskLabels: summarizeToolRiskLabels(EXPLORE_TOOLS),
    permissionChips: buildAgentTemplatePermissionChips({
      defaultTools: EXPLORE_TOOLS,
      mcpServers: [],
      allowDelegation: false,
    }),
  };
}

export function formatAgentDomainLabel(domain: AgentDomain): string {
  switch (domain) {
    case "coding":
      return "编程";
    case "research":
      return "研究";
    case "writing":
      return "写作";
    case "product":
      return "产品";
    case "data":
      return "数据";
    case "ops":
      return "运维";
    case "custom":
      return "自定义";
  }
}

function buildAgentSummary(
  agent: AgentInstanceConfig,
  template: AgentTemplate | undefined,
  runtimeConfig: ThreadRuntimeConfig | undefined,
): AgentProfileAgentSummary {
  const enabled = resolveAgentEnabled(agent, runtimeConfig);
  return {
    agentKey: agent.agentKey,
    name: agent.displayName?.trim() || template?.name || agent.agentKey,
    ...(template?.name ? { templateName: template.name } : {}),
    modelLabel: formatModelLabel(agent.modelRef.providerId, agent.modelRef.modelId, agent.modelRef),
    modelId: agent.modelRef.modelId,
    ...(agent.modelRef.thinkingEffort ? { thinkingEffort: agent.modelRef.thinkingEffort } : {}),
    enabled,
    riskLabels: summarizeToolRiskLabels(agent.tools),
    permissionChips: buildAgentTemplatePermissionChips({
      defaultTools: agent.tools,
      mcpServers: agent.mcpServers,
      allowDelegation: false,
    }),
  };
}

function resolveAgentEnabled(
  agent: AgentInstanceConfig,
  runtimeConfig: ThreadRuntimeConfig | undefined,
): boolean {
  if (!agent.enabled) {
    return false;
  }
  if (!runtimeConfig || !SUBAGENT_ROLE_SET.has(agent.agentKey)) {
    return agent.enabled;
  }
  return runtimeConfig.subagentEnabled[agent.agentKey as SubagentRole];
}

function formatProfileSourceLabel(profile: OrchestrationProfile): string {
  if (profile.source === "built_in") {
    return "内置";
  }
  if (profile.source === "derived") {
    return profile.sourceRouteProfileId ? "派生" : "派生配置";
  }
  if (profile.source === "project") {
    return "项目";
  }
  if (profile.source === "user") {
    return "用户";
  }
  return "自定义";
}

function summarizeToolRiskLabels(policy: ToolPolicy): string[] {
  const disallowed = new Set(policy.disallowed);
  const labels: string[] = [];
  if (policy.bash?.enabled && !disallowed.has("Bash")) {
    labels.push("Bash");
  }
  if (policy.filesystem?.write === "workspace") {
    labels.push("写文件");
  }
  const networkEnabled = policy.network?.webSearch || policy.network?.webFetch;
  if (networkEnabled) {
    labels.push("联网");
  }
  if ((policy.mcp?.allowedServers.length ?? 0) > 0 || (policy.mcp?.allowedTools.length ?? 0) > 0) {
    labels.push("MCP");
  }
  return dedupeRiskLabels(labels);
}

function dedupeRiskLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of labels) {
    if (!seen.has(label)) {
      seen.add(label);
      result.push(label);
    }
  }
  return result;
}

function formatModelLabel(_providerId: string, modelId: string, modelRef?: ModelRef): string {
  const model = modelId.trim();
  const base = model ? shortenModelId(model) : "未配置";
  const suffixes: string[] = [];
  if (modelRef?.thinkingEffort && modelRef.thinkingEffort !== "off") {
    suffixes.push(modelRef.thinkingEffort);
  }
  if (modelRef?.modelsDevMapping) {
    suffixes.push(shortenModelId(modelRef.modelsDevMapping.modelId));
  }
  return suffixes.length > 0 ? `${base} · ${suffixes.join(" · ")}` : base;
}

function shortenModelId(modelId: string): string {
  const normalized = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 11)}…${normalized.slice(-10)}`;
}
