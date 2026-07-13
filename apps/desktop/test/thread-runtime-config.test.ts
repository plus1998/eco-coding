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
  resolveMainAgentSystemPromptPreset,
  resolveThreadAgentProfile,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromAgentProfile,
  serializeThreadRuntimeConfig,
  withAgentSessionMode,
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
    workflowDefaults: { sessionMode: "agent" },
    agentProfileId: "profile-b",
  });
  expect(config.routeProfileId).toBe("profile-b");
  expect(config.agentProfileId).toBe("profile-b");
  expect(config.sessionMode).toBe("agent");
  expect(config.subagentEnabled.reviewer).toBe(true);
  expect(isAutonomousThreadRuntime(config)).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults uses default subagents with plan session mode", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "plan" },
  });
  expect(config.agentProfileId).toBe("profile-a");
  expect(config.sessionMode).toBe("plan");
  expect(config.subagentEnabled.reviewer).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults can target a generic Agent Profile without routes", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: genericSettings,
    workflowDefaults: { sessionMode: "agent" },
    agentProfileId: "generic-copy",
  });

  expect(config.agentProfileId).toBe("generic-copy");
  expect(config.routeProfileId).toBe("generic-copy");
  expect(resolveThreadAgentProfile(genericSettings, config)?.preset).toBe("coding");
});

test("buildThreadRuntimeConfigFromDefaults does not let default routes override selected Agent Profile", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: mixedSettings,
    workflowDefaults: { sessionMode: "agent" },
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
    workflowDefaults: { sessionMode: "plan" },
  });
  const json = serializeThreadRuntimeConfig(config);
  expect(json).toContain("sessionMode");
  expect(json).not.toContain("planModeEnabled");
  expect(json).not.toContain("orchestrationMode");
  expect(parseThreadRuntimeConfigJson(json)).toEqual(normalizeThreadRuntimeConfig(config));
});

test("thread runtime config preserves and normalizes a main-agent model override", () => {
  const config = {
    ...buildThreadRuntimeConfigFromDefaults({
      settings: agentSettings,
      workflowDefaults: { sessionMode: "agent" },
    }),
    mainAgentModelOverride: {
      providerId: " provider-alt ",
      modelId: " gpt-5.6-sol ",
      candidateModelId: " candidate-sol ",
      thinkingEffort: "high" as const,
    },
  };

  const normalized = normalizeThreadRuntimeConfig(config);
  expect(normalized.mainAgentModelOverride).toEqual({
    providerId: "provider-alt",
    modelId: "gpt-5.6-sol",
    candidateModelId: "candidate-sol",
    thinkingEffort: "high",
  });
  expect(parseThreadRuntimeConfigJson(serializeThreadRuntimeConfig(config))).toEqual(normalized);
});

test("thread runtime config preserves a temporary main-agent system prompt preset", () => {
  const config = {
    ...buildThreadRuntimeConfigFromDefaults({
      settings: agentSettings,
      workflowDefaults: { sessionMode: "agent" },
    }),
    mainAgentSystemPromptPresetOverride: "custom" as const,
  };

  const normalized = normalizeThreadRuntimeConfig(config);
  expect(normalized.mainAgentSystemPromptPresetOverride).toBe("custom");
  expect(parseThreadRuntimeConfigJson(serializeThreadRuntimeConfig(config))).toEqual(normalized);
  expect(resolveMainAgentSystemPromptPreset(profileA, normalized)).toBe("custom");
});

test("main-agent system prompt preset falls back to the selected profile", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "agent" },
  });

  expect(resolveMainAgentSystemPromptPreset(profileA, config)).toBe(profileA.mainAgent.systemPromptPreset);
});

