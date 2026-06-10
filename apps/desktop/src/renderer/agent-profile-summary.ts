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
  riskLabels: string[];
  permissionChips: AgentTemplatePermissionChip[];
}

export interface AgentProfileAgentSummary {
  agentKey: string;
  name: string;
  templateName?: string | undefined;
  modelLabel: string;
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
  const routeOrder = new Map(settings.routeProfiles.map((profile, index) => [profile.id, index]));
  return settings.orchestrationProfiles
    .map((profile) => buildAgentProfileSummary(settings, profile, runtimeConfig))
    .filter((summary): summary is AgentProfileSummary & { selectionId: string } =>
      Boolean(summary.selectionId),
    )
    .sort(
      (left, right) =>
        (routeOrder.get(left.selectionId) ?? Number.MAX_SAFE_INTEGER) -
        (routeOrder.get(right.selectionId) ?? Number.MAX_SAFE_INTEGER),
    );
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
  const main: AgentProfileMainSummary = {
    name: profile.mainAgent.name.trim() || "主 Agent",
    modelLabel: formatModelLabel(profile.mainAgent.modelRef.providerId, profile.mainAgent.modelRef.modelId),
    riskLabels: mainRiskLabels,
    permissionChips: buildAgentTemplatePermissionChips({
      defaultTools: profile.mainAgent.tools,
      mcpServers: [],
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
  return {
    agentKey: "explore",
    name: "Explore",
    modelLabel: formatModelLabel(
      profile.builtinAgents.explore.modelRef.providerId,
      profile.builtinAgents.explore.modelRef.modelId,
    ),
    enabled: true,
    riskLabels: summarizeToolRiskLabels(EXPLORE_TOOLS),
    permissionChips: buildAgentTemplatePermissionChips({
      defaultTools: EXPLORE_TOOLS,
      mcpServers: [],
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
    modelLabel: formatModelLabel(agent.modelRef.providerId, agent.modelRef.modelId),
    enabled,
    riskLabels: summarizeToolRiskLabels(agent.tools),
    permissionChips: buildAgentTemplatePermissionChips({
      defaultTools: agent.tools,
      mcpServers: agent.mcpServers,
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
  const allowed = new Set(policy.allowed);
  const disallowed = new Set(policy.disallowed);
  const labels: string[] = [];
  if (policy.bash?.enabled && allowed.has("Bash") && !disallowed.has("Bash")) {
    labels.push("Bash");
  }
  const writeEnabled =
    policy.filesystem?.write === "workspace" ||
    ["Write", "Edit", "MultiEdit", "NotebookEdit"].some((tool) => allowed.has(tool) && !disallowed.has(tool));
  if (writeEnabled) {
    labels.push("写文件");
  }
  const networkEnabled =
    policy.network?.webSearch ||
    policy.network?.webFetch ||
    (allowed.has("WebSearch") && !disallowed.has("WebSearch")) ||
    (allowed.has("WebFetch") && !disallowed.has("WebFetch"));
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

function formatModelLabel(providerId: string, modelId: string): string {
  const model = modelId.trim();
  const provider = providerId.trim();
  if (!model && !provider) {
    return "未配置";
  }
  if (!provider) {
    return shortenModelId(model);
  }
  return `${provider}/${shortenModelId(model || "未配置")}`;
}

function shortenModelId(modelId: string): string {
  const normalized = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
  if (normalized.length <= 24) {
    return normalized;
  }
  return `${normalized.slice(0, 11)}…${normalized.slice(-10)}`;
}
