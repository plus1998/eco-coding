import {
  collectOrchestrationAssignedMcpServers,
} from "@eco/runtime/agent-orchestration";
import {
  defaultSubagentAvailability,
  normalizeSubagentAvailability,
  SUBAGENT_ROLES,
} from "@eco/runtime/subagent-availability";
import type { BashReviewMode } from "../../../../packages/bash-policy/src";
import {
  isOrchestrationSelection,
  isResolvedOrchestrationSnapshot,
  orchestrationConfigFromSnapshot,
  resolveOrchestrationSnapshot,
  type EcoOrchestrationConfig,
  type OrchestrationResourceLookup,
  type OrchestrationSelection,
  type ResolvedOrchestrationSnapshot,
} from "./agent-orchestration";
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
export type { OrchestrationSelection, ResolvedOrchestrationSnapshot };

export type MainAgentSystemPromptPreset = ResolvedOrchestrationSnapshot["mainAgent"]["systemPromptPreset"];

export interface MainAgentModelOverride {
  providerId: string;
  modelId: string;
  thinkingEffort?: ThinkingEffort;
  candidateModelId?: string;
}

/**
 * Thread-bound runtime config.
 * `orchestrationSelection` + `resolvedOrchestrationSnapshot` are materialized when
 * creating a thread or explicitly switching orchestration. Missing selection only
 * allows viewing history, not starting a run.
 */
