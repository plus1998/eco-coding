import { SUBAGENT_ROLES, normalizeSubagentAvailability, type SubagentRole } from "@eco/runtime";
import type {
  ModelSettingsSnapshot,
  RoleRouteConfig,
  SubagentEnabledSettings,
  WorkflowSettingsSnapshot,
} from "./ipc";

export interface ThreadRuntimeConfig {
  routeProfileId: string;
  subagentEnabled: SubagentEnabledSettings;
  planModeEnabled: boolean;
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

export function isThreadRuntimeConfig(value: unknown): value is ThreadRuntimeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.routeProfileId !== "string" || !record.routeProfileId.trim()) {
    return false;
  }
  if (typeof record.planModeEnabled !== "boolean") {
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
  return {
    routeProfileId: config.routeProfileId.trim(),
    subagentEnabled: normalizeSubagentAvailability(config.subagentEnabled),
    planModeEnabled: config.planModeEnabled,
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
    throw new Error("至少添加一套角色路由配置。");
  }
  if (!getRoutesForProfile(input.settings, routeProfileId)) {
    throw new Error(`找不到路由配置：${routeProfileId}`);
  }
  return {
    routeProfileId,
    subagentEnabled: normalizeSubagentAvailability(input.subagentDefaults),
    planModeEnabled: input.workflowDefaults.planModeEnabled,
  };
}
