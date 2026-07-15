import { expect, test } from "bun:test";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";
import type { McpServerConfigView, ModelSettingsSnapshot } from "../src/shared/ipc";
import {
  formatProfileModelStack,
  formatPromptCacheConfigDriftHint,
  formatPromptCacheConfigDriftMessage,
  resolvePromptCacheConfigDrift,
  resolvePromptCacheProfileLabel,
} from "../src/shared/prompt-cache-config";
import type { ThreadRuntimeConfig } from "../src/shared/thread-runtime-config";

const codingPreset = createBuiltInPresetCatalog().find((preset) => preset.id === "coding");
if (!codingPreset) {
  throw new Error("Missing built-in coding preset.");
}

const profileA = buildOrchestrationProfileFromPreset(codingPreset, {
  id: "profile-a",
  name: "Profile A",
  modelRef: { providerId: "p1", modelId: "m1" },
  updatedAt: "2026-06-07T00:00:00.000Z",
});
const profileB = buildOrchestrationProfileFromPreset(codingPreset, {
  id: "profile-b",
  name: "Profile B",
  modelRef: { providerId: "p1", modelId: "m1" },
  updatedAt: "2026-06-07T00:00:00.000Z",
});

const settings: ModelSettingsSnapshot = {
  providers: [
    {
      id: "p1",
      name: "GPT",
      baseUrl: "https://example.com",
      requestPath: "",
      apiCompat: "anthropic",
      defaultModel: "m1",
      enabled: true,
      hasApiKey: true,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
    {
      id: "p2",
      name: "DeepSeek",
      baseUrl: "https://example.com",
      requestPath: "",
      apiCompat: "anthropic",
      defaultModel: "m2",
      enabled: true,
      hasApiKey: true,
      createdAt: "2026-06-07T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
    },
  ],
  agentTemplates: [],
  orchestrationProfiles: [profileA, profileB],
  routeProfiles: [],
};

const mcpServers = [
  { name: "github", enabled: true },
  { name: "mongo", enabled: true },
] as McpServerConfigView[];

function config(overrides: Partial<ThreadRuntimeConfig>): ThreadRuntimeConfig {
  return {
    routeProfileId: "profile-a",
    agentProfileId: "profile-a",
    subagentEnabled: {},
    sessionMode: "agent",
    bashReviewMode: "always",
    ...overrides,
  } as ThreadRuntimeConfig;
}

test("resolvePromptCacheConfigDrift detects profile and mcp changes", () => {
  const baseline = config({ mcpServersEnabled: { github: true, mongo: false } });
  expect(
    resolvePromptCacheConfigDrift({
      baseline,
      current: config({
        agentProfileId: "profile-b",
        routeProfileId: "profile-b",
        mcpServersEnabled: { github: true, mongo: false },
      }),
      settings,
      mcpServers,
    }),
  ).toEqual(["profile"]);
  expect(
    resolvePromptCacheConfigDrift({
      baseline,
      current: config({ mcpServersEnabled: { github: true, mongo: true } }),
      settings,
      mcpServers,
    }),
  ).toEqual(["mcp"]);
  expect(
    resolvePromptCacheConfigDrift({
      baseline,
      current: config({
        agentProfileId: "profile-b",
        routeProfileId: "profile-b",
        mcpServersEnabled: { github: true, mongo: false },
        mainAgentModelOverride: {
          providerId: "p1",
          modelId: "m2",
          thinkingEffort: "high",
        },
      }),
      settings,
      mcpServers,
    }),
  ).toEqual(["profile", "main_model"]);
});

test("resolvePromptCacheConfigDrift ignores an override from another provider", () => {
  expect(
    resolvePromptCacheConfigDrift({
      baseline: config({}),
      current: config({
        mainAgentModelOverride: {
          providerId: "p2",
          modelId: "m2",
          thinkingEffort: "high",
        },
      }),
      settings,
      mcpServers,
    }),
  ).toEqual([]);
});

test("resolvePromptCacheConfigDrift detects main model or thinking changes within one profile", () => {
  const baseline = config({});
  expect(
    resolvePromptCacheConfigDrift({
      baseline,
      current: config({
        mainAgentModelOverride: {
          providerId: "p1",
          modelId: "m1",
          thinkingEffort: "high",
          candidateModelId: "candidate-a",
        },
      }),
      settings,
      mcpServers,
    }),
  ).toEqual(["main_model"]);

  expect(
    resolvePromptCacheConfigDrift({
      baseline: config({
        mainAgentModelOverride: {
          providerId: "p1",
          modelId: "m1",
          thinkingEffort: "high",
          candidateModelId: "candidate-a",
        },
      }),
      current: config({
        mainAgentModelOverride: {
          providerId: "p1",
          modelId: "m1",
          thinkingEffort: "high",
          candidateModelId: "candidate-b",
        },
      }),
      settings,
      mcpServers,
    }),
  ).toEqual([]);
});

test("resolvePromptCacheConfigDrift detects a temporary system prompt switch", () => {
  expect(
    resolvePromptCacheConfigDrift({
      baseline: config({}),
      current: config({ mainAgentSystemPromptPresetOverride: "custom_append" }),
      settings,
      mcpServers,
    }),
  ).toEqual(["system_prompt"]);
  expect(formatPromptCacheConfigDriftHint(["system_prompt"])).toContain("主代理提示词已变更");
});

test("resolvePromptCacheConfigDrift uses inherited effort for a same-model override", () => {
  const profileWithEffort = structuredClone(profileA);
  profileWithEffort.mainAgent.modelRef.thinkingEffort = "high";
  const settingsWithEffort = {
    ...settings,
    orchestrationProfiles: [profileWithEffort],
  };

  expect(
    resolvePromptCacheConfigDrift({
      baseline: config({}),
      current: config({
        mainAgentModelOverride: {
          providerId: "p1",
          modelId: "m1",
        },
      }),
      settings: settingsWithEffort,
      mcpServers,
    }),
  ).toEqual([]);
});

test("formatPromptCacheConfigDriftHint describes combined drift", () => {
  expect(
    formatPromptCacheConfigDriftHint(["profile", "mcp"], {
      profileLabel: { modelStack: "GPT+DeepSeek", profileName: "Composer" },
    }),
  ).toContain("已经变更为 GPT+DeepSeek（Composer）");
  expect(
    formatPromptCacheConfigDriftHint(["profile", "mcp"], {
      profileLabel: { modelStack: "GPT+DeepSeek", profileName: "Composer" },
    }),
  ).toContain("MCP 配置已变更");
  expect(formatPromptCacheConfigDriftHint(["mcp"])).toContain("仍可继续使用");
  expect(formatPromptCacheConfigDriftHint(["main_model"])).toContain("主代理模型或思考强度已变更");
});

test("resolvePromptCacheProfileLabel builds provider stack and profile name", () => {
  const profile = buildOrchestrationProfileFromPreset(codingPreset, {
    id: "profile-stack",
    name: "Composer",
    modelRef: { providerId: "p1", modelId: "m1" },
    updatedAt: "2026-06-07T00:00:00.000Z",
  });
  profile.agents = profile.agents.map((agent) =>
    agent.agentKey === "explore" ? { ...agent, modelRef: { providerId: "p2", modelId: "m2" } } : agent,
  );
  const stackSettings: ModelSettingsSnapshot = {
    ...settings,
    orchestrationProfiles: [profile],
  };
  expect(
    resolvePromptCacheProfileLabel(
      stackSettings,
      config({ agentProfileId: "profile-stack", routeProfileId: "profile-stack" }),
    ),
  ).toEqual({
    modelStack: "GPT+DeepSeek",
    profileName: "Composer",
  });
  expect(formatProfileModelStack(profile, stackSettings.providers)).toBe("GPT+DeepSeek");
});

test("formatPromptCacheConfigDriftMessage uses profile switch phrase", () => {
  expect(
    formatPromptCacheConfigDriftMessage(["profile"], {
      profileLabel: { modelStack: "GPT+DeepSeek", profileName: "Composer" },
    }),
  ).toBe("已经变更为 GPT+DeepSeek（Composer）");
  expect(formatPromptCacheConfigDriftMessage(["main_model"])).toBe("主代理模型或思考强度已变更");
});

test("resolvePromptCacheConfigDrift returns empty when signatures match", () => {
  expect(
    resolvePromptCacheConfigDrift({
      baseline: config({ mcpServersEnabled: { github: true } }),
      current: config({ mcpServersEnabled: { github: true } }),
      settings,
      mcpServers,
    }),
  ).toEqual([]);
});
