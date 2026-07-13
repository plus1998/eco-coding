import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  buildOrchestrationProfileFromPreset,
  CODING_AGENT_TEMPLATE_IDS,
  createBuiltInAgentTemplates,
  createBuiltInPresetCatalog,
  createUserPresetProfileId,
  createUserPresetProfileName,
} from "../src/shared/agent-orchestration";
import type { RouteProfileView } from "../src/shared/ipc";

function codingRouteProfile(): RouteProfileView {
  return {
    id: "coding-default",
    name: "默认编程",
    routes: [
      { role: "planner", providerId: "p1", modelId: "planner-model", thinkingEffort: "high" },
      { role: "explore", providerId: "p1", modelId: "explore-model" },
      { role: "architect", providerId: "p1", modelId: "architect-model" },
      { role: "coder", providerId: "p1", modelId: "coder-model" },
      { role: "reviewer", providerId: "p1", modelId: "reviewer-model" },
      { role: "tester", providerId: "p1", modelId: "tester-model" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

test("built-in agent templates define the default coding library", () => {
  const templates = createBuiltInAgentTemplates();
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.explore);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.architect);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.coder);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.reviewer);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.tester);
  expect(templates.filter((template) => template.domain === "coding")).toHaveLength(5);
  expect(templates.every((template) => template.source === "built_in")).toBe(true);
  expect(
    templates.find((template) => template.id === CODING_AGENT_TEMPLATE_IDS.coder)?.defaultTools.filesystem
      ?.write,
  ).toBe("workspace");
  expect(
    templates.find((template) => template.id === CODING_AGENT_TEMPLATE_IDS.architect)?.defaultTools.filesystem
      ?.write,
  ).toBe("none");
});

test("built-in agent registry contains only coding templates", () => {
  const ids = createBuiltInAgentTemplates().map((template) => template.id);
  expect(ids).toContain(CODING_AGENT_TEMPLATE_IDS.explore);
  expect(ids).toContain(CODING_AGENT_TEMPLATE_IDS.architect);
  expect(ids).toContain(CODING_AGENT_TEMPLATE_IDS.coder);
  expect(ids).toContain(CODING_AGENT_TEMPLATE_IDS.reviewer);
  expect(ids).toContain(CODING_AGENT_TEMPLATE_IDS.tester);
  expect(ids).toHaveLength(5);
});

test("built-in preset catalog defines only coding preset", () => {
  const templatesById = new Set(createBuiltInAgentTemplates().map((template) => template.id));
  const presets = createBuiltInPresetCatalog();
  expect(presets.map((preset) => preset.id)).toEqual(["coding"]);
  for (const preset of presets) {
    expect(preset.mainAgentPrompt.trim().length).toBeGreaterThan(40);
    expect(preset.mainAgentTools.bash?.enabled).toBe(true);
    expect(preset.mainAgentTools.filesystem?.write).toBe("workspace");
    expect(preset.defaultAgents.length).toBeGreaterThanOrEqual(3);
    expect(preset.examples).toHaveLength(3);
    expect(preset.strategies.autonomous.kind).toBe("autonomous");
    for (const agent of preset.defaultAgents) {
      expect(templatesById.has(agent.templateId)).toBe(true);
    }
  }
});

test("built-in preset can be copied into a runnable user orchestration profile", () => {
  const templates = createBuiltInAgentTemplates();
  const preset = createBuiltInPresetCatalog().find((candidate) => candidate.id === "coding");
  if (!preset) {
    throw new Error("Missing coding preset.");
  }
  const profile = buildOrchestrationProfileFromPreset(preset, {
    id: createUserPresetProfileId("coding", ["user.coding.profile"]),
    name: createUserPresetProfileName("Coding", ["Coding Profile"]),
    modelRef: { providerId: "p1", modelId: "coding-model", apiCompat: "anthropic" },
    templates,
    updatedAt: "2026-06-07T08:00:00.000Z",
  });
  expect(profile).toMatchObject({
    id: "user.coding.profile.2",
    name: "Coding Profile 2",
    preset: "coding",
    source: "user",
    updatedAt: "2026-06-07T08:00:00.000Z",
    mainAgent: {
      systemPromptPreset: "claude_code",
      modelRef: { providerId: "p1", modelId: "coding-model", apiCompat: "anthropic" },
    },
    strategy: { kind: "autonomous" },
  });
  expect(profile.agents.map((agent) => agent.agentKey)).toEqual([
    "explore",
    "architect",
    "coder",
    "reviewer",
    "tester",
  ]);
  expect(profile.agents.every((agent) => agent.enabled)).toBe(true);
  expect(profile.agents.every((agent) => agent.modelRef.modelId === "coding-model")).toBe(true);
  expect(profile.agents.find((agent) => agent.agentKey === "coder")?.tools.filesystem?.write).toBe(
    "workspace",
  );
  expect(profile.mainAgent.tools.bash?.enabled).toBe(true);
});

test("route profile migrates to a coding orchestration profile", () => {
  const profile = buildCodingOrchestrationProfileFromRouteProfile(codingRouteProfile());
  expect(profile).toMatchObject({
    id: "coding-default",
    name: "默认编程",
    preset: "coding",
    sourceRouteProfileId: "coding-default",
    source: "derived",
    mainAgent: {
      agentKey: "main",
      systemPromptPreset: "claude_code",
      modelRef: { providerId: "p1", modelId: "planner-model", thinkingEffort: "high" },
    },
    strategy: { kind: "autonomous" },
  });
  expect(profile.agents.map((agent) => agent.agentKey)).toEqual([
    "explore",
    "architect",
    "coder",
    "reviewer",
    "tester",
  ]);
  expect(profile.agents.find((agent) => agent.agentKey === "coder")?.modelRef.modelId).toBe("coder-model");
});

test("coding orchestration migration maps enabled agents without plan-mode strategy coupling", () => {
  const profile = buildCodingOrchestrationProfileFromRouteProfile(codingRouteProfile(), {
    subagentEnabled: {
      explore: true,
      architect: false,
      coder: true,
      reviewer: false,
      tester: true,
    },
  });
  expect(profile.strategy.kind).toBe("autonomous");
  expect(profile.agents.find((agent) => agent.agentKey === "explore")?.modelRef.modelId).toBe(
    "explore-model",
  );
  expect(profile.agents.find((agent) => agent.agentKey === "explore")?.enabled).toBe(true);
  expect(profile.agents.find((agent) => agent.agentKey === "architect")?.enabled).toBe(false);
  expect(profile.agents.find((agent) => agent.agentKey === "reviewer")?.enabled).toBe(false);
  expect(profile.agents.find((agent) => agent.agentKey === "coder")?.enabled).toBe(true);
});

test("coding orchestration migration requires a complete coding route set", () => {
  const routeProfile = codingRouteProfile();
  expect(() =>
    buildCodingOrchestrationProfileFromRouteProfile({
      ...routeProfile,
      routes: routeProfile.routes.filter((route) => route.role !== "tester"),
    }),
  ).toThrow("missing tester model route");
});
