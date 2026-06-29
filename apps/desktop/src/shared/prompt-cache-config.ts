import { listEnabledGlobalMcpServerKeys } from "./composer-mcp";
import type { ModelSettingsSnapshot, McpServerConfigView, OrchestrationProfile, ProviderConfigView } from "./ipc";
import {
  resolveThreadAgentProfile,
  resolveThreadRuntimeMcpServerKeys,
  type ThreadRuntimeConfig,
} from "./thread-runtime-config";

export interface PromptCacheProfileLabel {
  modelStack: string;
  profileName: string;
}

export type PromptCacheConfigDriftKind = "profile" | "mcp";

export interface PromptCacheRuntimeSignature {
  profileId: string;
  mcpServerKeys: string[];
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
  const mcpServerKeys = resolveThreadRuntimeMcpServerKeys({
    runtimeConfig: input.runtimeConfig,
    settings: input.settings,
    availableMcpServerKeys: input.availableMcpServerKeys,
  })
    .slice()
    .sort();
  return { profileId, mcpServerKeys };
}

export function diffPromptCacheRuntimeSignatures(
  baseline: PromptCacheRuntimeSignature,
  current: PromptCacheRuntimeSignature,
): PromptCacheConfigDriftKind[] {
  const kinds: PromptCacheConfigDriftKind[] = [];
  if (baseline.profileId !== current.profileId) {
    kinds.push("profile");
  }
  if (!stringArraysEqual(baseline.mcpServerKeys, current.mcpServerKeys)) {
    kinds.push("mcp");
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
  addProvider(profile.builtinAgents.explore.modelRef.providerId);
  for (const agent of profile.agents) {
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
    parts.push(
      profileLabel ? formatPromptCacheProfileSwitchPhrase(profileLabel) : "Agent Profile 已变更",
    );
  }
  if (kinds.includes("mcp")) {
    parts.push("MCP 配置已变更");
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
