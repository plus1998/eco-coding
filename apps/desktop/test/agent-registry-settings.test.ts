import { expect, test } from "bun:test";
import { mergeAgentRegistrySettings } from "../src/main/agent-registry-settings";
import { createBuiltInAgentTemplates } from "../src/shared/agent-orchestration";
import type { AgentTemplate, ModelSettingsSnapshot, OrchestrationProfile } from "../src/shared/ipc";

function customTemplate(id: string): AgentTemplate {
  return {
    id,
    name: "Custom Researcher",
    description: "Custom research agent",
    domain: "research",
    prompt: "Research the topic.",
    whenToUse: "Use for research.",
    defaultTools: { allowed: ["WebSearch"], disallowed: [] },
    mcpServers: [],
    skills: [],
    allowDelegation: false,
    builtIn: false,
    source: "user",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function customProfile(id: string): OrchestrationProfile {
  return {
    id,
    name: "Custom Research",
    preset: "research",
    mainAgent: {
      agentKey: "main",
      name: "Research Lead",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate research.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: { allowed: ["Agent", "WebSearch"], disallowed: [] },
      skills: [],
    },
    agents: [],
    strategy: { kind: "autonomous" },
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "user",
  };
}

test("registry settings merge keeps built-in templates and user orchestration profiles", () => {
  const protectedTemplate = createBuiltInAgentTemplates()[0] as AgentTemplate;
  const base: ModelSettingsSnapshot = {
    providers: [],
    routeProfiles: [],
    agentTemplates: [protectedTemplate],
    orchestrationProfiles: [],
  };

  const merged = mergeAgentRegistrySettings(base, {
    listAgentTemplates: () => [customTemplate("user.researcher"), customTemplate(protectedTemplate.id)],
    listOrchestrationProfiles: () => [customProfile("user.research"), customProfile("user.coding")],
  });

  expect(merged.agentTemplates.map((template) => template.id)).toEqual([
    protectedTemplate.id,
    "user.researcher",
  ]);
  expect(merged.orchestrationProfiles.map((profile) => profile.id)).toEqual([
    "user.research",
    "user.coding",
  ]);
});
