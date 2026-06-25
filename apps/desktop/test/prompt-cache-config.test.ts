import { expect, test } from "bun:test";
import {
  buildOrchestrationProfileFromPreset,
  createBuiltInPresetCatalog,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, McpServerConfigView } from "../src/shared/ipc";
import {
  diffPromptCacheRuntimeSignatures,
  formatPromptCacheConfigDriftHint,
  resolvePromptCacheConfigDrift,
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
  providers: [],
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
  expect(formatPromptCacheConfigDriftHint(["profile", "mcp"])).toContain("Agent Profile");
  expect(formatPromptCacheConfigDriftHint(["profile", "mcp"])).toContain("MCP 配置");
  expect(formatPromptCacheConfigDriftHint(["mcp"])).toContain("仍可继续使用");
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