export interface ThreadRuntimeConfig {
  orchestrationSelection?: OrchestrationSelection;
  resolvedOrchestrationSnapshot?: ResolvedOrchestrationSnapshot;
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

export function orchestrationResourceLookupFromSettings(
  settings: ModelSettingsSnapshot,
): OrchestrationResourceLookup {
  return {
    mainAgentConfigs: settings.mainAgentConfigs,
    mainAgentPrompts: settings.mainAgentPrompts,
    subagentOrchestrations: settings.subagentOrchestrations,
  };
}

export function hasCompleteOrchestrationSelection(
  selection: OrchestrationSelection | undefined,
): selection is OrchestrationSelection {
  if (!selection || !isOrchestrationSelection(selection)) {
    return false;
  }
  if (!selection.mainAgentConfigId.trim()) {
    return false;
  }
  if (selection.mainPrompt.mode === "custom_append" && !selection.mainPrompt.promptId.trim()) {
    return false;
  }
  if (
    selection.subagents.mode === "orchestration" &&
    !selection.subagents.orchestrationId.trim()
  ) {
    return false;
  }
  return true;
}

export function resolveThreadOrchestrationSnapshot(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): ResolvedOrchestrationSnapshot | undefined {
  if (config.resolvedOrchestrationSnapshot && isResolvedOrchestrationSnapshot(config.resolvedOrchestrationSnapshot)) {
    return config.resolvedOrchestrationSnapshot;
  }
  if (!hasCompleteOrchestrationSelection(config.orchestrationSelection)) {
    return undefined;
  }
  return resolveOrchestrationSnapshot(
    config.orchestrationSelection,
    orchestrationResourceLookupFromSettings(settings),
  );
}

export function resolveThreadOrchestrationConfig(
  settings: ModelSettingsSnapshot,
  config: ThreadRuntimeConfig,
): EcoOrchestrationConfig | undefined {
  const snapshot = resolveThreadOrchestrationSnapshot(settings, config);
  return snapshot ? orchestrationConfigFromSnapshot(snapshot) : undefined;
}

export function runtimeRoleRoutesFromOrchestrationSnapshot(
  snapshot: ResolvedOrchestrationSnapshot,
  mainAgentModelOverride?: MainAgentModelOverride,
): RuntimeRoleRouteConfig[] {
  const routes = new Map<RuntimeAgentRole, RuntimeRoleRouteConfig>();
  routes.set("planner", routeFromModelRef("planner", snapshot.mainAgent.modelRef));
  for (const agent of snapshot.agents) {
    const role = agent.agentKey;
    if (agent.enabled && role !== "planner" && !routes.has(role)) {
      routes.set(role, routeFromModelRef(role, agent.modelRef));
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

function routeFromModelRef(
  role: RuntimeAgentRole,
  modelRef: ResolvedOrchestrationSnapshot["mainAgent"]["modelRef"],
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

/** Build selection + snapshot for thread persistence. */
export function materializeThreadOrchestrationSnapshot(
  settings: ModelSettingsSnapshot,
  selection: OrchestrationSelection,
): {
  orchestrationSelection: OrchestrationSelection;
  resolvedOrchestrationSnapshot: ResolvedOrchestrationSnapshot;
} {
  const resolvedOrchestrationSnapshot = resolveOrchestrationSnapshot(
    selection,
    orchestrationResourceLookupFromSettings(settings),
  );
  return {
    orchestrationSelection: selection,
    resolvedOrchestrationSnapshot,
  };
}

export function isThreadRuntimeConfig(value: unknown): value is ThreadRuntimeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    "routeProfileId" in record ||
    "agentProfileId" in record ||
    "mainAgentConfigId" in record ||
    "mainPrompt" in record ||
    "subagentOrchestrationId" in record ||
    "resolvedProfileSnapshot" in record
  ) {
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
  if (
    record.orchestrationSelection !== undefined &&
    !isOrchestrationSelection(record.orchestrationSelection)
  ) {
    return false;
  }
  if (
    record.resolvedOrchestrationSnapshot !== undefined &&
    !isResolvedOrchestrationSnapshot(record.resolvedOrchestrationSnapshot)
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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
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

/** Compare runtime configs without volatile snapshot timestamps. */
export function serializeThreadRuntimeConfigForCompare(config: ThreadRuntimeConfig): string {
  const normalized = normalizeThreadRuntimeConfig(config);
  if (!normalized.resolvedOrchestrationSnapshot) {
    return JSON.stringify(normalized);
  }
  const { resolvedAt: _resolvedAt, ...snapshotWithoutTimestamp } =
    normalized.resolvedOrchestrationSnapshot;
  return JSON.stringify({
    ...normalized,
    resolvedOrchestrationSnapshot: snapshotWithoutTimestamp,
  });
}

export function threadRuntimeConfigsEquivalent(
  left: ThreadRuntimeConfig,
  right: ThreadRuntimeConfig,
): boolean {
  return (
    serializeThreadRuntimeConfigForCompare(left) === serializeThreadRuntimeConfigForCompare(right)
  );
}

export function normalizeThreadRuntimeConfig(config: ThreadRuntimeConfig): ThreadRuntimeConfig {
  const bashReviewMode = normalizeBashReviewMode(config.bashReviewMode);
  const mcpServersEnabled = normalizeMcpServersEnabled(config.mcpServersEnabled);
  const skillsEnabled = normalizeSkillsEnabled(config.skillsEnabled);
  return {
    ...(config.orchestrationSelection && isOrchestrationSelection(config.orchestrationSelection)
      ? { orchestrationSelection: normalizeOrchestrationSelection(config.orchestrationSelection) }
      : {}),
    ...(config.resolvedOrchestrationSnapshot &&
    isResolvedOrchestrationSnapshot(config.resolvedOrchestrationSnapshot)
      ? { resolvedOrchestrationSnapshot: config.resolvedOrchestrationSnapshot }
      : {}),
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

/** Align runtime subagent toggles with agents actually present in the snapshot. */
export function deriveSubagentEnabledFromSnapshot(
  snapshot: ResolvedOrchestrationSnapshot,
  existing?: Partial<SubagentEnabledSettings>,
): SubagentEnabledSettings {
  const subagentEnabled = defaultSubagentAvailability();
  const orchestrationAgents = snapshot.agents;
  for (const role of SUBAGENT_ROLES) {
    const agent = orchestrationAgents.find((candidate) => candidate.agentKey === role);
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

/** Resolve MCP servers enabled for a thread session (composer overrides snapshot assignment). */
export function resolveThreadRuntimeMcpServerKeys(input: {
  runtimeConfig?: ThreadRuntimeConfig;
  settings: ModelSettingsSnapshot;
  availableMcpServerKeys: readonly string[];
}): string[] {
  const snapshot = input.runtimeConfig
    ? resolveThreadOrchestrationSnapshot(input.settings, input.runtimeConfig)
    : undefined;
  const orchestrationAssigned = snapshot
    ? collectOrchestrationAssignedMcpServers(orchestrationConfigFromSnapshot(snapshot), input.settings.agentTemplates)
    : [];
  if (input.runtimeConfig?.mcpServersEnabled) {
    return resolveEnabledMcpServerKeys(
      deriveMcpServersEnabled(input.availableMcpServerKeys, {
        existing: input.runtimeConfig.mcpServersEnabled,
      }),
    );
  }
  return orchestrationAssigned;
}

export function buildThreadRuntimeConfigFromDefaults(input: {
  settings: ModelSettingsSnapshot;
  workflowDefaults: WorkflowSettingsSnapshot;
  orchestrationSelection?: OrchestrationSelection;
  mcpServers?: readonly McpServerConfigView[];
}): ThreadRuntimeConfig {
  const selection =
    input.orchestrationSelection ?? input.workflowDefaults.defaultOrchestrationSelection;
  if (!hasCompleteOrchestrationSelection(selection)) {
    throw new Error("请先选择完整的主代理、提示词和子代理编排组合。");
  }
  const materialized = materializeThreadOrchestrationSnapshot(input.settings, selection);
  const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(input.mcpServers ?? []);
  const orchestrationAssignedMcpServers = collectOrchestrationAssignedMcpServers(
    orchestrationConfigFromSnapshot(materialized.resolvedOrchestrationSnapshot),
    input.settings.agentTemplates,
  );
  const sessionMode = normalizeSessionMode(input.workflowDefaults.sessionMode);
  const base: ThreadRuntimeConfig = {
    ...materialized,
    subagentEnabled: deriveSubagentEnabledFromSnapshot(materialized.resolvedOrchestrationSnapshot),
    ...(availableMcpServerKeys.length > 0
      ? {
          mcpServersEnabled: deriveMcpServersEnabled(availableMcpServerKeys, {
            orchestrationAssignedServers: orchestrationAssignedMcpServers,
            ...(input.workflowDefaults.mcpServersEnabled
              ? { remembered: input.workflowDefaults.mcpServersEnabled }
              : {}),
          }),
        }
      : {}),
    sessionMode,
    bashReviewMode: "auto",
  };

  const confirmation = materialized.resolvedOrchestrationSnapshot.mainAgent.tools.confirmation;
  return {
    ...base,
    bashReviewMode:
      confirmation === "never" ? "allow_all" : confirmation === "always" ? "always" : "auto",
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
  const normalizedBefore = normalizeThreadRuntimeConfig(before);
  const normalizedAfter = normalizeThreadRuntimeConfig(after);
  return threadRuntimeConfigsEquivalent(
    { ...normalizedBefore, bashReviewMode: normalizedAfter.bashReviewMode },
    normalizedAfter,
  );
}

export function resolveMainAgentSystemPromptPreset(
  snapshot: ResolvedOrchestrationSnapshot,
  config: ThreadRuntimeConfig,
): MainAgentSystemPromptPreset {
  return config.mainAgentSystemPromptPresetOverride ?? snapshot.mainAgent.systemPromptPreset;
}

function normalizeOrchestrationSelection(selection: OrchestrationSelection): OrchestrationSelection {
  const mainPrompt =
    selection.mainPrompt.mode === "builtin"
      ? { mode: "builtin" as const }
      : { mode: "custom_append" as const, promptId: selection.mainPrompt.promptId.trim() };
  const subagents =
    selection.subagents.mode === "none"
      ? { mode: "none" as const }
      : {
          mode: "orchestration" as const,
          orchestrationId: selection.subagents.orchestrationId.trim(),
        };
  return {
    mainAgentConfigId: selection.mainAgentConfigId.trim(),
    mainPrompt,
    subagents,
  };
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
