import {
  collectProfileAssignedMcpServers,
} from "@eco/runtime/agent-orchestration";
import {
  defaultSubagentAvailability,
  normalizeSubagentAvailability,
  SUBAGENT_ROLES,
} from "@eco/runtime/subagent-availability";
import type { BashReviewMode } from "../../../../packages/bash-policy/src";
import { listOrchestrationProfileAgents } from "./agent-orchestration";
import {
  deriveMcpServersEnabled,
  listEnabledGlobalMcpServerKeys,
  type McpServersEnabledSettings,
  normalizeMcpServersEnabled,
  resolveEnabledMcpServerKeys,
} from "./composer-mcp";
import type {
  McpServerConfigView,
  ModelSettingsSnapshot,
  OrchestrationProfile,
  RoleRouteConfig,
  RuntimeAgentRole,
  RuntimeRoleRouteConfig,
  SubagentEnabledSettings,
  ThinkingEffort,
  WorkflowSettingsSnapshot,
} from "./ipc";
import {
  normalizeSkillsEnabled,
  type SkillsEnabledSettings,
} from "./composer-skills-settings";
import { isSessionMode, normalizeSessionMode, resolveSessionMode, type SessionMode } from "./session-mode";

export type { BashReviewMode, McpServersEnabledSettings, SessionMode };

export type MainAgentSystemPromptPreset = OrchestrationProfile["mainAgent"]["systemPromptPreset"];

export interface MainAgentModelOverride {
  providerId: string;
  modelId: string;
  thinkingEffort?: ThinkingEffort;
  candidateModelId?: string;
}

export interface ThreadRuntimeConfig {
  routeProfileId: string;
  agentProfileId?: string;
  mainAgentModelOverride?: MainAgentModelOverride;
  mainAgentSystemPromptPresetOverride?: MainAgentSystemPromptPreset;
  subagentEnabled: SubagentEnabledSettings;
  mcpServersEnabled?: McpServersEnabledSettings;
  skillsEnabled?: SkillsEnabledSettings;
  sessionMode: SessionMode;
  bashReviewMode: BashReviewMode;
}

export type ThreadRuntimeConfigInput = ThreadRuntimeConfig;

export function resolveMainAgentModelOverrideForProvider(
  providerId: string | undefined,
  override: MainAgentModelOverride | undefined,
): MainAgentModelOverride | undefined {
  const currentProviderId = providerId?.trim();
  return currentProviderId && override?.providerId.trim() === currentProviderId ? override : undefined;
}

export function getDefaultRouteProfileId(settings: ModelSettingsSnapshot): string | undefined {
  return settings.routeProfiles[0]?.id;
}

export function getDefaultAgentProfileId(
  settings: ModelSettingsSnapshot,
  preferredProfileId?: string,
): string | undefined {
  const preferredId = preferredProfileId?.trim();
  if (preferredId && settings.orchestrationProfiles.some((profile) => profile.id === preferredId)) {
    return preferredId;
  }
  return settings.orchestrationProfiles[0]?.id;
}

export function getRoutesForProfile(
  settings: ModelSettingsSnapshot,
  routeProfileId: string,
): RoleRouteConfig[] | undefined {
  return settings.routeProfiles.find((profile) => profile.id === routeProfileId)?.routes;
}

export function runtimeRoleRoutesFromAgentProfile(
  profile: OrchestrationProfile,
  mainAgentModelOverride?: MainAgentModelOverride,
): RuntimeRoleRouteConfig[] {
  const routes = new Map<RuntimeAgentRole, RuntimeRoleRouteConfig>();
  routes.set("planner", routeFromAgentProfileModelRef("planner", profile.mainAgent.modelRef));
  for (const agent of listOrchestrationProfileAgents(profile)) {
    const role = agent.agentKey;
    if (agent.enabled && role !== "planner" && !routes.has(role)) {
      routes.set(role, routeFromAgentProfileModelRef(role, agent.modelRef));
    }
  }
  return applyMainAgentModelOverride([...routes.values()], mainAgentModelOverride);
}

