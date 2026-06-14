import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, SubagentEnabledSettings } from "../src/shared/ipc";
import {
  buildThreadRuntimeConfigFromDefaults,
  deriveSubagentEnabledFromProfile,
  getDefaultAgentProfileId,
  getDefaultRouteProfileId,
  getRoutesForProfile,
  isAutonomousThreadRuntime,
  isBashReviewModeOnlyRuntimeConfigUpdate,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
  parseThreadRuntimeConfigJson,
  resolveThreadAgentProfile,
  runtimeRoleRoutesFromAgentProfile,
  serializeThreadRuntimeConfig,
  withPlanModeDisabled,
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

const codingPresetForGeneric = createBuiltInPresetCatalog().find((preset) => preset.id === "coding");
if (!codingPresetForGeneric) {
  throw new Error("Missing built-in coding preset.");
}

const genericProfile = buildOrchestrationProfileFromPreset(codingPresetForGeneric, {
  id: "generic-copy",
  name: "通用副本",
  modelRef: { providerId: "p1", modelId: "m-generic" },
  updatedAt: "2026-06-07T00:00:00.000Z",
});

const genericAgent = genericProfile.agents[0];
if (!genericAgent) {
  throw new Error("Coding preset must include at least one agent.");
}

const routeProfileA = settings.routeProfiles[0];
const routeProfileB = settings.routeProfiles[1];
if (!routeProfileA || !routeProfileB) {
  throw new Error("Missing route profile fixtures.");
}

const profileA = {
  ...buildCodingOrchestrationProfileFromRouteProfile(routeProfileA),
  id: "profile-a",
  source: "user" as const,
  sourceRouteProfileId: undefined,
};
const profileB = {
  ...buildCodingOrchestrationProfileFromRouteProfile(routeProfileB),
  id: "profile-b",
  source: "user" as const,
  sourceRouteProfileId: undefined,
};

const agentSettings: ModelSettingsSnapshot = {
  ...settings,
  orchestrationProfiles: [profileA, profileB],
};

const genericSettings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  orchestrationProfiles: [genericProfile],
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
  expect(getDefaultAgentProfileId(genericSettings)).toBe("generic-copy");
});

test("buildThreadRuntimeConfigFromDefaults uses plan mode off by default", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { planModeEnabled: false },
    agentProfileId: "profile-b",
  });
  expect(config.routeProfileId).toBe("profile-b");
  expect(config.agentProfileId).toBe("profile-b");
  expect(config.planModeEnabled).toBe(false);
  expect(config.subagentEnabled.reviewer).toBe(true);
  expect(isAutonomousThreadRuntime(config)).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults uses default subagents with plan mode on", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { planModeEnabled: true },
  });
  expect(config.agentProfileId).toBe("profile-a");
  expect(config.planModeEnabled).toBe(true);
  expect(config.subagentEnabled.reviewer).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults can target a generic Agent Profile without routes", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: genericSettings,
    workflowDefaults: { planModeEnabled: false },
    agentProfileId: "generic-copy",
  });

  expect(config.agentProfileId).toBe("generic-copy");
  expect(config.routeProfileId).toBe("generic-copy");
  expect(resolveThreadAgentProfile(genericSettings, config)?.preset).toBe("coding");
});

test("buildThreadRuntimeConfigFromDefaults does not let default routes override selected Agent Profile", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: mixedSettings,
    workflowDefaults: { planModeEnabled: false },
    agentProfileId: "generic-copy",
    routeProfileId: "profile-a",
  });

  expect(config.agentProfileId).toBe("generic-copy");
  expect(config.routeProfileId).toBe("generic-copy");
  expect(getRoutesForProfile(mixedSettings, config.routeProfileId)).toBeUndefined();
});

test("runtimeRoleRoutesFromAgentProfile includes enabled dynamic agents", () => {
  const profile = {
    ...genericProfile,
    mainAgent: {
      ...genericProfile.mainAgent,
      modelRef: { providerId: "main-provider", modelId: "main-model" },
    },
    agents: [
      {
        ...genericAgent,
        agentKey: "coding lead",
        modelRef: { providerId: "agent-provider", modelId: "agent-model" },
        enabled: true,
      },
      {
        ...genericAgent,
        agentKey: "disabled_agent",
        modelRef: { providerId: "disabled-provider", modelId: "disabled-model" },
        enabled: false,
      },
    ],
  };

  expect(runtimeRoleRoutesFromAgentProfile(profile)).toEqual([
    { role: "planner", providerId: "main-provider", modelId: "main-model" },
    { role: "explore", providerId: "p1", modelId: "m-generic" },
    { role: "coding lead", providerId: "agent-provider", modelId: "agent-model" },
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

test("deriveSubagentEnabledFromProfile disables roles missing from the profile", () => {
  const profile = {
    ...genericProfile,
    agents: genericProfile.agents.filter((agent) => agent.agentKey !== "architect"),
  };
  expect(deriveSubagentEnabledFromProfile(profile).architect).toBe(false);
  expect(deriveSubagentEnabledFromProfile(profile).coder).toBe(true);
});

test("serialize and parse thread runtime config round-trip", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
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
        agentProfileId: "generic-copy",
        subagentEnabled: threadSubagentEnabled,
        orchestrationMode: "autonomous",
      }),
    ),
  ).toEqual({
    routeProfileId: "",
    agentProfileId: "generic-copy",
    subagentEnabled: threadSubagentEnabled,
    planModeEnabled: false,
    bashReviewMode: "always",
  });
});

test("withPlanModeDisabled turns off plan mode without mutating the original config", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { planModeEnabled: true },
  });
  expect(withPlanModeDisabled(config)).toEqual({ ...config, planModeEnabled: false });
  expect(config.planModeEnabled).toBe(true);
  expect(withPlanModeDisabled({ ...config, planModeEnabled: false })).toEqual({
    ...config,
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
    bashReviewMode: "always",
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
    bashReviewMode: "always",
  });
});

test("isBashReviewModeOnlyRuntimeConfigUpdate allows bashReviewMode changes only", () => {
  const base = {
    routeProfileId: "profile-a",
    agentProfileId: "profile-a",
    subagentEnabled: threadSubagentEnabled,
    planModeEnabled: true,
    bashReviewMode: "always" as const,
  };
  expect(
    isBashReviewModeOnlyRuntimeConfigUpdate(base, { ...base, bashReviewMode: "auto" }),
  ).toBe(true);
  expect(
    isBashReviewModeOnlyRuntimeConfigUpdate(base, { ...base, planModeEnabled: false }),
  ).toBe(false);
  expect(
    isBashReviewModeOnlyRuntimeConfigUpdate(base, {
      ...base,
      subagentEnabled: { ...threadSubagentEnabled, coder: false },
    }),
  ).toBe(false);
});

test("isThreadRuntimeConfig rejects invalid payloads", () => {
  expect(isThreadRuntimeConfig(null)).toBe(false);
  expect(
    isThreadRuntimeConfig({ routeProfileId: "", orchestrationMode: "manual", subagentEnabled: {} }),
  ).toBe(false);
});
