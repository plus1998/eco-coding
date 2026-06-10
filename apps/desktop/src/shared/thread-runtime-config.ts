import { defaultSubagentAvailability, normalizeSubagentAvailability, SUBAGENT_ROLES } from "@eco/runtime";
import type { BashReviewMode } from "../../../../packages/bash-policy/src";
import type {
  ModelSettingsSnapshot,
  OrchestrationModeSetting,
  OrchestrationProfile,
  RoleRouteConfig,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  WorkflowSettingsSnapshot,
} from "./ipc";

export type { BashReviewMode };

export interface ThreadRuntimeConfig {
  routeProfileId: string;
  agentProfileId?: string;
  subagentEnabled: SubagentEnabledSettings;
  planModeEnabled: boolean;
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

function normalizePlanModeEnabled(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "manual") {
    return true;
  }
  if (value === "autonomous") {
    return false;
  }
  if (value === "analyze_plan_execute") {
    return true;
  }
  if (value === "sdk_default") {
    return false;
  }
  return false;
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
  const planMode = record.planModeEnabled ?? record.orchestrationMode;
  if (
    planMode !== "manual" &&
    planMode !== "autonomous" &&
    planMode !== "analyze_plan_execute" &&
    planMode !== "sdk_default" &&
    typeof planMode !== "boolean"
  ) {
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
  );
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
  const record = config as ThreadRuntimeConfig & { orchestrationMode?: OrchestrationModeSetting };
  const planModeEnabled = normalizePlanModeEnabled(record.planModeEnabled ?? record.orchestrationMode);
  const routeProfileId = typeof record.routeProfileId === "string" ? record.routeProfileId.trim() : "";
  const bashReviewMode = normalizeBashReviewMode(record.bashReviewMode);
  return {
    routeProfileId,
    ...(config.agentProfileId?.trim() && { agentProfileId: config.agentProfileId.trim() }),
    subagentEnabled: normalizeSubagentAvailability(config.subagentEnabled),
    planModeEnabled,
    bashReviewMode,
  };
}

function normalizeBashReviewMode(value: unknown): BashReviewMode {
  if (value === "auto" || value === "allow_all" || value === "always") {
    return value;
  }
  return "always";
}

export function buildThreadRuntimeConfigFromDefaults(input: {
  settings: ModelSettingsSnapshot;
  workflowDefaults: WorkflowSettingsSnapshot;
  routeProfileId?: string;
  agentProfileId?: string;
}): ThreadRuntimeConfig {
  const requestedProfileId = input.agentProfileId?.trim() || input.routeProfileId?.trim();
  const agentProfile =
    getAgentProfileById(input.settings, requestedProfileId) ??
    getAgentProfileById(input.settings, getDefaultAgentProfileId(input.settings));
  if (!agentProfile) {
    throw new Error("至少添加一套 Agent Profile。");
  }
  return {
    routeProfileId: agentProfile.id,
    agentProfileId: agentProfile.id,
    subagentEnabled: defaultSubagentAvailability(),
    planModeEnabled: input.workflowDefaults.planModeEnabled,
    bashReviewMode: "always",
  };
}

export function isPlanModeThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return config.planModeEnabled;
}

/** ExitPlanMode ends the planning phase; keep thread config aligned with the UI toggle. */
export function withPlanModeDisabled(config: ThreadRuntimeConfig): ThreadRuntimeConfig {
  if (!config.planModeEnabled) {
    return config;
  }
  return { ...config, planModeEnabled: false };
}

/** @deprecated Use isPlanModeThreadRuntime and invert it if needed. */
export function isAutonomousThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return !config.planModeEnabled;
}