export function applyMainAgentModelOverride(
  routes: readonly RuntimeRoleRouteConfig[],
  override?: MainAgentModelOverride,
): RuntimeRoleRouteConfig[] {
  if (!override) {
    return routes.map((route) => ({ ...route }));
  }
  return routes.map((route) => {
    if (route.role !== "planner") {
      return { ...route };
    }
    const applicableOverride = resolveMainAgentModelOverrideForProvider(route.providerId, override);
    if (!applicableOverride) {
      return { ...route };
    }
    const sameModel = route.modelId.trim() === applicableOverride.modelId.trim();
    return {
      ...(sameModel ? route : {}),
      role: "planner",
      providerId: applicableOverride.providerId,
      modelId: applicableOverride.modelId,
      ...(applicableOverride.thinkingEffort !== undefined
        ? { thinkingEffort: applicableOverride.thinkingEffort }
        : {}),
      ...(applicableOverride.candidateModelId
        ? { candidateModelId: applicableOverride.candidateModelId }
        : {}),
    };
  });
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
  if (
    record.mainAgentModelOverride !== undefined &&
    !isMainAgentModelOverride(record.mainAgentModelOverride)
  ) {
    return false;
  }
  if (
    record.mainAgentSystemPromptPresetOverride !== undefined &&
    !isMainAgentSystemPromptPreset(record.mainAgentSystemPromptPresetOverride)
  ) {
    return false;
  }
  const subagents = record.subagentEnabled as Record<string, unknown>;
  if (!SUBAGENT_ROLES.every((role) => typeof subagents[role] === "boolean")) {
    return false;
  }
  const bashReviewMode = record.bashReviewMode;
  return (
    (bashReviewMode === undefined ||
      bashReviewMode === "always" ||
      bashReviewMode === "auto" ||
      bashReviewMode === "allow_all") &&
    (record.mcpServersEnabled === undefined || isMcpServersEnabledRecord(record.mcpServersEnabled)) &&
    (record.skillsEnabled === undefined || isMcpServersEnabledRecord(record.skillsEnabled))
  );
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
  const skillsEnabled = normalizeSkillsEnabled(config.skillsEnabled);
  return {
    routeProfileId,
    ...(config.agentProfileId?.trim() && { agentProfileId: config.agentProfileId.trim() }),
    ...(config.mainAgentModelOverride
      ? { mainAgentModelOverride: normalizeMainAgentModelOverride(config.mainAgentModelOverride) }
      : {}),
    ...(config.mainAgentSystemPromptPresetOverride
      ? { mainAgentSystemPromptPresetOverride: config.mainAgentSystemPromptPresetOverride }
      : {}),
    subagentEnabled: normalizeSubagentAvailability(config.subagentEnabled),
    ...(mcpServersEnabled ? { mcpServersEnabled } : {}),
    ...(skillsEnabled ? { skillsEnabled } : {}),
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
  const profileAgents = listOrchestrationProfileAgents(profile);
  for (const role of SUBAGENT_ROLES) {
    const agent = profileAgents.find((candidate) => candidate.agentKey === role);
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
    getAgentProfileById(
      input.settings,
      getDefaultAgentProfileId(input.settings, input.workflowDefaults.defaultAgentProfileId),
    );
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
            ...(input.workflowDefaults.mcpServersEnabled
              ? { remembered: input.workflowDefaults.mcpServersEnabled }
              : {}),
          }),
        }
      : {}),
    sessionMode,
    bashReviewMode:
      agentProfile.mainAgent.tools.confirmation === "never"
        ? "allow_all"
        : agentProfile.mainAgent.tools.confirmation === "always"
          ? "always"
          : "auto",
  };
}

export function isPlanModeThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return resolveSessionMode(config) === "plan";
}

/** ExitPlanMode ends the planning phase; align thread config with Agent session mode. */
export function withAgentSessionMode(
  config: ThreadRuntimeConfig,
  sessionMode: SessionMode = "agent",
): ThreadRuntimeConfig {
  if (resolveSessionMode(config) === sessionMode) {
    return config;
  }
  return { ...config, sessionMode };
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
    mainAgentModelOverridesEqual(left.mainAgentModelOverride, right.mainAgentModelOverride) &&
    left.mainAgentSystemPromptPresetOverride === right.mainAgentSystemPromptPresetOverride &&
    left.sessionMode === right.sessionMode &&
    booleanRecordsEqual(left.mcpServersEnabled, right.mcpServersEnabled) &&
    booleanRecordsEqual(left.skillsEnabled, right.skillsEnabled) &&
    SUBAGENT_ROLES.every((role) => left.subagentEnabled[role] === right.subagentEnabled[role])
  );
}

function booleanRecordsEqual(
  left: Record<string, boolean> | undefined,
  right: Record<string, boolean> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, enabled], index) =>
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === enabled,
    )
  );
}

export function resolveMainAgentSystemPromptPreset(
  profile: OrchestrationProfile,
  config: ThreadRuntimeConfig,
): MainAgentSystemPromptPreset {
  return config.mainAgentSystemPromptPresetOverride ?? profile.mainAgent.systemPromptPreset;
}

function isMainAgentSystemPromptPreset(value: unknown): value is MainAgentSystemPromptPreset {
  return value === "core_native" || value === "custom_append";
}

function isMainAgentModelOverride(value: unknown): value is MainAgentModelOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerId === "string" &&
    Boolean(record.providerId.trim()) &&
    typeof record.modelId === "string" &&
    Boolean(record.modelId.trim()) &&
    (record.thinkingEffort === undefined ||
      (typeof record.thinkingEffort === "string" && isThinkingEffort(record.thinkingEffort))) &&
    (record.candidateModelId === undefined || typeof record.candidateModelId === "string")
  );
}

function normalizeMainAgentModelOverride(override: MainAgentModelOverride): MainAgentModelOverride {
  const candidateModelId = override.candidateModelId?.trim();
  return {
    providerId: override.providerId.trim(),
    modelId: override.modelId.trim(),
    ...(override.thinkingEffort !== undefined ? { thinkingEffort: override.thinkingEffort } : {}),
    ...(candidateModelId ? { candidateModelId } : {}),
  };
}

function mainAgentModelOverridesEqual(
  left?: MainAgentModelOverride,
  right?: MainAgentModelOverride,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return (
    left.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.thinkingEffort === right.thinkingEffort &&
    left.candidateModelId === right.candidateModelId
  );
}

function isThinkingEffort(value: string): value is ThinkingEffort {
  return (
    value === "off" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

export function isAutonomousThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return resolveSessionMode(config) === "agent";
}

export { isAskSessionMode, isPlanSessionMode, resolveSessionMode } from "./session-mode";
