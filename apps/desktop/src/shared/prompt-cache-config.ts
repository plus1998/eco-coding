import { listOrchestrationProfileAgents } from "./agent-orchestration";
import { listEnabledGlobalMcpServerKeys } from "./composer-mcp";
import type {
  McpServerConfigView,
  ModelSettingsSnapshot,
  OrchestrationProfile,
  ProviderConfigView,
} from "./ipc";
import {
  resolveMainAgentModelOverrideForProvider,
  resolveMainAgentSystemPromptPreset,
  resolveThreadAgentProfile,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromAgentProfile,
  type ThreadRuntimeConfig,
} from "./thread-runtime-config";

export interface PromptCacheProfileLabel {
  modelStack: string;
  profileName: string;
}

export type PromptCacheConfigDriftKind = "profile" | "main_model" | "system_prompt" | "mcp" | "skills";

export interface PromptCacheRuntimeSignature {
  profileId: string;
  mainAgentModelKey: string;
  mainAgentSystemPromptPreset: OrchestrationProfile["mainAgent"]["systemPromptPreset"] | "";
  mcpServerKeys: string[];
  skillKeys: string[];
}

interface MainAgentModelIdentity {
  providerId: string;
  modelId: string;
  thinkingEffort?: string;
}

/** Stable identity for request-affecting main-agent model settings. */
export function buildMainAgentModelKey(model: MainAgentModelIdentity | undefined): string {
  return JSON.stringify([
    model?.providerId.trim() ?? "",
    model?.modelId.trim() ?? "",
    model?.thinkingEffort?.trim() ?? "",
  ]);
}

export function resolveMainAgentModelKey(
  settings: ModelSettingsSnapshot,
  runtimeConfig: ThreadRuntimeConfig,
): string {
  const profile = resolveThreadAgentProfile(settings, runtimeConfig);
  return buildMainAgentModelKey(resolveEffectiveMainAgentModel(profile, runtimeConfig));
}

export function resolvePromptCacheRuntimeSignature(input: {
  runtimeConfig: ThreadRuntimeConfig;
  settings: ModelSettingsSnapshot;
  availableMcpServerKeys: readonly string[];
}): PromptCacheRuntimeSignature {
  const profile = resolveThreadAgentProfile(input.settings, input.runtimeConfig);
  const profileId =
    profile?.id?.trim() ||
    input.runtimeConfig.agentProfileId?.trim() ||
    input.runtimeConfig.routeProfileId?.trim() ||
    "";
  const mainAgentModelKey = buildMainAgentModelKey(
    resolveEffectiveMainAgentModel(profile, input.runtimeConfig),
  );
  const mainAgentSystemPromptPreset = profile
    ? resolveMainAgentSystemPromptPreset(profile, input.runtimeConfig)
    : "";
  const mcpServerKeys = resolveThreadRuntimeMcpServerKeys({
    runtimeConfig: input.runtimeConfig,
    settings: input.settings,
    availableMcpServerKeys: input.availableMcpServerKeys,
  })
    .slice()
    .sort();
  const skillKeys = Object.entries(input.runtimeConfig.skillsEnabled ?? {})
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
    .sort();
  return { profileId, mainAgentModelKey, mainAgentSystemPromptPreset, mcpServerKeys, skillKeys };
}

function resolveEffectiveMainAgentModel(
  profile: OrchestrationProfile | undefined,
  runtimeConfig: ThreadRuntimeConfig,
): MainAgentModelIdentity | undefined {
  if (!profile) {
    return undefined;
  }
  const override = resolveMainAgentModelOverrideForProvider(
    profile.mainAgent.modelRef.providerId,
    runtimeConfig.mainAgentModelOverride,
  );
  return runtimeRoleRoutesFromAgentProfile(profile, override).find((route) => route.role === "planner");
}

export function diffPromptCacheRuntimeSignatures(
  baseline: PromptCacheRuntimeSignature,
  current: PromptCacheRuntimeSignature,
): PromptCacheConfigDriftKind[] {
  const kinds: PromptCacheConfigDriftKind[] = [];
  if (baseline.profileId !== current.profileId) {
    kinds.push("profile");
  }
  if (baseline.mainAgentModelKey !== current.mainAgentModelKey) {
    kinds.push("main_model");
  }
  if (baseline.mainAgentSystemPromptPreset !== current.mainAgentSystemPromptPreset) {
    kinds.push("system_prompt");
  }
  if (!stringArraysEqual(baseline.mcpServerKeys, current.mcpServerKeys)) {
    kinds.push("mcp");
  }
  if (!stringArraysEqual(baseline.skillKeys, current.skillKeys)) {
    kinds.push("skills");
  }
  return kinds;
}

