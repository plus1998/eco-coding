import { expect, test } from "bun:test";
import type { ModelSettingsSnapshot, SubagentEnabledSettings } from "../src/shared/ipc";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";
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

const subagentDefaults: SubagentEnabledSettings = {
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

const researchProfile = buildOrchestrationProfileFromPreset(
  createBuiltInPresetCatalog().find((preset) => preset.id === "research")!,
  {
    id: "research-copy",
    name: "研究副本",
    modelRef: { providerId: "p1", modelId: "m-research" },
    updatedAt: "2026-06-07T00:00:00.000Z",
  },
);

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

test("buildThreadRuntimeConfigFromDefaults uses autonomous subagents all on", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    subagentDefaults: { ...subagentDefaults, reviewer: false },
    workflowDefaults: { orchestrationMode: "autonomous" },
    routeProfileId: "profile-b",
  });
  expect(config.routeProfileId).toBe("profile-b");
  expect(config.orchestrationMode).toBe("autonomous");
  expect(config.subagentEnabled.reviewer).toBe(true);
  expect(isAutonomousThreadRuntime(config)).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults respects manual subagent toggles", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    subagentDefaults: { ...subagentDefaults, reviewer: false },
    workflowDefaults: { orchestrationMode: "manual" },
  });
  expect(config.orchestrationMode).toBe("manual");
  expect(config.subagentEnabled.reviewer).toBe(false);
});

test("buildThreadRuntimeConfigFromDefaults can target a generic Agent Profile without routes", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: genericSettings,
    subagentDefaults,
    workflowDefaults: { orchestrationMode: "autonomous" },
    agentProfileId: "research-copy",
  });

  expect(config.agentProfileId).toBe("research-copy");
  expect(config.routeProfileId).toBe("research-copy");
  expect(resolveThreadAgentProfile(genericSettings, config)?.preset).toBe("research");
});

test("buildThreadRuntimeConfigFromDefaults does not let default routes override selected Agent Profile", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: mixedSettings,
    subagentDefaults,
    workflowDefaults: { orchestrationMode: "autonomous" },
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
        ...researchProfile.agents[0]!,
        agentKey: "research lead",
        modelRef: { providerId: "agent-provider", modelId: "agent-model" },
        enabled: true,
      },
      {
        ...researchProfile.agents[0]!,
        agentKey: "disabled_agent",
        modelRef: { providerId: "disabled-provider", modelId: "disabled-model" },
        enabled: false,
      },
    ],
  };

  expect(runtimeRoleRoutesFromAgentProfile(profile)).toEqual([
    { role: "planner", providerId: "main-provider", modelId: "main-model" },
    { role: "research lead", providerId: "agent-provider", modelId: "agent-model" },
  ]);
});

test("serialize and parse thread runtime config round-trip", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    subagentDefaults,
    workflowDefaults: { orchestrationMode: "manual" },
  });
  const json = serializeThreadRuntimeConfig(config);
  expect(parseThreadRuntimeConfigJson(json)).toEqual(normalizeThreadRuntimeConfig(config));
});

test("parseThreadRuntimeConfigJson accepts agentProfileId-only payloads", () => {
  expect(
    parseThreadRuntimeConfigJson(
      JSON.stringify({
        agentProfileId: "research-copy",
        subagentEnabled: subagentDefaults,
        orchestrationMode: "autonomous",
      }),
    ),
  ).toEqual({
    routeProfileId: "",
    agentProfileId: "research-copy",
    subagentEnabled: subagentDefaults,
    orchestrationMode: "autonomous",
  });
});

test("normalizeThreadRuntimeConfig migrates legacy planModeEnabled", () => {
  expect(
    normalizeThreadRuntimeConfig({
      routeProfileId: "profile-a",
      subagentEnabled: subagentDefaults,
      planModeEnabled: true,
    } as never),
  ).toEqual({
    routeProfileId: "profile-a",
    subagentEnabled: subagentDefaults,
    orchestrationMode: "manual",
  });
});

test("isThreadRuntimeConfig rejects invalid payloads", () => {
  expect(isThreadRuntimeConfig(null)).toBe(false);
  expect(
    isThreadRuntimeConfig({ routeProfileId: "", orchestrationMode: "manual", subagentEnabled: {} }),
  ).toBe(false);
});
