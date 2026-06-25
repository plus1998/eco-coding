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
      systemPromptPreset: "claude_code",
      prompt: "Coordinate coding.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: { allowed: ["Agent", "Read"], disallowed: [] },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: "p1", modelId: "m2" },
      },
    },
    agents: [
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
    version: 7,
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
  expect(saved.version).toBe(1);
  expect(saved.sourceRouteProfileId).toBeUndefined();
  expect(saved.builtinAgents.explore.modelRef).toEqual({ providerId: "p1", modelId: "m2" });
  expect(saved.agents.map((agent) => [agent.agentKey, agent.enabled])).toEqual([["reviewer", false]]);
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
