import { expect, test } from "bun:test";
import {
  AGENT_PROFILE_ARCHIVE_SCHEMA,
  buildAgentProfileArchive,
  parseAgentProfileArchive,
  parseAgentProfileArchiveBundle,
} from "../src/shared/agent-profile-archive";
import type { AgentTemplate, OrchestrationProfile } from "../src/shared/ipc";

function profile(): OrchestrationProfile {
  return {
    id: "user.research",
    name: "Research Profile",
    preset: "research",
    mainAgent: {
      agentKey: "main",
      name: "Research Main",
      domain: "research",
      systemPromptPreset: "custom",
      prompt: "Coordinate research.",
      modelRef: { providerId: "p1", modelId: "m1" },
      tools: { allowed: ["Agent", "Read"], disallowed: ["Bash"] },
      skills: [],
    },
    builtinAgents: {
      explore: {
        modelRef: { providerId: "p1", modelId: "m-explore" },
      },
    },
    agents: [
      {
        agentKey: "researcher",
        templateId: "user.researcher",
        displayName: "Researcher",
        modelRef: { providerId: "p1", modelId: "m2" },
        tools: { allowed: ["WebSearch"], disallowed: ["Bash"] },
        mcpServers: [],
        skills: [],
        enabled: true,
      },
    ],
    strategy: { kind: "autonomous", guidancePrompt: "Delegate for evidence." },
    updatedAt: "2026-06-07T00:00:00.000Z",
    source: "user",
  };
}

function template(): AgentTemplate {
  return {
    id: "user.researcher",
    name: "Researcher",
    description: "Finds sources",
    domain: "research",
    prompt: "Find credible sources.",
    whenToUse: "Use for source gathering.",
    defaultTools: { allowed: ["WebSearch"], disallowed: [] },
    mcpServers: [],
    skills: [],
    allowDelegation: false,
    builtIn: false,
    source: "user",
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}

test("agent profile archive round-trips schema and profiles", () => {
  const themed = profile();
  themed.builtinAgents.explore.themeColor = "#AABBCC";
  themed.agents[0]!.themeColor = "#112233";
  const archive = buildAgentProfileArchive([themed], "2026-06-07T01:00:00.000Z", {
    templates: [template()],
  });
  expect(archive.schema).toBe(AGENT_PROFILE_ARCHIVE_SCHEMA);
  expect(archive.templates).toEqual([template()]);
  expect(parseAgentProfileArchive(JSON.stringify(archive))).toEqual([themed]);
  expect(parseAgentProfileArchiveBundle(JSON.stringify(archive))).toEqual({
    profiles: [themed],
    templates: [template()],
  });
});

test("agent profile archive parser accepts arrays and single profile objects", () => {
  expect(parseAgentProfileArchive(JSON.stringify([profile()]))).toEqual([profile()]);
  expect(parseAgentProfileArchive(JSON.stringify(profile()))).toEqual([profile()]);
  expect(parseAgentProfileArchiveBundle(JSON.stringify([profile()]))).toEqual({
    profiles: [profile()],
    templates: [],
  });
});

test("agent profile archive parser rejects unrelated JSON", () => {
  expect(() => parseAgentProfileArchive(JSON.stringify({ hello: "world" }))).toThrow(
    "导入文件没有包含智能体配置",
  );
});
