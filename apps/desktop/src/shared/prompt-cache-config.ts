import { listEnabledGlobalMcpServerKeys } from "./composer-mcp";
import type { ModelSettingsSnapshot, McpServerConfigView } from "./ipc";
import {
  resolveThreadAgentProfile,
  resolveThreadRuntimeMcpServerKeys,
  type ThreadRuntimeConfig,
} from "./thread-runtime-config";

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

export function formatPromptCacheConfigDriftHint(kinds: readonly PromptCacheConfigDriftKind[]): string {
  if (kinds.length === 0) {
    return "";
  }
  const parts: string[] = [];
  if (kinds.includes("profile")) {
    parts.push("Agent Profile");
  }
  if (kinds.includes("mcp")) {
    parts.push("MCP 配置");
  }
  return `${parts.join("与")}已变更，可能导致本会话 prompt cache 失效（费用或延迟或上升）。仍可继续使用，或新开 thread 以获得稳定缓存。`;
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
