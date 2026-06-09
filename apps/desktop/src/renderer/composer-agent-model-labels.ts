import { formatRoleModelLabel } from "@eco/runtime";
import type {
  AgentRole,
  ModelSettingsSnapshot,
  OrchestrationProfile,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentRole,
} from "../shared/ipc";
import { AGENT_ROLES, SUBAGENT_ROLES } from "../shared/ipc";
import { pickDisplayModelId } from "../shared/model-id";

const LEGACY_ROLE_LABELS: Record<AgentRole, string> = {
  planner: "主代理",
  explore: "探索",
  architect: "架构",
  coder: "编码",
  reviewer: "审查",
  tester: "测试",
};

export interface ComposerAgentModelLabel {
  role: RuntimeAgentRole;
  displayName: string;
  modelId?: string | undefined;
  title: string;
  main: boolean;
  subagentRole?: SubagentRole | undefined;
}

export function buildComposerAgentModelLabels(input: {
  routes: readonly RuntimeRoleRouteConfig[];
  threadModelByRole?: Record<string, string> | undefined;
  profile?: OrchestrationProfile | undefined;
  templates?: ModelSettingsSnapshot["agentTemplates"] | undefined;
}): ComposerAgentModelLabel[] {
  if (input.profile) {
    return buildProfileAgentModelLabels({ ...input, profile: input.profile });
  }
  return AGENT_ROLES.map((role) =>
    buildLabelForRoute({
      role,
      displayName: LEGACY_ROLE_LABELS[role],
      configuredModelId: input.routes.find((route) => route.role === role)?.modelId,
      liveModelId: input.threadModelByRole?.[role],
      main: role === "planner",
      subagentRole: isSubagentRole(role) ? role : undefined,
    }),
  );
}

function buildProfileAgentModelLabels(input: {
  routes: readonly RuntimeRoleRouteConfig[];
  threadModelByRole?: Record<string, string> | undefined;
  profile: OrchestrationProfile;
  templates?: ModelSettingsSnapshot["agentTemplates"] | undefined;
}): ComposerAgentModelLabel[] {
  const displayNames = profileDisplayNames(input.profile, input.templates ?? []);
  return input.routes.map((route) =>
    buildLabelForRoute({
      role: route.role,
      displayName: displayNames.get(route.role) ?? formatRuntimeRoleLabel(route.role),
      configuredModelId: route.modelId,
      liveModelId: input.threadModelByRole?.[route.role],
      main: route.role === "planner",
      subagentRole: isSubagentRole(route.role) ? route.role : undefined,
    }),
  );
}

function buildLabelForRoute(input: {
  role: RuntimeAgentRole;
  displayName: string;
  configuredModelId?: string | undefined;
  liveModelId?: string | undefined;
  main: boolean;
  subagentRole?: SubagentRole | undefined;
}): ComposerAgentModelLabel {
  const configured = input.configuredModelId?.trim() || undefined;
  const modelId = pickDisplayModelId(input.liveModelId, configured);
  return {
    role: input.role,
    displayName: input.displayName,
    modelId,
    title: isLegacyAgentRole(input.role)
      ? formatRoleModelLabel(input.role, modelId)
      : modelId
        ? `${input.displayName} · ${modelId}`
        : input.displayName,
    main: input.main,
    ...(input.subagentRole && { subagentRole: input.subagentRole }),
  };
}

function profileDisplayNames(
  profile: OrchestrationProfile,
  templates: ModelSettingsSnapshot["agentTemplates"],
): Map<string, string> {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const names = new Map<string, string>();
  names.set("planner", profile.mainAgent.name.trim() || "主 Agent");
  names.set("explore", "Explore");
  for (const agent of profile.agents) {
    const template = templateById.get(agent.templateId);
    names.set(agent.agentKey, agent.displayName?.trim() || template?.name || agent.agentKey);
  }
  return names;
}

function isSubagentRole(role: RuntimeAgentRole): role is SubagentRole {
  return (SUBAGENT_ROLES as readonly string[]).includes(role);
}

function isLegacyAgentRole(role: RuntimeAgentRole): role is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(role);
}

function formatRuntimeRoleLabel(role: RuntimeAgentRole): string {
  return role
    .replace(/^eco_/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
