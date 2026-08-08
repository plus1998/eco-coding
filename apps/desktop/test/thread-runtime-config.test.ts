import { expect, test } from "bun:test";
import {
  buildResourcesFromRouteProfile,
  resolveOrchestrationSnapshot,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, SubagentEnabledSettings } from "../src/shared/ipc";
import {
  buildThreadRuntimeConfigFromDefaults,
  deriveSubagentEnabledFromSnapshot,
  hasCompleteOrchestrationSelection,
  isAutonomousThreadRuntime,
  isBashReviewModeOnlyRuntimeConfigUpdate,
  isThreadRuntimeConfig,
  materializeThreadOrchestrationSnapshot,
  normalizeThreadRuntimeConfig,
  parseThreadRuntimeConfigJson,
  resolveMainAgentSystemPromptPreset,
  resolveThreadOrchestrationSnapshot,
  resolveThreadRuntimeMcpServerKeys,
  runtimeRoleRoutesFromOrchestrationSnapshot,
  serializeThreadRuntimeConfig,
  threadRuntimeConfigsEquivalent,
  withAgentSessionMode,
} from "../src/shared/thread-runtime-config";

const presetBundle = buildResourcesFromRouteProfile({
  id: "coding-default",
  name: "Default coding",
  routes: [
    { role: "planner", providerId: "p1", modelId: "m1" },
    { role: "explore", providerId: "p1", modelId: "m1" },
    { role: "architect", providerId: "p1", modelId: "m1" },
    { role: "coder", providerId: "p1", modelId: "m1" },
    { role: "reviewer", providerId: "p1", modelId: "m1" },
    { role: "tester", providerId: "p1", modelId: "m1" },
  ],
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
}, {
  mainAgentConfigId: "user.coding.main",
  subagentOrchestrationId: "user.coding.subagents",
});

const settings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [],
  agentTemplates: [],
  mainAgentConfigs: [presetBundle.mainAgentConfig],
  mainAgentPrompts: presetBundle.mainAgentPrompt ? [presetBundle.mainAgentPrompt] : [],
  subagentOrchestrations: [presetBundle.subagentOrchestration],
};

const threadSubagentEnabled: SubagentEnabledSettings = {
  explore: true,
  architect: true,
  coder: true,
  reviewer: true,
  tester: true,
};

test("hasCompleteOrchestrationSelection accepts builtin prompt and orchestration subagents", () => {
  expect(hasCompleteOrchestrationSelection(presetBundle.selection)).toBe(true);
});

test("hasCompleteOrchestrationSelection accepts none subagents", () => {
  expect(
    hasCompleteOrchestrationSelection({
      mainAgentConfigId: "user.coding.main",
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "none" },
    }),
  ).toBe(true);
});

test("resolveOrchestrationSnapshot returns empty agents for none subagents", () => {
  const snapshot = resolveOrchestrationSnapshot(
    {
      mainAgentConfigId: presetBundle.mainAgentConfig.id,
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "none" },
    },
    {
      mainAgentConfigs: settings.mainAgentConfigs,
      mainAgentPrompts: settings.mainAgentPrompts,
      subagentOrchestrations: settings.subagentOrchestrations,
    },
  );
  expect(snapshot.agents).toEqual([]);
});

test("buildThreadRuntimeConfigFromDefaults materializes orchestration snapshot", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: {
      sessionMode: "agent",
      defaultOrchestrationSelection: presetBundle.selection,
      defaultAuxiliaryModel: {
        providerId: "p1",
        modelId: "m1",
        candidateModelId: "candidate-1",
      },
      defaultVisionModel: {
        providerId: "p1",
        modelId: "vision-1",
        candidateModelId: "candidate-vision-1",
      },
    },
  });
  expect(config.orchestrationSelection).toEqual(presetBundle.selection);
  expect(config.resolvedOrchestrationSnapshot?.mainAgent.modelRef.modelId).toBe("m1");
  expect(config.auxiliaryModel?.candidateModelId).toBe("candidate-1");
  expect(config.visionModel?.candidateModelId).toBe("candidate-vision-1");
  expect(isAutonomousThreadRuntime(config)).toBe(true);
  expect(config.bashReviewMode).toBe("always");
});

