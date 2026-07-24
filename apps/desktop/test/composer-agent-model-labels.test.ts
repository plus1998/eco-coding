import { expect, test } from "bun:test";
import { buildComposerAgentModelLabels } from "../src/renderer/composer-agent-model-labels";
import { i18n } from "../src/renderer/i18n";
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
    systemPromptPreset: "custom_append",
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
  updatedAt: "2026-06-07T00:00:00.000Z",
  source: "user",
};

test("buildComposerAgentModelLabels localizes legacy coding labels", async () => {
  await i18n.changeLanguage("en-US");
  const labels = buildComposerAgentModelLabels({
    routes: [
      { role: "planner", providerId: "p1", modelId: "main-model" },
      { role: "coder", providerId: "p1", modelId: "coder-model" },
    ],
  });

  expect(labels[0]).toMatchObject({
    role: "planner",
    displayName: "Main agent",
    main: true,
    modelId: "main-model",
  });
  expect(labels.find((label) => label.role === "coder")).toMatchObject({
    displayName: "Coder",
    subagentRole: "coder",
    modelId: "coder-model",
  });
  expect(labels.find((label) => label.role === "coder")).not.toHaveProperty("required");
});

test("buildComposerAgentModelLabels renders dynamic Agent Profile labels", async () => {
  await i18n.changeLanguage("en-US");
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
      title: "Research Captain · main-model",
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
