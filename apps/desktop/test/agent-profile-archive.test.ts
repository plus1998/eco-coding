import { expect, test } from "bun:test";
import {
  AGENT_PROFILE_ARCHIVE_SCHEMA,
  buildAgentProfileArchive,
  parseAgentProfileArchive,
} from "../src/shared/agent-profile-archive";
import type { OrchestrationProfile } from "../src/shared/ipc";

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
    version: 1,
    updatedAt: "2026-06-07T00:00:00.000Z",
    source: "user",
  };
}

test("agent profile archive round-trips schema and profiles", () => {
  const archive = buildAgentProfileArchive([profile()], "2026-06-07T01:00:00.000Z");
  expect(archive.schema).toBe(AGENT_PROFILE_ARCHIVE_SCHEMA);
  expect(parseAgentProfileArchive(JSON.stringify(archive))).toEqual([profile()]);
});

test("agent profile archive parser accepts arrays and single profile objects", () => {
  expect(parseAgentProfileArchive(JSON.stringify([profile()]))).toEqual([profile()]);
  expect(parseAgentProfileArchive(JSON.stringify(profile()))).toEqual([profile()]);
});

test("agent profile archive parser rejects unrelated JSON", () => {
  expect(() => parseAgentProfileArchive(JSON.stringify({ hello: "world" }))).toThrow(
    "导入文件没有包含 Agent Profiles",
  );
});
