import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  createBuiltInAgentTemplates,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, RouteProfileView } from "../src/shared/ipc";
import {
  buildRuntimeAgentDisplayNames,
  formatRuntimeRoleModelLabel,
  resolveRuntimeAgentName,
} from "../src/renderer/runtime-agent-display";

const routeProfile: RouteProfileView = {
  id: "coding-default",
  name: "默认编程",
  routes: [
    { role: "planner", providerId: "openai", modelId: "gpt-5-codex" },
    { role: "explore", providerId: "openai", modelId: "gpt-5-mini" },
    { role: "architect", providerId: "openai", modelId: "gpt-5" },
    { role: "coder", providerId: "openai", modelId: "gpt-5-codex" },
    { role: "reviewer", providerId: "openai", modelId: "gpt-5" },
    { role: "tester", providerId: "openai", modelId: "gpt-5-mini" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const settings: ModelSettingsSnapshot = {
  providers: [],
  routeProfiles: [routeProfile],
  agentTemplates: createBuiltInAgentTemplates(),
  orchestrationProfiles: [buildCodingOrchestrationProfileFromRouteProfile(routeProfile)],
};

test("buildRuntimeAgentDisplayNames maps runtime roles to profile agent names", () => {
  const names = buildRuntimeAgentDisplayNames(settings, {
    routeProfileId: "coding-default",
    sessionMode: "plan",
    subagentEnabled: {
      explore: true,
      architect: true,
      coder: true,
      reviewer: false,
      tester: true,
    },
  });

  expect(names.planner).toBe("Main Agent");
  expect(names.main).toBe("Main Agent");
  expect(names.explore).toBe("Explore");
  expect(names.eco_explore).toBe("Explore");
  expect(resolveRuntimeAgentName("eco_coder", names)).toBe("Coder");
});

test("formatRuntimeRoleModelLabel prefers runtime agent names and falls back to role labels", () => {
  const names = buildRuntimeAgentDisplayNames(settings, {
    routeProfileId: "coding-default",
    sessionMode: "agent",
    subagentEnabled: {
      explore: true,
      architect: true,
      coder: true,
      reviewer: true,
      tester: true,
    },
  });

  expect(formatRuntimeRoleModelLabel("reviewer", "gpt-5", names)).toBe("Reviewer · gpt-5");
  expect(formatRuntimeRoleModelLabel("unknown", "model-x", names)).toBe("unknown · model-x");
});
