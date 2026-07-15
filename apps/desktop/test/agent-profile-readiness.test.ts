import { expect, test } from "bun:test";
import { areCodingRoutesReady, isAgentProfileReady } from "../src/renderer/agent-profile-readiness";
import { CODING_AGENT_TEMPLATE_IDS, createBuiltInAgentTemplates } from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, OrchestrationProfile, ToolPolicy } from "../src/shared/ipc";

const tools: ToolPolicy = { allowed: [], disallowed: [] };
const exploreTools = createBuiltInAgentTemplates().find(
  (template) => template.id === CODING_AGENT_TEMPLATE_IDS.explore,
)!.defaultTools;

const provider: ModelSettingsSnapshot["providers"][number] = {
  id: "p1",
  name: "Provider",
  baseUrl: "https://api.example.test",
  requestPath: "",
  apiCompat: "anthropic",
  defaultModel: "main-model",
  enabled: true,
  hasApiKey: true,
  apiKeyPreview: "sk-...",
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
};

function profile(agentEnabled: boolean): OrchestrationProfile {
  return {
    id: "custom",
    name: "Custom",
    preset: "custom",
    mainAgent: {
      agentKey: "main",
      name: "Main",
      domain: "custom",
      systemPromptPreset: "custom_append",
      prompt: "Lead.",
      modelRef: { providerId: "p1", modelId: "main-model" },
      tools,
      skills: [],
    },
    agents: [
      {
        agentKey: "explore",
        templateId: CODING_AGENT_TEMPLATE_IDS.explore,
        modelRef: { providerId: "p1", modelId: "explore-model" },
        tools: exploreTools,
        mcpServers: [],
        skills: [],
        enabled: true,
      },
      {
        agentKey: "draft",
        templateId: "draft",
        modelRef: { providerId: "missing", modelId: "draft-model" },
        tools,
        mcpServers: [],
        skills: [],
        enabled: agentEnabled,
      },
    ],
    strategy: { kind: "autonomous" },
    updatedAt: "2026-06-07T00:00:00.000Z",
    source: "user",
  };
}

test("isAgentProfileReady ignores disabled agent model refs", () => {
  const providers = new Map([[provider.id, provider]]);

  expect(isAgentProfileReady(profile(false), providers)).toBe(true);
  expect(isAgentProfileReady(profile(true), providers)).toBe(false);
});

test("isAgentProfileReady validates Explore when its node exists", () => {
  const providers = new Map([[provider.id, provider]]);
  const draft = profile(false);
  draft.agents[0]!.modelRef = { providerId: "missing", modelId: "explore-model" };

  expect(isAgentProfileReady(draft, providers)).toBe(false);
  draft.agents = draft.agents.filter((agent) => agent.agentKey !== "explore");
  expect(isAgentProfileReady(draft, providers)).toBe(true);
});

test("isAgentProfileReady evaluates the temporary main model override", () => {
  const overrideProvider = { ...provider, id: "p2", name: "Override Provider" };
  const providers = new Map([
    [provider.id, provider],
    [overrideProvider.id, overrideProvider],
  ]);
  const draft = profile(false);
  draft.mainAgent.modelRef = { providerId: "p1", modelId: "" };

  expect(isAgentProfileReady(draft, providers)).toBe(false);
  expect(
    isAgentProfileReady(draft, providers, {
      providerId: "p1",
      modelId: "gpt-5.6-sol",
      thinkingEffort: "high",
    }),
  ).toBe(true);
  expect(
    isAgentProfileReady(draft, providers, {
      providerId: "p2",
      modelId: "gpt-5.6-sol",
      thinkingEffort: "high",
    }),
  ).toBe(false);
});

test("areCodingRoutesReady accepts the actual configured coding roster", () => {
  const providers = new Map([[provider.id, provider]]);

  expect(
    areCodingRoutesReady(
      [
        { role: "planner", providerId: "p1", modelId: "main-model" },
        { role: "coder", providerId: "p1", modelId: "coder-model" },
      ],
      providers,
    ),
  ).toBe(true);
});
