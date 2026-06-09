import { expect, test } from "bun:test";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, SubagentEnabledSettings } from "../src/shared/ipc";
import {
  buildThreadRuntimeConfigFromDefaults,
  getDefaultAgentProfileId,
  getDefaultRouteProfileId,
  getRoutesForProfile,
  isAutonomousThreadRuntime,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
  parseThreadRuntimeConfigJson,
  resolveThreadAgentProfile,
  runtimeRoleRoutesFromAgentProfile,
  serializeThreadRuntimeConfig,
} from "../src/shared/thread-runtime-config";

const threadSubagentEnabled: SubagentEnabledSettings = {
  explore: true,
  architect: true,
  coder: true,
  reviewer: true,
  tester: true,
};

const settings: ModelSettingsSnapshot = {
  providers: [],
  agentTemplates: [],
  orchestrationProfiles: [],
  routeProfiles: [
    {
      id: "profile-a",
      name: "方案 A",
      routes: [
        { role: "planner", providerId: "p1", modelId: "m1" },
        { role: "explore", providerId: "p1", modelId: "m1" },
        { role: "architect", providerId: "p1", modelId: "m1" },
        { role: "coder", providerId: "p1", modelId: "m1" },
        { role: "reviewer", providerId: "p1", modelId: "m1" },
        { role: "tester", providerId: "p1", modelId: "m1" },
      ],
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "profile-b",
      name: "方案 B",
      routes: [
        { role: "planner", providerId: "p1", modelId: "m2" },
        { role: "explore", providerId: "p1", modelId: "m2" },
        { role: "architect", providerId: "p1", modelId: "m2" },
        { role: "coder", providerId: "p1", modelId: "m2" },
        { role: "reviewer", providerId: "p1", modelId: "m2" },
        { role: "tester", providerId: "p1", modelId: "m2" },
      ],
      createdAt: "2020-01-02T00:00:00.000Z",
      updatedAt: "2020-01-02T00:00:00.000Z",
    },
  ],
};

const researchPreset = createBuiltInPresetCatalog().find((preset) => preset.id === "research");
if (!researchPreset) {
  throw new Error("Missing built-in research preset.");
}

const researchProfile = buildOrchestrationProfileFromPreset(researchPreset, {
  id: "research-copy",
  name: "研究副本",
  modelRef: { providerId: "p1", modelId: "m-research" },
  updatedAt: "2026-06-07T00:00:00.000Z",
});

const researchAgent = researchProfile.agents[0];
if (!researchAgent) {
  throw new Error("Research preset must include at least one agent.");
}

const genericSettings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  orchestrationProfiles: [researchProfile],
};

const mixedSettings: ModelSettingsSnapshot = {
  ...genericSettings,
  routeProfiles: settings.routeProfiles,
};

test("getDefaultRouteProfileId returns first profile", () => {
  expect(getDefaultRouteProfileId(settings)).toBe("profile-a");
});

test("getRoutesForProfile resolves routes by id", () => {
  expect(getRoutesForProfile(settings, "profile-b")?.[0]?.modelId).toBe("m2");
});

test("getDefaultAgentProfileId returns first orchestration profile", () => {
  expect(getDefaultAgentProfileId(genericSettings)).toBe("research-copy");
});

test("buildThreadRuntimeConfigFromDefaults uses plan mode off by default", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: { planModeEnabled: false },
    routeProfileId: "profile-b",
  });
  expect(config.routeProfileId).toBe("profile-b");
  expect(config.planModeEnabled).toBe(false);
  expect(config.subagentEnabled.reviewer).toBe(true);
  expect(isAutonomousThreadRuntime(config)).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults uses default subagents with plan mode on", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: { planModeEnabled: true },
  });
  expect(config.planModeEnabled).toBe(true);
  expect(config.subagentEnabled.reviewer).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults can target a generic Agent Profile without routes", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: genericSettings,
    workflowDefaults: { planModeEnabled: false },
    agentProfileId: "research-copy",
  });

  expect(config.agentProfileId).toBe("research-copy");
  expect(config.routeProfileId).toBe("research-copy");
  expect(resolveThreadAgentProfile(genericSettings, config)?.preset).toBe("research");
});

