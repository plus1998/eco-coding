import { expect, test } from "bun:test";
import { buildComposerAgentModelLabels } from "../src/renderer/composer-agent-model-labels";
import type { OrchestrationProfile, ToolPolicy } from "../src/shared/ipc";

const tools: ToolPolicy = { allowed: [], disallowed: [] };

const profile: OrchestrationProfile = {
  id: "research",
  name: "Research",
  preset: "research",
  mainAgent: {
    agentKey: "main",
    name: "Research Captain",
    domain: "research",
    systemPromptPreset: "custom",
    prompt: "Lead research.",
    modelRef: { providerId: "p1", modelId: "main-model" },
    tools,
    skills: [],
  },
  agents: [
    {
      agentKey: "research_lead",
      templateId: "researcher",
      displayName: "Research Lead",
      modelRef: { providerId: "p1", modelId: "research-model" },
      tools,
      mcpServers: [],
      skills: [],
      enabled: true,
    },
  ],
  strategy: { kind: "autonomous" },
  version: 1,
  updatedAt: "2026-06-07T00:00:00.000Z",
  source: "user",
};

test("buildComposerAgentModelLabels keeps legacy coding labels", () => {
  const labels = buildComposerAgentModelLabels({
    routes: [
      { role: "planner", providerId: "p1", modelId: "main-model" },
      { role: "coder", providerId: "p1", modelId: "coder-model" },
    ],
  });

  expect(labels[0]).toMatchObject({
    role: "planner",
    displayName: "主代理",
    main: true,
    modelId: "main-model",
  });
  expect(labels.find((label) => label.role === "coder")).toMatchObject({
    displayName: "编码",
    subagentRole: "coder",
    required: true,
    modelId: "coder-model",
  });
});

test("buildComposerAgentModelLabels renders dynamic Agent Profile labels", () => {
  const labels = buildComposerAgentModelLabels({
    profile,
    routes: [
      { role: "planner", providerId: "p1", modelId: "main-model" },
      { role: "research_lead", providerId: "p1", modelId: "research-model" },
    ],
    threadModelByRole: { research_lead: "live-research-model" },
  });

  expect(labels).toEqual([
    {
      role: "planner",
      displayName: "Research Captain",
      modelId: "main-model",
      title: "规划 · main-model",
      main: true,
    },
    {
      role: "research_lead",
      displayName: "Research Lead",
      modelId: "live-research-model",
      title: "Research Lead · live-research-model",
      main: false,
    },
  ]);
});
