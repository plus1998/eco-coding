import { collectProfileAssignedMcpServers, defaultSubagentAvailability, normalizeSubagentAvailability, SUBAGENT_ROLES } from "@eco/runtime";
import type { BashReviewMode } from "../../../../packages/bash-policy/src";
import {
  isSessionMode,
  normalizeSessionMode,
  resolveSessionMode,
  type SessionMode,
} from "./session-mode";
import {
  deriveMcpServersEnabled,
  listEnabledGlobalMcpServerKeys,
  normalizeMcpServersEnabled,
  resolveEnabledMcpServerKeys,
  type McpServersEnabledSettings,
} from "./composer-mcp";
import type {
  ModelSettingsSnapshot,
  McpServerConfigView,
  OrchestrationModeSetting,
  OrchestrationProfile,
  RoleRouteConfig,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  WorkflowSettingsSnapshot,
} from "./ipc";

export type { McpServersEnabledSettings };

export type { BashReviewMode };

export type { SessionMode };

export interface ThreadRuntimeConfig {
  routeProfileId: string;
  agentProfileId?: string;
  subagentEnabled: SubagentEnabledSettings;
  mcpServersEnabled?: McpServersEnabledSettings;
  sessionMode: SessionMode;
  bashReviewMode: BashReviewMode;
}

export type ThreadRuntimeConfigInput = ThreadRuntimeConfig;

export function getDefaultRouteProfileId(settings: ModelSettingsSnapshot): string | undefined {
  return settings.routeProfiles[0]?.id;
}

export function getDefaultAgentProfileId(settings: ModelSettingsSnapshot): string | undefined {
  return settings.orchestrationProfiles[0]?.id;
}

export function getRoutesForProfile(
  settings: ModelSettingsSnapshot,
  routeProfileId: string,
): RoleRouteConfig[] | undefined {
  return settings.routeProfiles.find((profile) => profile.id === routeProfileId)?.routes;
}

export function runtimeRoleRoutesFromAgentProfile(profile: OrchestrationProfile): RuntimeRoleRouteConfig[] {
  const routes = new Map<RuntimeAgentRole, RuntimeRoleRouteConfig>();
  routes.set("planner", routeFromAgentProfileModelRef("planner", profile.mainAgent.modelRef));
  routes.set("explore", routeFromAgentProfileModelRef("explore", profile.builtinAgents.explore.modelRef));
  for (const agent of profile.agents) {
    const role = agent.agentKey;
    if (agent.enabled && role !== "planner" && !routes.has(role)) {
      routes.set(role, routeFromAgentProfileModelRef(role, agent.modelRef));
    }
  }
  return [...routes.values()];
}

function routeFromAgentProfileModelRef(
  role: RuntimeAgentRole,
  modelRef: OrchestrationProfile["mainAgent"]["modelRef"],
): RuntimeRoleRouteConfig {
  return {
    role,
    providerId: modelRef.providerId,
    modelId: modelRef.modelId,
    ...(modelRef.apiCompat && { apiCompat: modelRef.apiCompat }),
    ...(modelRef.thinkingEffort && { thinkingEffort: modelRef.thinkingEffort }),
    ...(modelRef.modelsDevMapping && { modelsDevMapping: modelRef.modelsDevMapping }),
    ...(modelRef.manualSpec && { manualSpec: modelRef.manualSpec }),
    ...(modelRef.candidateModelId && { candidateModelId: modelRef.candidateModelId }),
  };
}

export function getAgentProfileById(
  settings: ModelSettingsSnapshot,
  agentProfileId: string | undefined,
): OrchestrationProfile | undefined {
  const id = agentProfileId?.trim();
  if (!id) {
    return undefined;
  }
  return settings.orchestrationProfiles.find((profile) => profile.id === id);
}

export function resolveThreadAgentProfile(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): OrchestrationProfile | undefined {
  return (
    getAgentProfileById(settings, config.agentProfileId) ??
    getAgentProfileById(settings, config.routeProfileId)
  );
}

export function isThreadRuntimeConfig(value: unknown): value is ThreadRuntimeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const hasRouteProfileId = typeof record.routeProfileId === "string" && record.routeProfileId.trim();
  const hasAgentProfileId = typeof record.agentProfileId === "string" && record.agentProfileId.trim();
  if (!hasRouteProfileId && !hasAgentProfileId) {
    return false;
  }
  if (!isSessionMode(record.sessionMode)) {
    return false;
  }
  if (!record.subagentEnabled || typeof record.subagentEnabled !== "object") {
    return false;
  }
  const subagents = record.subagentEnabled as Record<string, unknown>;
  if (!SUBAGENT_ROLES.every((role) => typeof subagents[role] === "boolean")) {
    return false;
  }
  const bashReviewMode = record.bashReviewMode;
  return (
    bashReviewMode === undefined ||
    bashReviewMode === "always" ||
    bashReviewMode === "auto" ||
    bashReviewMode === "allow_all"
  ) && (record.mcpServersEnabled === undefined || isMcpServersEnabledRecord(record.mcpServersEnabled));
}

function isMcpServersEnabledRecord(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((enabled) => typeof enabled === "boolean");
}

export function parseThreadRuntimeConfigJson(
  json: string | null | undefined,
): ThreadRuntimeConfig | undefined {
  if (!json?.trim()) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isThreadRuntimeConfig(parsed)) {
      return undefined;
    }
    return normalizeThreadRuntimeConfig(parsed);
  } catch {
    return undefined;
  }
}

