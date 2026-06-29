import { expect, test } from "bun:test";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, McpServerConfigView } from "../src/shared/ipc";
import {
  diffPromptCacheRuntimeSignatures,
  formatPromptCacheConfigDriftHint,
  formatPromptCacheConfigDriftMessage,
  formatProfileModelStack,
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
});

test("resolvePromptCacheProfileLabel builds provider stack and profile name", () => {
  const profile = buildOrchestrationProfileFromPreset(codingPreset, {
    id: "profile-stack",
    name: "Composer",
    modelRef: { providerId: "p1", modelId: "m1" },
    updatedAt: "2026-06-07T00:00:00.000Z",
  });
  profile.builtinAgents.explore.modelRef = { providerId: "p2", modelId: "m2" };
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
});

test("diffPromptCacheRuntimeSignatures returns empty when signatures match", () => {
  expect(
    resolvePromptCacheConfigDrift({
      baseline: config({ mcpServersEnabled: { github: true } }),
      current: config({ mcpServersEnabled: { github: true } }),
      settings,
      mcpServers,
    }),
  ).toEqual([]);
});
