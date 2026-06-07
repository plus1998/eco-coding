import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  CODING_AGENT_TEMPLATE_IDS,
  createBuiltInAgentTemplates,
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
  expect(templates.map((template) => template.id)).toEqual([
    CODING_AGENT_TEMPLATE_IDS.explorer,
    CODING_AGENT_TEMPLATE_IDS.architect,
    CODING_AGENT_TEMPLATE_IDS.coder,
    CODING_AGENT_TEMPLATE_IDS.reviewer,
    CODING_AGENT_TEMPLATE_IDS.tester,
  ]);
  expect(templates.every((template) => template.builtIn && template.domain === "coding")).toBe(true);
  expect(templates.every((template) => template.source === "built_in")).toBe(true);
  expect(
    templates.find((template) => template.id === CODING_AGENT_TEMPLATE_IDS.coder)?.defaultTools.allowed,
  ).toContain("Write");
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
    strategy: { kind: "hybrid", allowPlannerAdjustments: true },
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

test("coding orchestration migration maps legacy settings to strategy and enabled agents", () => {
  const manualProfile = buildCodingOrchestrationProfileFromRouteProfile(codingRouteProfile(), {
    orchestrationMode: "manual",
    subagentEnabled: {
      explore: true,
      architect: false,
      coder: true,
      reviewer: false,
      tester: true,
    },
  });
  expect(manualProfile.strategy.kind).toBe("fixed");
  expect(manualProfile.agents.find((agent) => agent.agentKey === "architect")?.enabled).toBe(false);
  expect(manualProfile.agents.find((agent) => agent.agentKey === "reviewer")?.enabled).toBe(false);
  expect(manualProfile.agents.find((agent) => agent.agentKey === "coder")?.enabled).toBe(true);

  const autonomousProfile = buildCodingOrchestrationProfileFromRouteProfile(codingRouteProfile(), {
    orchestrationMode: "autonomous",
  });
  expect(autonomousProfile.strategy.kind).toBe("autonomous");
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
