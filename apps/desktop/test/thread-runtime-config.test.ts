import { expect, test } from "bun:test";
import type { ModelSettingsSnapshot, SubagentEnabledSettings } from "../src/shared/ipc";
import {
  buildThreadRuntimeConfigFromDefaults,
  getDefaultRouteProfileId,
  getRoutesForProfile,
  isAutonomousThreadRuntime,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
  parseThreadRuntimeConfigJson,
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

test("getDefaultRouteProfileId returns first profile", () => {
  expect(getDefaultRouteProfileId(settings)).toBe("profile-a");
});

test("getRoutesForProfile resolves routes by id", () => {
  expect(getRoutesForProfile(settings, "profile-b")?.[0]?.modelId).toBe("m2");
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

test("serialize and parse thread runtime config round-trip", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    subagentDefaults,
    workflowDefaults: { orchestrationMode: "manual" },
  });
  const json = serializeThreadRuntimeConfig(config);
  expect(parseThreadRuntimeConfigJson(json)).toEqual(normalizeThreadRuntimeConfig(config));
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