test("buildThreadRuntimeConfigFromDefaults does not let default routes override selected Agent Profile", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: mixedSettings,
    workflowDefaults: { planModeEnabled: false },
    agentProfileId: "research-copy",
    routeProfileId: "profile-a",
  });

  expect(config.agentProfileId).toBe("research-copy");
  expect(config.routeProfileId).toBe("research-copy");
  expect(getRoutesForProfile(mixedSettings, config.routeProfileId)).toBeUndefined();
});

test("runtimeRoleRoutesFromAgentProfile includes enabled dynamic agents", () => {
  const profile = {
    ...researchProfile,
    mainAgent: {
      ...researchProfile.mainAgent,
      modelRef: { providerId: "main-provider", modelId: "main-model" },
    },
    agents: [
      {
        ...researchAgent,
        agentKey: "research lead",
        modelRef: { providerId: "agent-provider", modelId: "agent-model" },
        enabled: true,
      },
      {
        ...researchAgent,
        agentKey: "disabled_agent",
        modelRef: { providerId: "disabled-provider", modelId: "disabled-model" },
        enabled: false,
      },
    ],
  };

  expect(runtimeRoleRoutesFromAgentProfile(profile)).toEqual([
    { role: "planner", providerId: "main-provider", modelId: "main-model" },
    { role: "explore", providerId: "p1", modelId: "m-research" },
    { role: "research lead", providerId: "agent-provider", modelId: "agent-model" },
  ]);
});

test("runtimeRoleRoutesFromAgentProfile includes fixed built-in Explore route", () => {
  const codingPreset = createBuiltInPresetCatalog().find((preset) => preset.id === "coding");
  if (!codingPreset) {
    throw new Error("Missing built-in coding preset.");
  }
  const profile = buildOrchestrationProfileFromPreset(codingPreset, {
    id: "coding-copy",
    name: "编程副本",
    modelRef: { providerId: "main-provider", modelId: "main-model" },
    updatedAt: "2026-06-07T00:00:00.000Z",
  });
  profile.builtinAgents.explore.modelRef = {
    providerId: "explore-provider",
    modelId: "gpt-5.4-mini",
  };

  const routes = runtimeRoleRoutesFromAgentProfile(profile);
  expect(routes).toContainEqual({
    role: "explore",
    providerId: "explore-provider",
    modelId: "gpt-5.4-mini",
  });
  expect(profile.agents.map((agent) => agent.agentKey)).not.toContain("explore");
});

test("serialize and parse thread runtime config round-trip", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: { planModeEnabled: true },
  });
  const json = serializeThreadRuntimeConfig(config);
  expect(json).toContain("planModeEnabled");
  expect(json).not.toContain("orchestrationMode");
  expect(parseThreadRuntimeConfigJson(json)).toEqual(normalizeThreadRuntimeConfig(config));
});

test("parseThreadRuntimeConfigJson accepts agentProfileId-only payloads", () => {
  expect(
    parseThreadRuntimeConfigJson(
      JSON.stringify({
        agentProfileId: "research-copy",
        subagentEnabled: threadSubagentEnabled,
        orchestrationMode: "autonomous",
      }),
    ),
  ).toEqual({
    routeProfileId: "",
    agentProfileId: "research-copy",
    subagentEnabled: threadSubagentEnabled,
    planModeEnabled: false,
  });
});

test("normalizeThreadRuntimeConfig preserves planModeEnabled", () => {
  expect(
    normalizeThreadRuntimeConfig({
      routeProfileId: "profile-a",
      subagentEnabled: threadSubagentEnabled,
      planModeEnabled: true,
    } as never),
  ).toEqual({
    routeProfileId: "profile-a",
    subagentEnabled: threadSubagentEnabled,
    planModeEnabled: true,
  });
});

test("normalizeThreadRuntimeConfig migrates legacy orchestrationMode", () => {
  expect(
    normalizeThreadRuntimeConfig({
      routeProfileId: "profile-a",
      subagentEnabled: threadSubagentEnabled,
      orchestrationMode: "manual",
    } as never),
  ).toEqual({
    routeProfileId: "profile-a",
    subagentEnabled: threadSubagentEnabled,
    planModeEnabled: true,
  });
});

test("isThreadRuntimeConfig rejects invalid payloads", () => {
  expect(isThreadRuntimeConfig(null)).toBe(false);
  expect(
    isThreadRuntimeConfig({ routeProfileId: "", orchestrationMode: "manual", subagentEnabled: {} }),
  ).toBe(false);
});