test("thread runtime config accepts a main-agent model override without thinking effort", () => {
  const config = {
    ...buildThreadRuntimeConfigFromDefaults({
      settings: agentSettings,
      workflowDefaults: { sessionMode: "agent" },
    }),
    mainAgentModelOverride: {
      providerId: " p1 ",
      modelId: " gpt-5.6-sol ",
    },
  };

  expect(isThreadRuntimeConfig(config)).toBe(true);
  expect(normalizeThreadRuntimeConfig(config).mainAgentModelOverride).toEqual({
    providerId: "p1",
    modelId: "gpt-5.6-sol",
  });
  expect(parseThreadRuntimeConfigJson(serializeThreadRuntimeConfig(config))).toEqual(
    normalizeThreadRuntimeConfig(config),
  );
});

test("thread runtime config rejects malformed main-agent model overrides", () => {
  const base = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "agent" },
  });
  expect(
    isThreadRuntimeConfig({ ...base, mainAgentModelOverride: { modelId: "m2", thinkingEffort: "high" } }),
  ).toBe(false);
  expect(
    isThreadRuntimeConfig({
      ...base,
      mainAgentModelOverride: { providerId: "p1", modelId: "m2", thinkingEffort: "ultra" },
    }),
  ).toBe(false);
  expect(
    parseThreadRuntimeConfigJson(
      JSON.stringify({
        ...base,
        mainAgentModelOverride: { providerId: "p1", modelId: "m2", thinkingEffort: "ultra" },
      }),
    ),
  ).toBeUndefined();
});

test("thread runtime config rejects malformed system prompt preset overrides", () => {
  const base = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "agent" },
  });
  expect(isThreadRuntimeConfig({ ...base, mainAgentSystemPromptPresetOverride: "unknown" })).toBe(false);
});

test("runtime profile routes replace only the main agent with the temporary model", () => {
  const originalPlanner = profileA.mainAgent.modelRef;
  const routes = runtimeRoleRoutesFromAgentProfile(profileA, {
    providerId: "p1",
    modelId: "gpt-5.6-sol",
    candidateModelId: "candidate-sol",
    thinkingEffort: "high",
  });

  expect(routes.find((route) => route.role === "planner")).toEqual({
    role: "planner",
    providerId: "p1",
    modelId: "gpt-5.6-sol",
    candidateModelId: "candidate-sol",
    thinkingEffort: "high",
  });
  expect(routes.find((route) => route.role === "explore")?.modelId).toBe("m1");
  expect(profileA.mainAgent.modelRef).toEqual(originalPlanner);
});

test("runtime profile routes do not add thinking effort when the override omits it", () => {
  const routes = runtimeRoleRoutesFromAgentProfile(profileA, {
    providerId: "p1",
    modelId: "gpt-5.6-sol",
  });

  expect(routes.find((route) => route.role === "planner")).toEqual({
    role: "planner",
    providerId: "p1",
    modelId: "gpt-5.6-sol",
  });
});

test("runtime profile routes ignore a main-agent override from another provider", () => {
  const routes = runtimeRoleRoutesFromAgentProfile(profileA, {
    providerId: "provider-alt",
    modelId: "gpt-5.6-sol",
    thinkingEffort: "high",
  });

  expect(routes.find((route) => route.role === "planner")).toEqual({
    role: "planner",
    providerId: "p1",
    modelId: "m1",
  });
});

test("parseThreadRuntimeConfigJson accepts agentProfileId-only payloads with sessionMode", () => {
  expect(
    parseThreadRuntimeConfigJson(
      JSON.stringify({
        agentProfileId: "generic-copy",
        subagentEnabled: threadSubagentEnabled,
        sessionMode: "agent",
      }),
    ),
  ).toEqual({
    routeProfileId: "",
    agentProfileId: "generic-copy",
    subagentEnabled: threadSubagentEnabled,
    sessionMode: "agent",
    bashReviewMode: "always",
  });
});

test("buildThreadRuntimeConfigFromDefaults supports ask workflow default", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "ask" },
  });
  expect(config.sessionMode).toBe("ask");
});

test("withAgentSessionMode switches plan to agent without mutating the original config", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "plan" },
  });
  expect(withAgentSessionMode(config, "agent")).toEqual({ ...config, sessionMode: "agent" });
  expect(config.sessionMode).toBe("plan");
  expect(withAgentSessionMode({ ...config, sessionMode: "agent" }, "agent")).toEqual({
    ...config,
    sessionMode: "agent",
  });
});

