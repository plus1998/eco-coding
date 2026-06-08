import { expect, test } from "bun:test";
import {
  AGENT_TEMPLATE_ARCHIVE_SCHEMA,
  buildAgentTemplateArchive,
  parseAgentTemplateArchive,
} from "../src/shared/agent-template-archive";
import type { AgentTemplate } from "../src/shared/ipc";

function template(): AgentTemplate {
  return {
    id: "user.researcher",
    name: "Researcher",
    description: "Research agent",
    domain: "research",
    prompt: "Research.",
    whenToUse: "Use for research.",
    defaultTools: { allowed: ["WebSearch"], disallowed: [] },
    mcpServers: [],
    skills: [],
    allowDelegation: false,
    builtIn: false,
    source: "user",
    version: 1,
    updatedAt: "2026-06-07T00:00:00.000Z",
  };
}

test("agent template archive round-trips schema and templates", () => {
  const archive = buildAgentTemplateArchive([template()], "2026-06-07T01:00:00.000Z");
  expect(archive.schema).toBe(AGENT_TEMPLATE_ARCHIVE_SCHEMA);
  expect(parseAgentTemplateArchive(JSON.stringify(archive))).toEqual([template()]);
});

test("agent template archive parser accepts arrays and single template objects", () => {
  expect(parseAgentTemplateArchive(JSON.stringify([template()]))).toEqual([template()]);
  expect(parseAgentTemplateArchive(JSON.stringify(template()))).toEqual([template()]);
});

test("agent template archive parser rejects unrelated JSON", () => {
  expect(() => parseAgentTemplateArchive(JSON.stringify({ hello: "world" }))).toThrow(
    "导入文件没有包含 agent templates",
  );
});
