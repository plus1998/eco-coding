import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAgentOrchestrationStore,
  normalizeStoredAgentTemplate,
  normalizeStoredOrchestrationProfile,
} from "../src/main/agent-orchestration-store";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  createBuiltInAgentTemplates,
} from "../src/shared/agent-orchestration";
import type { AgentTemplate, OrchestrationProfile, RouteProfileView } from "../src/shared/ipc";

const sqliteAvailable = await (async () => {
  try {
    await import("node:sqlite");
    return true;
  } catch {
    return false;
  }
})();

function customTemplate(): AgentTemplate {
  return {
    id: "user.researcher",
    name: "Researcher",
    description: "Research agent",
    domain: "research",
    prompt: "Research the topic and cite sources.",
    whenToUse: "Use for broad research.",
    defaultTools: {
      allowed: ["WebSearch", "WebFetch"],
      disallowed: [],
      network: { webSearch: true, webFetch: true },
    },
    mcpServers: [],
    skills: [],
    allowDelegation: false,
    builtIn: false,
    source: "user",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function customProfile(): OrchestrationProfile {
  return {
    id: "user.research",
    name: "Research",
    preset: "research",
    mainAgent: {
      agentKey: "main",
      name: "Main Agent",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate research.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: { allowed: ["Agent", "WebSearch", "WebFetch"], disallowed: [] },
      skills: [],
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: "user.researcher",
        modelRef: { providerId: "p1", modelId: "m1" },
        tools: { allowed: ["WebSearch", "WebFetch"], disallowed: [] },
        mcpServers: [],
        skills: [],
        enabled: true,
      },
    ],
    strategy: { kind: "autonomous" },
    source: "user",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("normalizers reject built-in and derived configs for user storage", () => {
  expect(() => normalizeStoredAgentTemplate(createBuiltInAgentTemplates()[0] as AgentTemplate)).toThrow(
    "内置子代理模板不可写入用户配置",
  );
  expect(() =>
    normalizeStoredAgentTemplate({
      ...customTemplate(),
      id: "builtin.research.custom",
      builtIn: false,
      source: "user",
    }),
  ).toThrow("内置子代理模板 id 不可用于用户配置");

  const routeProfile: RouteProfileView = {
    id: "coding",
    name: "Coding",
    routes: [
      { role: "planner", providerId: "p1", modelId: "m1" },
      { role: "explore", providerId: "p1", modelId: "m1" },
      { role: "architect", providerId: "p1", modelId: "m1" },
      { role: "coder", providerId: "p1", modelId: "m1" },
      { role: "reviewer", providerId: "p1", modelId: "m1" },
      { role: "tester", providerId: "p1", modelId: "m1" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  expect(() =>
    normalizeStoredOrchestrationProfile(buildCodingOrchestrationProfileFromRouteProfile(routeProfile)),
  ).toThrow("内置或派生编排配置不可写入用户配置");
});

test.skipIf(!sqliteAvailable)("agent orchestration store persists user templates and profiles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-agent-orchestration-store-"));
  const store = await createAgentOrchestrationStore(path.join(dir, "eco-coding.sqlite"));

  store.saveAgentTemplate(customTemplate());
  store.saveOrchestrationProfile(customProfile());

  expect(store.listAgentTemplates()).toMatchObject([{ id: "user.researcher", source: "user" }]);
  expect(store.listOrchestrationProfiles()).toMatchObject([{ id: "user.research", source: "user" }]);

  store.deleteAgentTemplate("user.researcher");
  store.deleteOrchestrationProfile("user.research");
  expect(store.listAgentTemplates()).toEqual([]);
  expect(store.listOrchestrationProfiles()).toEqual([]);
});
