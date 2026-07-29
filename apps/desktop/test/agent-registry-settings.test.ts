import { expect, test } from "bun:test";
import { mergeAgentRegistrySettings } from "../src/main/agent-registry-settings";
import { createBuiltInAgentTemplates } from "../src/shared/agent-orchestration";
import type {
  AgentTemplate,
  MainAgentConfigResource,
  MainAgentPromptResource,
  ModelSettingsSnapshot,
  SubagentOrchestrationResource,
} from "../src/shared/ipc";

function customTemplate(id: string): AgentTemplate {
  return {
    id,
    name: "Custom Researcher",
    description: "Custom research agent",
    prompt: "Research the topic.",
    whenToUse: "Use for research.",
    defaultTools: { allowed: ["WebSearch"], disallowed: [] },
    mcpServers: [],
    skills: [],
    allowDelegation: false,
    builtIn: false,
    source: "user",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function customMainAgentConfig(id: string): MainAgentConfigResource {
  return {
    id,
    name: "Main Config",
    agentKey: "main",
    modelRef: { providerId: "p1", modelId: "m1" },
    tools: { allowed: ["Agent"], disallowed: [] },
    skills: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "user",
  };
}

function customMainAgentPrompt(id: string): MainAgentPromptResource {
  return {
    id,
    name: "Main Prompt",
    mode: "custom_append",
    prompt: "Append research guidance.",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "user",
  };
}

function customSubagentOrchestration(id: string): SubagentOrchestrationResource {
  return {
    id,
    name: "Subagents",
    agents: [],
    strategy: { kind: "autonomous" },
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "user",
  };
}

test("registry settings merge keeps built-in templates and user orchestration resources", () => {
  const protectedTemplate = createBuiltInAgentTemplates()[0] as AgentTemplate;
  const base: ModelSettingsSnapshot = {
    providers: [],
    routeProfiles: [],
    agentTemplates: [protectedTemplate],
    mainAgentConfigs: [],
    mainAgentPrompts: [],
    subagentOrchestrations: [],
  };

  const merged = mergeAgentRegistrySettings(base, {
    listAgentTemplates: () => [customTemplate("user.researcher"), customTemplate(protectedTemplate.id)],
    listMainAgentConfigs: () => [customMainAgentConfig("user.main.config")],
    listMainAgentPrompts: () => [customMainAgentPrompt("user.main.prompt")],
    listSubagentOrchestrations: () => [customSubagentOrchestration("user.subagents")],
  });

  expect(merged.agentTemplates.map((template) => template.id)).toEqual([
    protectedTemplate.id,
    "user.researcher",
  ]);
  expect(merged.mainAgentConfigs.map((config) => config.id)).toEqual(["user.main.config"]);
  expect(merged.mainAgentPrompts.map((prompt) => prompt.id)).toEqual(["user.main.prompt"]);
  expect(merged.subagentOrchestrations.map((orchestration) => orchestration.id)).toEqual([
    "user.subagents",
  ]);
});

test("registry settings merge replaces three resource tables from store", () => {
  const protectedTemplate = createBuiltInAgentTemplates()[0] as AgentTemplate;
  const base: ModelSettingsSnapshot = {
    providers: [],
    routeProfiles: [],
    agentTemplates: [protectedTemplate],
    mainAgentConfigs: [customMainAgentConfig("base.config")],
    mainAgentPrompts: [],
    subagentOrchestrations: [],
  };

  const merged = mergeAgentRegistrySettings(base, {
    listAgentTemplates: () => [],
    listMainAgentConfigs: () => [customMainAgentConfig("user.main.config")],
    listMainAgentPrompts: () => [customMainAgentPrompt("user.main.prompt")],
    listSubagentOrchestrations: () => [customSubagentOrchestration("user.subagents")],
  });

  expect(merged.mainAgentConfigs.map((config) => config.id)).toEqual(["user.main.config"]);
  expect(merged.mainAgentPrompts.map((prompt) => prompt.id)).toEqual(["user.main.prompt"]);
  expect(merged.subagentOrchestrations.map((orchestration) => orchestration.id)).toEqual([
    "user.subagents",
  ]);
});
