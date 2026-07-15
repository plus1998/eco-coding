import { expect, test } from "bun:test";
import { buildComposerSavedProfile } from "../src/renderer/composer-profile-save";
import type { OrchestrationProfile, ThreadRuntimeConfig } from "../src/shared/ipc";

function profile(): OrchestrationProfile {
  return {
    id: "derived.coding.default",
    name: "Coding Default",
    preset: "coding",
    sourceRouteProfileId: "coding",
    mainAgent: {
      agentKey: "main",
      name: "Main",
      domain: "coding",
      systemPromptPreset: "core_native",
      prompt: "Coordinate coding.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: { allowed: ["Agent", "Read"], disallowed: [] },
      skills: [],
    },
    agents: [
      {
        agentKey: "explore",
        templateId: "builtin.coding.explore",
        displayName: "Explore",
        modelRef: { providerId: "p1", modelId: "m2" },
        tools: { allowed: ["Read", "Glob", "Grep"], disallowed: ["Bash", "Write"] },
        mcpServers: [],
        skills: [],
        enabled: true,
      },
      {
        agentKey: "reviewer",
        templateId: "builtin.reviewer",
        displayName: "Reviewer",
        modelRef: { providerId: "p1", modelId: "m3" },
        tools: { allowed: ["Read"], disallowed: [] },
        mcpServers: [],
        skills: [],
        enabled: true,
      },
    ],
    strategy: { kind: "autonomous", guidancePrompt: "Delegate only when useful." },
    updatedAt: "2026-06-08T00:00:00.000Z",
    source: "derived",
  };
}

function runtimeConfig(input: Partial<ThreadRuntimeConfig> = {}): ThreadRuntimeConfig {
  return {
    routeProfileId: "coding",
    agentProfileId: "derived.coding.default",
    sessionMode: "plan",
    subagentEnabled: {
      explore: true,
      architect: true,
      coder: true,
      reviewer: false,
      tester: true,
    },
    ...input,
  };
}

test("buildComposerSavedProfile copies current composer state into a user profile", () => {
  const saved = buildComposerSavedProfile({
    profile: profile(),
    runtimeConfig: runtimeConfig(),
    name: " Coding Current ",
    existingIds: ["user.composer.coding_current"],
  });

  expect(saved.id).toBe("user.composer.coding_current_2");
  expect(saved.name).toBe("Coding Current");
  expect(saved.source).toBe("user");
  expect(saved.sourceRouteProfileId).toBeUndefined();
  expect(saved.agents.map((agent) => [agent.agentKey, agent.enabled])).toEqual([
    ["explore", true],
    ["reviewer", false],
  ]);
  expect(saved.strategy).toEqual({
    kind: "autonomous",
    guidancePrompt: "Delegate only when useful.",
  });
});

test("buildComposerSavedProfile preserves strategy when plan mode is off", () => {
  const saved = buildComposerSavedProfile({
    profile: profile(),
    runtimeConfig: runtimeConfig({ sessionMode: "agent" }),
    name: "Research Mode",
    existingIds: [],
  });

  expect(saved.strategy).toEqual({
    kind: "autonomous",
    guidancePrompt: "Delegate only when useful.",
  });
});

test("buildComposerSavedProfile promotes the temporary main model into the saved profile", () => {
  const saved = buildComposerSavedProfile({
    profile: profile(),
    runtimeConfig: runtimeConfig({
      mainAgentModelOverride: {
        providerId: "p1",
        modelId: "gpt-5.6-sol",
        candidateModelId: "candidate-sol",
        thinkingEffort: "high",
      },
    }),
    name: "Sol High",
    existingIds: [],
  });

  expect(saved.mainAgent.modelRef).toEqual({
    providerId: "p1",
    modelId: "gpt-5.6-sol",
    candidateModelId: "candidate-sol",
    thinkingEffort: "high",
  });
});

test("buildComposerSavedProfile omits thinking effort when the override does not set it", () => {
  const saved = buildComposerSavedProfile({
    profile: profile(),
    runtimeConfig: runtimeConfig({
      mainAgentModelOverride: {
        providerId: "p1",
        modelId: "gpt-5.6-sol",
      },
    }),
    name: "Sol Default Effort",
    existingIds: [],
  });

  expect(saved.mainAgent.modelRef).toEqual({
    providerId: "p1",
    modelId: "gpt-5.6-sol",
  });
});

test("buildComposerSavedProfile ignores an override from another provider", () => {
  const saved = buildComposerSavedProfile({
    profile: profile(),
    runtimeConfig: runtimeConfig({
      mainAgentModelOverride: {
        providerId: "p2",
        modelId: "gpt-5.6-sol",
        thinkingEffort: "high",
      },
    }),
    name: "Current Backend",
    existingIds: [],
  });

  expect(saved.mainAgent.modelRef).toEqual({ providerId: "p1", modelId: "m1" });
});
