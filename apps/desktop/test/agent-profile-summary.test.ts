import { expect, test } from "bun:test";
import {
  buildCodingOrchestrationProfileFromRouteProfile,
  createBuiltInAgentTemplates,
} from "../src/shared/agent-orchestration";
import type { ModelSettingsSnapshot, OrchestrationProfile, RouteProfileView } from "../src/shared/ipc";
import {
  buildAgentProfileSummary,
  findSelectableAgentProfileSummary,
  listSelectableAgentProfileSummaries,
} from "../src/renderer/agent-profile-summary";

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

function settings(): ModelSettingsSnapshot {
  const codingProfile = buildCodingOrchestrationProfileFromRouteProfile(routeProfile);
  const customProfile: OrchestrationProfile = {
    ...codingProfile,
    id: "custom-unbound",
    name: "未绑定自定义",
    source: "user",
    sourceRouteProfileId: undefined,
  };
  return {
    providers: [],
    routeProfiles: [routeProfile],
    agentTemplates: createBuiltInAgentTemplates(),
    orchestrationProfiles: [customProfile, codingProfile],
  };
}

test("listSelectableAgentProfileSummaries returns route-backed and custom profiles", () => {
  const summaries = listSelectableAgentProfileSummaries(settings());

  expect(summaries).toHaveLength(2);
  expect(summaries[0]?.selectionId).toBe("coding-default");
  expect(summaries[0]?.name).toBe("默认编程");
  expect(summaries[0]?.presetLabel).toBe("编程");
  expect(summaries[0]?.strategyLabel).toBe("混合编排");
  expect(summaries[1]?.selectionId).toBe("custom-unbound");
  expect(summaries[1]?.sourceLabel).toBe("用户");
});

test("profile summary applies current runtime subagent switches", () => {
  const summary = findSelectableAgentProfileSummary(settings(), "coding-default", {
    routeProfileId: "coding-default",
    orchestrationMode: "manual",
    subagentEnabled: {
      explore: true,
      architect: false,
      coder: true,
      reviewer: false,
      tester: true,
    },
  });

  expect(summary?.enabledAgents.map((agent) => agent.agentKey)).toEqual(["explore", "coder", "tester"]);
  expect(summary?.disabledAgentCount).toBe(2);
  expect(summary?.highRiskLabels).toEqual(["Bash", "写文件", "联网"]);
});

test("buildAgentProfileSummary keeps unbound custom profile selectable by profile id", () => {
  const snapshot = settings();
  const profile = snapshot.orchestrationProfiles.find((candidate) => candidate.id === "custom-unbound");
  if (!profile) {
    throw new Error("missing custom profile");
  }

  const summary = buildAgentProfileSummary(snapshot, profile);

  expect(summary.selectionId).toBe("custom-unbound");
  expect(summary.sourceLabel).toBe("用户");
});
