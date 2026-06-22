import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  createBuiltInAgentTemplates,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, RouteProfileView } from "../src/shared/ipc";
import {
  buildRuntimeAgentThemes,
  resolveRuntimeAgentThemeColor,
  resolveSubagentRowThemeStyle,
} from "../src/renderer/runtime-agent-theme";
import { SUBAGENT_UNKNOWN_THEME_COLOR } from "../src/shared/subagent-theme";

const routeProfile: RouteProfileView = {
  id: "coding-default",
  name: "默认编程",
  routes: [
    { role: "planner", providerId: "openai", modelId: "gpt-5-codex" },
    { role: "explore", providerId: "openai", modelId: "gpt-5-mini" },
    { role: "architect", providerId: "openai", modelId: "gpt-5" },
    { role: "coder", providerId: "openai", modelId: "gpt-5-codex" },
    { role: "reviewer", providerId: "openai", modelId: "gpt-5" },
    { role: "tester", providerId: "openai", modelId: "gpt-5-mini" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const settings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [routeProfile],
  agentTemplates: createBuiltInAgentTemplates(),
  orchestrationProfiles: [buildCodingOrchestrationProfileFromRouteProfile(routeProfile)],
};

test("resolveRuntimeAgentThemeColor uses built-in defaults when profile has no overrides", () => {
  expect(resolveRuntimeAgentThemeColor("explore", {})).toBe("#A78BFA");
  expect(resolveRuntimeAgentThemeColor("architect", {})).toBe("#22D3EE");
  expect(resolveRuntimeAgentThemeColor("coder", {})).toBe("#34D399");
  expect(resolveRuntimeAgentThemeColor("reviewer", {})).toBe("#FBBF24");
  expect(resolveRuntimeAgentThemeColor("tester", {})).toBe("#F472B6");
});

test("resolveRuntimeAgentThemeColor falls back to unknown blue for external agents", () => {
  expect(resolveRuntimeAgentThemeColor("researcher", {})).toBe(SUBAGENT_UNKNOWN_THEME_COLOR);
  expect(resolveRuntimeAgentThemeColor("eco_researcher", {})).toBe(SUBAGENT_UNKNOWN_THEME_COLOR);
});

test("buildRuntimeAgentThemes maps profile overrides and eco_ aliases", () => {
  const profile = structuredClone(settings.orchestrationProfiles[0]!);
  profile.builtinAgents.explore.themeColor = "#112233";
  profile.agents = profile.agents.map((agent) =>
    agent.agentKey === "coder" ? { ...agent, themeColor: "#445566" } : agent,
  );
  const themedSettings: ModelSettingsSnapshot = {
    ...settings,
    orchestrationProfiles: [profile],
  };
  const themes = buildRuntimeAgentThemes(themedSettings, {
    routeProfileId: profile.id,
    planModeEnabled: false,
    subagentEnabled: {
      explore: true,
      architect: true,
      coder: true,
      reviewer: true,
      tester: true,
    },
  });

  expect(resolveRuntimeAgentThemeColor("explore", themes)).toBe("#112233");
  expect(resolveRuntimeAgentThemeColor("eco_explore", themes)).toBe("#112233");
  expect(resolveRuntimeAgentThemeColor("coder", themes)).toBe("#445566");
  expect(resolveRuntimeAgentThemeColor("eco_coder", themes)).toBe("#445566");
  expect(resolveRuntimeAgentThemeColor("architect", themes)).toBe("#22D3EE");
});

test("resolveSubagentRowThemeStyle emits accent CSS variables", () => {
  const style = resolveSubagentRowThemeStyle("coder", { coder: "#34D399" });
  expect(style["--subagent-accent"]).toBe("#34D399");
  expect(style["--subagent-accent-border"]).toBe("rgba(52, 211, 153, 0.28)");
});