export function resolvePromptCacheProfileLabel(
  settings: ModelSettingsSnapshot,
  runtimeConfig: ThreadRuntimeConfig,
): PromptCacheProfileLabel | undefined {
  const profile = resolveThreadAgentProfile(settings, runtimeConfig);
  if (!profile) {
    return undefined;
  }
  const modelStack = formatProfileModelStack(profile, settings.providers);
  const profileName = profile.name.trim() || profile.id.trim();
  if (!profileName) {
    return undefined;
  }
  return { modelStack, profileName };
}

export function formatProfileModelStack(
  profile: OrchestrationProfile,
  providers: readonly ProviderConfigView[],
): string {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const names: string[] = [];

  const addProvider = (providerId: string) => {
    const id = providerId.trim();
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    const provider = providerById.get(id);
    names.push(provider?.name.trim() || id);
  };

  addProvider(profile.mainAgent.modelRef.providerId);
  for (const agent of listOrchestrationProfileAgents(profile)) {
    if (agent.enabled) {
      addProvider(agent.modelRef.providerId);
    }
  }

  return names.length > 0 ? names.join("+") : "未配置";
}

export function formatPromptCacheProfileSwitchPhrase(label: PromptCacheProfileLabel): string {
  return `已经变更为 ${label.modelStack}（${label.profileName}）`;
}

function formatPromptCacheDriftChangeParts(
  kinds: readonly PromptCacheConfigDriftKind[],
  profileLabel?: PromptCacheProfileLabel,
): string[] {
  const parts: string[] = [];
  if (kinds.includes("profile")) {
    parts.push(profileLabel ? formatPromptCacheProfileSwitchPhrase(profileLabel) : "Agent Profile 已变更");
  }
  if (kinds.includes("main_model")) {
    parts.push("主代理模型或思考强度已变更");
  }
  if (kinds.includes("system_prompt")) {
    parts.push("主代理提示词已变更");
  }
  if (kinds.includes("mcp")) {
    parts.push("MCP 配置已变更");
  }
  if (kinds.includes("skills")) {
    parts.push("Skills 配置已变更");
  }
  return parts;
}

export function formatPromptCacheConfigDriftHint(
  kinds: readonly PromptCacheConfigDriftKind[],
  options?: { profileLabel?: PromptCacheProfileLabel },
): string {
  if (kinds.length === 0) {
    return "";
  }
  const parts = formatPromptCacheDriftChangeParts(kinds, options?.profileLabel);
  return `${parts.join("，")}，可能导致本会话 prompt cache 失效（费用或延迟或上升）。仍可继续使用，或新开 thread 以获得稳定缓存。`;
}

export function formatPromptCacheConfigDriftMessage(
  kinds: readonly PromptCacheConfigDriftKind[],
  options?: { profileLabel?: PromptCacheProfileLabel },
): string {
  const parts = formatPromptCacheDriftChangeParts(kinds, options?.profileLabel);
  if (parts.length === 0) {
    return "Composer 配置已变更";
  }
  return parts.join("，");
}

export function resolvePromptCacheConfigDrift(input: {
  baseline?: ThreadRuntimeConfig;
  current?: ThreadRuntimeConfig;
  settings: ModelSettingsSnapshot;
  mcpServers: readonly McpServerConfigView[];
}): PromptCacheConfigDriftKind[] {
  if (!input.baseline || !input.current) {
    return [];
  }
  const availableMcpServerKeys = listEnabledGlobalMcpServerKeys(input.mcpServers);
  return diffPromptCacheRuntimeSignatures(
    resolvePromptCacheRuntimeSignature({
      runtimeConfig: input.baseline,
      settings: input.settings,
      availableMcpServerKeys,
    }),
    resolvePromptCacheRuntimeSignature({
      runtimeConfig: input.current,
      settings: input.settings,
      availableMcpServerKeys,
    }),
  );
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