test("normalizeThreadRuntimeConfig preserves sessionMode", () => {
  expect(
    normalizeThreadRuntimeConfig({
      routeProfileId: "profile-a",
      subagentEnabled: threadSubagentEnabled,
      sessionMode: "plan",
    } as never),
  ).toEqual({
    routeProfileId: "profile-a",
    subagentEnabled: threadSubagentEnabled,
    sessionMode: "plan",
    bashReviewMode: "always",
  });
});

test("parseThreadRuntimeConfigJson rejects legacy orchestrationMode-only payloads", () => {
  expect(
    parseThreadRuntimeConfigJson(
      JSON.stringify({
        routeProfileId: "profile-a",
        subagentEnabled: threadSubagentEnabled,
        orchestrationMode: "manual",
      }),
    ),
  ).toBeUndefined();
});

test("isBashReviewModeOnlyRuntimeConfigUpdate allows bashReviewMode changes only", () => {
  const base = {
    routeProfileId: "profile-a",
    agentProfileId: "profile-a",
    subagentEnabled: threadSubagentEnabled,
    sessionMode: "plan" as const,
    bashReviewMode: "always" as const,
  };
  expect(isBashReviewModeOnlyRuntimeConfigUpdate(base, { ...base, bashReviewMode: "auto" })).toBe(true);
  expect(isBashReviewModeOnlyRuntimeConfigUpdate(base, { ...base, sessionMode: "agent" })).toBe(false);
  expect(
    isBashReviewModeOnlyRuntimeConfigUpdate(base, {
      ...base,
      subagentEnabled: { ...threadSubagentEnabled, coder: false },
    }),
  ).toBe(false);
  expect(
    isBashReviewModeOnlyRuntimeConfigUpdate(base, {
      ...base,
      mainAgentModelOverride: {
        providerId: "p2",
        modelId: "gpt-5.6-sol",
        thinkingEffort: "high",
      },
    }),
  ).toBe(false);
  expect(
    isBashReviewModeOnlyRuntimeConfigUpdate(base, {
      ...base,
      mainAgentSystemPromptPresetOverride: "custom",
    }),
  ).toBe(false);
});

test("isThreadRuntimeConfig rejects invalid payloads", () => {
  expect(isThreadRuntimeConfig(null)).toBe(false);
  expect(
    isThreadRuntimeConfig({ routeProfileId: "", orchestrationMode: "manual", subagentEnabled: {} }),
  ).toBe(false);
});

test("buildThreadRuntimeConfigFromDefaults seeds MCP from profile and remembered workflow defaults", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "agent", mcpServersEnabled: { mongo: true } },
    mcpServers: [
      {
        id: "m1",
        name: "mongo",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [],
        env: {},
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "m2",
        name: "browser",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [],
        env: {},
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
  });
  expect(config.mcpServersEnabled).toEqual({ mongo: true, browser: false });
});

test("resolveThreadRuntimeMcpServerKeys uses composer overrides when present", () => {
  const runtimeConfig = buildThreadRuntimeConfigFromDefaults({
    settings: agentSettings,
    workflowDefaults: { sessionMode: "agent" },
    mcpServers: [
      {
        id: "m1",
        name: "mongo",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [],
        env: {},
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "m2",
        name: "browser",
        transport: "stdio",
        enabled: true,
        command: "npx",
        args: [],
        env: {},
        updatedAt: "2020-01-01T00:00:00.000Z",
      },
    ],
  });
  const withOverride = {
    ...runtimeConfig,
    mcpServersEnabled: { mongo: false, browser: true },
  };
  expect(
    resolveThreadRuntimeMcpServerKeys({
      runtimeConfig: withOverride,
      settings: agentSettings,
      availableMcpServerKeys: ["mongo", "browser"],
    }),
  ).toEqual(["browser"]);
});
