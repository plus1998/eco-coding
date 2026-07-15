import { expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentOrchestrationStore,
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
      systemPromptPreset: "custom_append",
      prompt: "Coordinate research.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: { allowed: ["Agent", "WebSearch", "WebFetch"], disallowed: [] },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: "p1", modelId: "m1" },
      },
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

test("normalizer migrates legacy system prompt presets", () => {
  const legacyCustom = customProfile() as unknown as OrchestrationProfile;
  (legacyCustom.mainAgent as unknown as { systemPromptPreset: string }).systemPromptPreset = "custom";
  expect(normalizeStoredOrchestrationProfile(legacyCustom).mainAgent.systemPromptPreset).toBe(
    "custom_append",
  );

  const legacyClaude = customProfile() as unknown as OrchestrationProfile;
  (legacyClaude.mainAgent as unknown as { systemPromptPreset: string }).systemPromptPreset =
    "claude_code";
  expect(normalizeStoredOrchestrationProfile(legacyClaude).mainAgent.systemPromptPreset).toBe(
    "core_native",
  );
});

test("normalizer strips legacy template model binding", () => {
  const normalized = normalizeStoredAgentTemplate({
    ...customTemplate(),
    defaultModelRef: { providerId: "p1", modelId: "m1" },
  } as unknown as AgentTemplate);

  expect("defaultModelRef" in normalized).toBe(false);
});

test("agent orchestration store migrates legacy built-in Explore into the editable roster", () => {
  const rows = [{ id: "user.research", value_json: JSON.stringify(customProfile()) }];
  const store = new AgentOrchestrationStore({
    prepare: (sql: string) => ({
      all: () => (sql.includes("orchestration_profiles") ? rows : []),
    }),
  } as never);

  const [profile] = store.listOrchestrationProfiles();
  expect(profile?.agents.map((agent) => agent.agentKey)).toEqual(["explore", "researcher"]);
  expect(profile?.builtinAgents).toBeUndefined();
});

test.skipIf(!sqliteAvailable)("agent orchestration store persists user templates and profiles", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-agent-orchestration-store-"));
  const store = await createAgentOrchestrationStore(path.join(dir, "eco-coding.sqlite"));

  store.saveAgentTemplate(customTemplate());
  store.saveAgentTemplate({ ...customTemplate(), prompt: "Updated prompt." });
  store.saveOrchestrationProfile(customProfile());
  store.saveOrchestrationProfile({ ...customProfile(), name: "Research Updated" });

  expect(store.listAgentTemplates()).toMatchObject([
    { id: "user.researcher", source: "user", prompt: "Updated prompt." },
  ]);
  expect(store.listOrchestrationProfiles()).toMatchObject([
    { id: "user.research", source: "user", name: "Research Updated" },
  ]);

  store.deleteAgentTemplate("user.researcher");
  store.deleteOrchestrationProfile("user.research");
  expect(store.listAgentTemplates()).toEqual([]);
  expect(store.listOrchestrationProfiles()).toEqual([]);
});
