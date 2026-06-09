import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  buildOrchestrationProfileFromPreset,
  CODING_AGENT_TEMPLATE_IDS,
  createBuiltInAgentTemplates,
  createBuiltInPresetCatalog,
  createUserPresetProfileId,
  createUserPresetProfileName,
  DATA_OPS_AGENT_TEMPLATE_IDS,
  PRODUCT_AGENT_TEMPLATE_IDS,
  RESEARCH_AGENT_TEMPLATE_IDS,
  WRITING_AGENT_TEMPLATE_IDS,
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
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.architect);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.coder);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.reviewer);
  expect(templates.map((template) => template.id)).toContain(CODING_AGENT_TEMPLATE_IDS.tester);
  expect(templates.filter((template) => template.domain === "coding")).toHaveLength(4);
  expect(templates.every((template) => template.source === "built_in")).toBe(true);
  expect(
    templates.find((template) => template.id === CODING_AGENT_TEMPLATE_IDS.coder)?.defaultTools.allowed,
  ).toContain("Write");
});

test("built-in agent registry includes non-coding presets", () => {
  const ids = createBuiltInAgentTemplates().map((template) => template.id);
  expect(ids).toContain(RESEARCH_AGENT_TEMPLATE_IDS.researcher);
  expect(ids).toContain(RESEARCH_AGENT_TEMPLATE_IDS.sourceVerifier);
  expect(ids).toContain(WRITING_AGENT_TEMPLATE_IDS.editor);
  expect(ids).toContain(WRITING_AGENT_TEMPLATE_IDS.factChecker);
  expect(ids).toContain(PRODUCT_AGENT_TEMPLATE_IDS.pmAnalyst);
  expect(ids).toContain(PRODUCT_AGENT_TEMPLATE_IDS.specWriter);
  expect(ids).toContain(DATA_OPS_AGENT_TEMPLATE_IDS.dataAnalyst);
  expect(ids).toContain(DATA_OPS_AGENT_TEMPLATE_IDS.reportWriter);
  expect(ids).toContain(DATA_OPS_AGENT_TEMPLATE_IDS.incidentTriage);
  expect(ids).toContain(DATA_OPS_AGENT_TEMPLATE_IDS.logAnalyst);
  expect(ids).toContain(DATA_OPS_AGENT_TEMPLATE_IDS.runbookExecutor);
});

test("built-in preset catalog defines commercial scenario metadata", () => {
  const templatesById = new Set(createBuiltInAgentTemplates().map((template) => template.id));
  const presets = createBuiltInPresetCatalog();
  expect(presets.map((preset) => preset.id)).toEqual([
    "coding",
    "research",
    "writing",
    "product",
    "data",
    "ops",
  ]);
  for (const preset of presets) {
    expect(preset.mainAgentPrompt.trim().length).toBeGreaterThan(40);
    expect(preset.mainAgentTools.allowed).toContain("Agent");
    expect(preset.defaultAgents.length).toBeGreaterThanOrEqual(3);
    expect(preset.examples).toHaveLength(3);
    expect(preset.evals).toHaveLength(3);
    expect(preset.strategies.autonomous.kind).toBe("autonomous");
    for (const agent of preset.defaultAgents) {
      expect(templatesById.has(agent.templateId)).toBe(true);
    }
    for (const evalCase of preset.evals) {
      expect(evalCase.successCriteria.length).toBeGreaterThanOrEqual(3);
      expect(evalCase.expectedAgentKeys.length).toBeGreaterThan(0);
    }
  }
});

test("non-coding preset prompts avoid coding prompt pollution", () => {
  const nonCodingPrompts = createBuiltInPresetCatalog()
    .filter((preset) => preset.id !== "coding")
    .map((preset) => preset.mainAgentPrompt.toLowerCase());
  for (const prompt of nonCodingPrompts) {
    expect(prompt).not.toContain("software engineering");
    expect(prompt).not.toContain("repository");
    expect(prompt).not.toContain("code review");
    expect(prompt).not.toContain("diff");
  }
});

test("built-in preset can be copied into a runnable user orchestration profile", () => {
  const templates = createBuiltInAgentTemplates();
  const preset = createBuiltInPresetCatalog().find((candidate) => candidate.id === "research");
  if (!preset) {
    throw new Error("Missing research preset.");
  }
  const profile = buildOrchestrationProfileFromPreset(preset, {
    id: createUserPresetProfileId("research", ["user.research.profile"]),
    name: createUserPresetProfileName("Research", ["Research Profile"]),
    modelRef: { providerId: "p1", modelId: "research-model", apiCompat: "anthropic" },
    templates,
    updatedAt: "2026-06-07T08:00:00.000Z",
  });
  expect(profile).toMatchObject({
    id: "user.research.profile.2",
    name: "Research Profile 2",
    preset: "research",
    source: "user",
    updatedAt: "2026-06-07T08:00:00.000Z",
    mainAgent: {
      systemPromptPreset: "custom",
      modelRef: { providerId: "p1", modelId: "research-model", apiCompat: "anthropic" },
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: "p1", modelId: "research-model", apiCompat: "anthropic" },
      },
    },
    strategy: { kind: "autonomous" },
  });
  expect(profile.agents.map((agent) => agent.agentKey)).toEqual([
    "researcher",
    "source_verifier",
    "synthesizer",
  ]);
  expect(profile.agents.every((agent) => agent.enabled)).toBe(true);
  expect(profile.agents.every((agent) => agent.modelRef.modelId === "research-model")).toBe(true);
  expect(profile.agents.find((agent) => agent.agentKey === "source_verifier")?.tools.allowed).toContain(
    "WebSearch",
  );
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
    builtinAgents: {
      explore: {
        modelRef: { providerId: "p1", modelId: "explore-model" },
      },
    },
    strategy: { kind: "autonomous" },
  });
  expect(profile.agents.map((agent) => agent.agentKey)).toEqual([
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
  expect(profile.agents.map((agent) => agent.agentKey)).not.toContain("explore");
  expect(profile.builtinAgents.explore.modelRef.modelId).toBe("explore-model");
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