export function serializeThreadRuntimeConfig(config: ThreadRuntimeConfig): string {
  return JSON.stringify(normalizeThreadRuntimeConfig(config));
}

export function normalizeThreadRuntimeConfig(config: ThreadRuntimeConfig): ThreadRuntimeConfig {
  const routeProfileId = typeof config.routeProfileId === "string" ? config.routeProfileId.trim() : "";
  const bashReviewMode = normalizeBashReviewMode(config.bashReviewMode);
  const mcpServersEnabled = normalizeMcpServersEnabled(config.mcpServersEnabled);
  return {
    routeProfileId,
    ...(config.agentProfileId?.trim() && { agentProfileId: config.agentProfileId.trim() }),
    subagentEnabled: normalizeSubagentAvailability(config.subagentEnabled),
    ...(mcpServersEnabled ? { mcpServersEnabled } : {}),
    sessionMode: normalizeSessionMode(config.sessionMode),
    bashReviewMode,
  };
}

/** Align runtime subagent toggles with agents actually present in the selected profile. */
export function deriveSubagentEnabledFromProfile(
  profile: OrchestrationProfile,
  existing?: Partial<SubagentEnabledSettings>,
): SubagentEnabledSettings {
  const subagentEnabled = defaultSubagentAvailability();
  for (const role of SUBAGENT_ROLES) {
    if (role === "explore") {
      subagentEnabled.explore = true;
      continue;
    }
    const agent = profile.agents.find((candidate) => candidate.agentKey === role);
    if (!agent?.enabled) {
      subagentEnabled[role] = false;
      continue;
    }
    if (typeof existing?.[role] === "boolean") {
      subagentEnabled[role] = existing[role];
    }
  }
  return subagentEnabled;
}

function normalizeBashReviewMode(value: unknown): BashReviewMode {
  if (value === "auto" || value === "allow_all" || value === "always") {
    return value;
  }
  return "always";
}

/** Resolve MCP servers enabled for a thread session (composer overrides profile assignment). */
export function resolveThreadRuntimeMcpServerKeys(input: {
  runtimeConfig?: ThreadRuntimeConfig;
  settings: ModelSettingsSnapshot;
  availableMcpServerKeys: readonly string[];
}): string[] {
  const profile = input.runtimeConfig
    ? resolveThreadAgentProfile(input.settings, input.runtimeConfig)
    : undefined;
  const profileAssigned = profile
    ? collectProfileAssignedMcpServers(profile, input.settings.agentTemplates)
    : [];
  if (input.runtimeConfig?.mcpServersEnabled) {
    return resolveEnabledMcpServerKeys(
      deriveMcpServersEnabled(input.availableMcpServerKeys, {
        existing: input.runtimeConfig.mcpServersEnabled,
      }),
    );
  }
  return profileAssigned;
}

export function buildThreadRuntimeConfigFromDefaults(input: {
  settings: ModelSettingsSnapshot;
  workflowDefaults: WorkflowSettingsSnapshot;
  routeProfileId?: string;
  agentProfileId?: string;
  mcpServers?: readonly McpServerConfigView[];
}): ThreadRuntimeConfig {
  const requestedProfileId = input.agentProfileId?.trim() || input.routeProfileId?.trim();
  const agentProfile =
    getAgentProfileById(input.settings, requestedProfileId) ??
    getAgentProfileById(input.settings, getDefaultAgentProfileId(input.settings));
  if (!agentProfile) {
    throw new Error("至少添加一套智能体配置。");
  }
  const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(input.mcpServers ?? []);
  const profileAssignedMcpServers = collectProfileAssignedMcpServers(
    agentProfile,
    input.settings.agentTemplates,
  );
  const sessionMode = normalizeSessionMode(input.workflowDefaults.sessionMode);
  return {
    routeProfileId: agentProfile.id,
    agentProfileId: agentProfile.id,
    subagentEnabled: deriveSubagentEnabledFromProfile(agentProfile),
    ...(availableMcpServerKeys.length > 0
      ? {
          mcpServersEnabled: deriveMcpServersEnabled(availableMcpServerKeys, {
            profileAssignedServers: profileAssignedMcpServers,
            remembered: input.workflowDefaults.mcpServersEnabled,
          }),
        }
      : {}),
    sessionMode,
    bashReviewMode: "always",
  };
}

export function isPlanModeThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return resolveSessionMode(config) === "plan";
}

/** ExitPlanMode ends the planning phase; keep thread config aligned with the UI toggle. */
export function withPlanModeDisabled(config: ThreadRuntimeConfig): ThreadRuntimeConfig {
  if (resolveSessionMode(config) !== "plan") {
    return config;
  }
  return { ...config, sessionMode: "agent" };
}

/** True when `after` differs from `before` only by `bashReviewMode`. */
export function isBashReviewModeOnlyRuntimeConfigUpdate(
  before: ThreadRuntimeConfig,
  after: ThreadRuntimeConfig,
): boolean {
  const left = normalizeThreadRuntimeConfig(before);
  const right = normalizeThreadRuntimeConfig(after);
  return (
    left.routeProfileId === right.routeProfileId &&
    left.agentProfileId === right.agentProfileId &&
    left.sessionMode === right.sessionMode &&
    SUBAGENT_ROLES.every((role) => left.subagentEnabled[role] === right.subagentEnabled[role])
  );
}

export function isAutonomousThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return resolveSessionMode(config) === "agent";
}

export { resolveSessionMode, isAskSessionMode, isPlanSessionMode } from "./session-mode";
