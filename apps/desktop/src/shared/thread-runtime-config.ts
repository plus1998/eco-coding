import {
  SUBAGENT_ROLES,
  defaultSubagentAvailability,
  normalizeSubagentAvailability,
  type SubagentRole,
} from "@eco/runtime";
import type {
  ModelSettingsSnapshot,
  OrchestrationModeSetting,
  RoleRouteConfig,
  SubagentEnabledSettings,
  WorkflowSettingsSnapshot,
} from "./ipc";

export interface ThreadRuntimeConfig {
  routeProfileId: string;
  subagentEnabled: SubagentEnabledSettings;
  orchestrationMode: OrchestrationModeSetting;
}

export type ThreadRuntimeConfigInput = ThreadRuntimeConfig;

export function getDefaultRouteProfileId(settings: ModelSettingsSnapshot): string | undefined {
  return settings.routeProfiles[0]?.id;
}

export function getRoutesForProfile(
  settings: ModelSettingsSnapshot,
  routeProfileId: string,
): RoleRouteConfig[] | undefined {
  return settings.routeProfiles.find((profile) => profile.id === routeProfileId)?.routes;
}

function normalizeOrchestrationMode(value: unknown): OrchestrationModeSetting {
  if (value === "manual" || value === "autonomous") {
    return value;
  }
  if (value === "analyze_plan_execute") {
    return "manual";
  }
  if (value === "sdk_default") {
    return "autonomous";
  }
  if (typeof value === "boolean") {
    return value ? "manual" : "autonomous";
  }
  return "autonomous";
}

export function isThreadRuntimeConfig(value: unknown): value is ThreadRuntimeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.routeProfileId !== "string" || !record.routeProfileId.trim()) {
    return false;
  }
  const orchestration = record.orchestrationMode ?? record.planModeEnabled;
  if (
    orchestration !== "manual" &&
    orchestration !== "autonomous" &&
    orchestration !== "analyze_plan_execute" &&
    orchestration !== "sdk_default" &&
    typeof orchestration !== "boolean"
  ) {
    return false;
  }
  if (!record.subagentEnabled || typeof record.subagentEnabled !== "object") {
    return false;
  }
  const subagents = record.subagentEnabled as Record<string, unknown>;
  return SUBAGENT_ROLES.every((role) => typeof subagents[role] === "boolean");
}

export function parseThreadRuntimeConfigJson(json: string | null | undefined): ThreadRuntimeConfig | undefined {
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
  const record = config as ThreadRuntimeConfig & { planModeEnabled?: boolean };
  const orchestrationMode = normalizeOrchestrationMode(
    record.orchestrationMode ?? record.planModeEnabled,
  );
  return {
    routeProfileId: config.routeProfileId.trim(),
    subagentEnabled: normalizeSubagentAvailability(config.subagentEnabled),
    orchestrationMode,
  };
}

export function buildThreadRuntimeConfigFromDefaults(input: {
  settings: ModelSettingsSnapshot;
  subagentDefaults: SubagentEnabledSettings;
  workflowDefaults: WorkflowSettingsSnapshot;
  routeProfileId?: string;
}): ThreadRuntimeConfig {
  const routeProfileId = input.routeProfileId?.trim() || getDefaultRouteProfileId(input.settings);
  if (!routeProfileId) {
    throw new Error("至少添加一套子代理编排配置。");
  }
  if (!getRoutesForProfile(input.settings, routeProfileId)) {
    throw new Error(`找不到路由配置：${routeProfileId}`);
  }
  const orchestrationMode = input.workflowDefaults.orchestrationMode;
  const subagentEnabled =
    orchestrationMode === "autonomous"
      ? defaultSubagentAvailability()
      : normalizeSubagentAvailability(input.subagentDefaults);
  return {
    routeProfileId,
    subagentEnabled,
    orchestrationMode,
  };
}

export function isAutonomousThreadRuntime(config: ThreadRuntimeConfig): boolean {
  return config.orchestrationMode === "autonomous";
}
