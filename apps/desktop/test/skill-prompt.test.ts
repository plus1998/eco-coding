import { expect, test } from "bun:test";
import {
  buildRuntimeAgentSkillAssignments,
  dedupeSkillsByName,
  filterExplicitUserSkillNames,
  listSdkReadyProjectSkills,
  mergeSkillNames,
  parseExplicitSkillNames,
  resolveSdkSessionSkillConfig,
  promptIncludesSkillName,
  type SkillInfo,
} from "../src/shared/skills";

test("parseExplicitSkillNames extracts $skill tokens", () => {
  expect(parseExplicitSkillNames("请用 $pdf-processing 处理附件")).toEqual(["pdf-processing"]);
  expect(parseExplicitSkillNames("$a $b $a")).toEqual(["a", "b"]);
  expect(parseExplicitSkillNames(undefined)).toEqual([]);
});

test("filterExplicitUserSkillNames keeps only sdk-ready user skills", () => {
  const userSkills = [
    { name: "vue-best-practices", sdkReady: true },
    { name: "pdf", sdkReady: false },
  ];
  expect(filterExplicitUserSkillNames("$vue-best-practices 帮忙", userSkills)).toEqual([
    "vue-best-practices",
  ]);
  expect(filterExplicitUserSkillNames("$pdf", userSkills)).toEqual([]);
  expect(filterExplicitUserSkillNames("$unknown", userSkills)).toEqual([]);
});

test("promptIncludesSkillName detects explicit tokens", () => {
  expect(promptIncludesSkillName("use $vue-best  ", "vue-best")).toBe(true);
  expect(promptIncludesSkillName("use $vue-best", "other")).toBe(false);
});

test("resolveSdkSessionSkillConfig keeps only project skills during planning", () => {
  expect(
    resolveSdkSessionSkillConfig("planning", {
      projectNames: ["project-skill"],
      explicitUser: ["user-skill"],
    }),
  ).toEqual({
    settingSources: ["project"],
    skills: ["project-skill"],
  });
});

test("resolveSdkSessionSkillConfig uses project skills and explicit user prompt skills during execution", () => {
  expect(
    resolveSdkSessionSkillConfig("default", {
      projectNames: ["project-skill"],
      explicitUser: ["user-skill"],
    }),
  ).toEqual({
    settingSources: ["project"],
    skills: ["project-skill", "user-skill"],
  });
});

test("mergeSkillNames dedupes and sorts", () => {
  expect(mergeSkillNames(["b", "a"], ["a", "c"])).toEqual(["a", "b", "c"]);
});

test("buildRuntimeAgentSkillAssignments includes dynamic profile agent keys", () => {
  expect(
    buildRuntimeAgentSkillAssignments(["project", "main"], {
      agents: [
        {
          agentKey: "research lead",
          templateId: "template",
          modelRef: { providerId: "p", modelId: "m" },
          tools: { allowed: [], disallowed: [] },
          mcpServers: [],
          skills: [],
          enabled: true,
        },
        {
          agentKey: "disabled",
          templateId: "template",
          modelRef: { providerId: "p", modelId: "m" },
          tools: { allowed: [], disallowed: [] },
          mcpServers: [],
          skills: [],
          enabled: false,
        },
      ],
    }),
  ).toMatchObject({
    planner: ["project", "main"],
    coder: ["project", "main"],
    "research lead": ["project", "main"],
    eco_research_lead: ["project", "main"],
  });
});

test("listSdkReadyProjectSkills dedupes by name and prefers claude layout", () => {
  const base = (layout: SkillInfo["layout"], sdkReady: boolean): SkillInfo => ({
    name: "dup",
    description: "",
    source: "project",
    directory: layout === "claude" ? "/p/.claude/skills/dup" : "/p/.agents/skills/dup",
    skillFilePath: "/p/SKILL.md",
    layout,
    sdkReady,
  });
  const ready = listSdkReadyProjectSkills([base("agents", true), base("claude", true)]);
  expect(ready).toHaveLength(1);
  expect(ready[0]?.layout).toBe("claude");
  expect(dedupeSkillsByName([base("agents", false), base("claude", true)])).toHaveLength(1);
});