test("buildThreadRuntimeConfigFromDefaults ignores main agent tools.confirmation", () => {
  const settingsWithConfirmation: ModelSettingsSnapshot = {
    ...settings,
    mainAgentConfigs: [
      {
        ...presetBundle.mainAgentConfig,
        tools: {
          ...presetBundle.mainAgentConfig.tools,
          confirmation: "never",
        },
      },
    ],
  };
  const config = buildThreadRuntimeConfigFromDefaults({
    settings: settingsWithConfirmation,
    workflowDefaults: {
      sessionMode: "agent",
      defaultOrchestrationSelection: presetBundle.selection,
    },
  });
  expect(config.bashReviewMode).toBe("always");
  expect(config.resolvedOrchestrationSnapshot?.mainAgent.tools.confirmation).toBe("never");
});

test("threadRuntimeConfigsEquivalent ignores resolvedAt churn", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: {
      sessionMode: "agent",
      defaultOrchestrationSelection: presetBundle.selection,
    },
  });
  const refreshed = materializeThreadOrchestrationSnapshot(settings, presetBundle.selection);
  const other = {
    ...config,
    ...refreshed,
  };
  expect(threadRuntimeConfigsEquivalent(config, other)).toBe(true);
});

test("buildThreadRuntimeConfigFromDefaults throws without main agent configs", () => {
  expect(() =>
    buildThreadRuntimeConfigFromDefaults({
      settings: { ...settings, mainAgentConfigs: [] },
      workflowDefaults: { sessionMode: "agent" },
    }),
  ).toThrow(/主代理.*提示词.*子代理编排|main agent.*prompt.*subagent orchestration/i);
});

test("buildThreadRuntimeConfigFromDefaults rejects a missing selection", () => {
  expect(() =>
    buildThreadRuntimeConfigFromDefaults({
      settings,
      workflowDefaults: { sessionMode: "agent" },
    }),
  ).toThrow(/主代理.*提示词.*子代理编排|main agent.*prompt.*subagent orchestration/i);
});

test("parseThreadRuntimeConfigJson rejects legacy profile fields", () => {
  const legacy = {
    routeProfileId: "old-profile",
    agentProfileId: "old-profile",
    mainAgentConfigId: presetBundle.mainAgentConfig.id,
    subagentOrchestrationId: presetBundle.subagentOrchestration.id,
    mainPrompt: { mode: "builtin" },
    subagentEnabled: threadSubagentEnabled,
    sessionMode: "agent",
    bashReviewMode: "auto",
  };
  expect(parseThreadRuntimeConfigJson(JSON.stringify(legacy))).toBeUndefined();
});

test("materializeThreadOrchestrationSnapshot persists selection and snapshot", () => {
  const materialized = materializeThreadOrchestrationSnapshot(settings, presetBundle.selection);
  expect(materialized.orchestrationSelection).toEqual(presetBundle.selection);
  expect(materialized.resolvedOrchestrationSnapshot?.agents.length).toBeGreaterThan(0);
});

test("runtimeRoleRoutesFromOrchestrationSnapshot includes planner and enabled agents", () => {
  const snapshot = resolveOrchestrationSnapshot(presetBundle.selection, {
    mainAgentConfigs: settings.mainAgentConfigs,
    mainAgentPrompts: settings.mainAgentPrompts,
    subagentOrchestrations: settings.subagentOrchestrations,
  });
  const routes = runtimeRoleRoutesFromOrchestrationSnapshot(snapshot);
  expect(routes.some((route) => route.role === "planner")).toBe(true);
  expect(routes.some((route) => route.role === "coder")).toBe(true);
});

