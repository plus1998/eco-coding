import { listOrchestrationProfileAgents } from "../shared/agent-orchestration";
import type { ModelSettingsSnapshot, ThreadRuntimeConfig } from "../shared/ipc";
import {
  defaultThemeColorForAgentKey,
  stripEcoAgentKeyPrefix,
  subagentThemeCssVars,
} from "../shared/subagent-theme";
import { findSelectableAgentProfileSummary } from "./agent-profile-summary";

export type RuntimeAgentThemes = Record<string, string>;

export function buildRuntimeAgentThemes(
  settings: ModelSettingsSnapshot,
  runtimeConfig: ThreadRuntimeConfig | undefined,
): RuntimeAgentThemes {
  const summary = findSelectableAgentProfileSummary(
    settings,
    runtimeConfig?.agentProfileId ?? runtimeConfig?.routeProfileId,
    runtimeConfig,
  );
  if (!summary) {
    return {};
  }
  const themes: RuntimeAgentThemes = {};
  for (const agent of listOrchestrationProfileAgents(summary.profile)) {
    const color = agent.themeColor?.trim();
    if (color) {
      addAgentThemeColor(themes, agent.agentKey, color);
    }
  }
  return themes;
}

export function resolveRuntimeAgentThemeColor(
  role: string | undefined,
  themes?: RuntimeAgentThemes | undefined,
): string {
  if (!role?.trim()) {
    return defaultThemeColorForAgentKey("");
  }
  const key = role.trim();
  const configured =
    themes?.[key] ?? themes?.[stripEcoAgentKeyPrefix(key)] ?? themes?.[`eco_${stripEcoAgentKeyPrefix(key)}`];
  if (configured) {
    return configured;
  }
  return defaultThemeColorForAgentKey(key);
}

export function resolveSubagentRowThemeStyle(
  role: string | undefined,
  themes?: RuntimeAgentThemes | undefined,
): Record<string, string> {
  return subagentThemeCssVars(resolveRuntimeAgentThemeColor(role, themes));
}

function addAgentThemeColor(themes: RuntimeAgentThemes, key: string, color: string): void {
  const cleanKey = key.trim();
  const cleanColor = color.trim();
  if (!cleanKey || !cleanColor) {
    return;
  }
  themes[cleanKey] = cleanColor;
  themes[stripEcoAgentKeyPrefix(cleanKey)] = cleanColor;
  themes[`eco_${stripEcoAgentKeyPrefix(cleanKey)}`] = cleanColor;
}
