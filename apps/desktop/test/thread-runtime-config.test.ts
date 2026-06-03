import { expect, test } from "bun:test";
import {
  buildThreadRuntimeConfigFromDefaults,
  getDefaultRouteProfileId,
  getRoutesForProfile,
  isThreadRuntimeConfig,
  normalizeThreadRuntimeConfig,
  parseThreadRuntimeConfigJson,
  serializeThreadRuntimeConfig,
} from "../src/shared/thread-runtime-config";
import type { ModelSettingsSnapshot, SubagentEnabledSettings } from "../src/shared/ipc";

const subagentDefaults: SubagentEnabledSettings = {
  explore: true,
  architect: true,
  coder: true,
  reviewer: true,
  tester: true,
};

const settings: ModelSettingsSnapshot = {
  providers: [],
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

test("buildThreadRuntimeConfigFromDefaults snapshots defaults", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    subagentDefaults,
    workflowDefaults: { planModeEnabled: false },
    routeProfileId: "profile-b",
  });
  expect(config.routeProfileId).toBe("profile-b");
  expect(config.planModeEnabled).toBe(false);
  expect(config.subagentEnabled.coder).toBe(true);
});

test("serialize and parse thread runtime config round-trip", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    subagentDefaults,
    workflowDefaults: { planModeEnabled: true },
  });
  const json = serializeThreadRuntimeConfig(config);
  expect(parseThreadRuntimeConfigJson(json)).toEqual(normalizeThreadRuntimeConfig(config));
});

test("isThreadRuntimeConfig rejects invalid payloads", () => {
  expect(isThreadRuntimeConfig(null)).toBe(false);
  expect(isThreadRuntimeConfig({ routeProfileId: "", planModeEnabled: true, subagentEnabled: {} })).toBe(
    false,
  );
});