test("deriveSubagentEnabledFromSnapshot intersects with roster", () => {
  const snapshot = resolveOrchestrationSnapshot(
    {
      mainAgentConfigId: presetBundle.mainAgentConfig.id,
      mainPrompt: { mode: "builtin" },
      subagents: { mode: "none" },
    },
    {
      mainAgentConfigs: settings.mainAgentConfigs,
      mainAgentPrompts: settings.mainAgentPrompts,
      subagentOrchestrations: settings.subagentOrchestrations,
    },
  );
  const enabled = deriveSubagentEnabledFromSnapshot(snapshot);
  expect(enabled.coder).toBe(false);
});

test("serialize and parse round-trip new runtime config", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: {
      sessionMode: "agent",
      defaultOrchestrationSelection: presetBundle.selection,
    },
  });
  const parsed = parseThreadRuntimeConfigJson(serializeThreadRuntimeConfig(config));
  expect(parsed?.orchestrationSelection).toEqual(presetBundle.selection);
  expect(parsed?.resolvedOrchestrationSnapshot?.mainAgentConfigName).toBe("Default coding Main Config");
});

test("isBashReviewModeOnlyRuntimeConfigUpdate ignores bashReviewMode-only changes", () => {
  const base = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: {
      sessionMode: "agent",
      defaultOrchestrationSelection: presetBundle.selection,
    },
  });
  const next = JSON.parse(JSON.stringify({ ...base, bashReviewMode: "auto" })) as typeof base;
  expect(isBashReviewModeOnlyRuntimeConfigUpdate(base, next)).toBe(true);
  expect(base.bashReviewMode).toBe("always");
});

test("withAgentSessionMode updates session mode", () => {
  const config = normalizeThreadRuntimeConfig({
    orchestrationSelection: presetBundle.selection,
    subagentEnabled: threadSubagentEnabled,
    sessionMode: "plan",
    bashReviewMode: "auto",
  });
  expect(withAgentSessionMode(config).sessionMode).toBe("agent");
});

test("resolveThreadOrchestrationSnapshot prefers stored snapshot", () => {
  const config = buildThreadRuntimeConfigFromDefaults({
    settings,
    workflowDefaults: {
      sessionMode: "agent",
      defaultOrchestrationSelection: presetBundle.selection,
    },
  });
  expect(resolveThreadOrchestrationSnapshot(settings, config)?.mainAgentConfigName).toBe("Default coding Main Config");
});

test("resolveMainAgentSystemPromptPreset honors override", () => {
  const snapshot = resolveOrchestrationSnapshot(presetBundle.selection, {
    mainAgentConfigs: settings.mainAgentConfigs,
    mainAgentPrompts: settings.mainAgentPrompts,
    subagentOrchestrations: settings.subagentOrchestrations,
  });
  const config = normalizeThreadRuntimeConfig({
    orchestrationSelection: presetBundle.selection,
    resolvedOrchestrationSnapshot: snapshot,
    mainAgentSystemPromptPresetOverride: "custom_append",
    subagentEnabled: threadSubagentEnabled,
    sessionMode: "agent",
    bashReviewMode: "auto",
  });
  expect(resolveMainAgentSystemPromptPreset(snapshot, config)).toBe("custom_append");
});

test("isThreadRuntimeConfig validates orchestration selection", () => {
  expect(
    isThreadRuntimeConfig({
      orchestrationSelection: presetBundle.selection,
      subagentEnabled: threadSubagentEnabled,
      sessionMode: "agent",
      bashReviewMode: "auto",
    }),
  ).toBe(true);
});

test("resolveThreadRuntimeMcpServerKeys returns empty without snapshot", () => {
  expect(
    resolveThreadRuntimeMcpServerKeys({
      settings,
      availableMcpServerKeys: ["browser"],
      runtimeConfig: {
        subagentEnabled: threadSubagentEnabled,
        sessionMode: "agent",
        bashReviewMode: "auto",
      },
    }),
  ).toEqual([]);
});
