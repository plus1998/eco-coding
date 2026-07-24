import { listOrchestrationProfileAgents, type ModelRef } from "../shared/agent-orchestration";
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
import { i18n } from "./i18n";

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
    name: profile.mainAgent.name.trim() || i18n.t("settings.models.mainAgent"),
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
  const agents = listOrchestrationProfileAgents(profile).map((agent) =>
    buildAgentSummary(agent, templatesById.get(agent.templateId), runtimeConfig),
  );
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

export function formatAgentDomainLabel(domain: AgentDomain): string {
  switch (domain) {
    case "coding":
      return i18n.t("agentProfile.domain.coding");
    case "research":
      return i18n.t("agentProfile.domain.research");
    case "writing":
      return i18n.t("agentProfile.domain.writing");
    case "product":
      return i18n.t("agentProfile.domain.product");
    case "data":
      return i18n.t("agentProfile.domain.data");
    case "ops":
      return i18n.t("agentProfile.domain.ops");
    case "custom":
      return i18n.t("agentProfile.domain.custom");
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
    return i18n.t("agentProfile.source.builtIn");
  }
  if (profile.source === "derived") {
    return profile.sourceRouteProfileId
      ? i18n.t("agentProfile.source.derived")
      : i18n.t("agentProfile.source.derivedProfile");
  }
  if (profile.source === "project") {
    return i18n.t("settings.models.editor.project");
  }
  if (profile.source === "user") {
    return i18n.t("settings.models.editor.user");
  }
  return i18n.t("agentProfile.domain.custom");
}

function summarizeToolRiskLabels(policy: ToolPolicy): string[] {
  const disallowed = new Set(policy.disallowed);
  const labels: string[] = [];
  if (policy.bash?.enabled && !disallowed.has("Bash")) {
    labels.push("Bash");
  }
  if (policy.filesystem?.write === "workspace") {
    labels.push(i18n.t("agentProfile.risk.writeFiles"));
  }
  const networkEnabled = policy.network?.webSearch || policy.network?.webFetch;
  if (networkEnabled) {
    labels.push(i18n.t("agentProfile.risk.network"));
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
  const base = model ? shortenModelId(model) : i18n.t("common.notConfigured");
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
