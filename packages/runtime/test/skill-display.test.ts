import { expect, test } from "bun:test";
import { resolveSkillDisplayName, skillNameFromPath } from "@eco/runtime";
import { formatAgentEventDisplay } from "@eco/runtime/sdk";

test("skillNameFromPath reads parent directory of SKILL.md", () => {
  expect(skillNameFromPath("/Users/me/.claude/skills/pdf/SKILL.md")).toBe("pdf");
  expect(skillNameFromPath("C:\\skills\\docx\\SKILL.md")).toBe("docx");
  expect(skillNameFromPath("/tmp/readme.md")).toBeNull();
});

test("resolveSkillDisplayName handles Skill tool input", () => {
  expect(resolveSkillDisplayName("Skill", { skill: "pdf" })).toBe("pdf");
  expect(resolveSkillDisplayName("Skill", { name: "docx" })).toBe("docx");
  expect(resolveSkillDisplayName("Skill", { skillName: "frontend-design" })).toBe("frontend-design");
  expect(resolveSkillDisplayName("Skill", { skill_path: "/home/.claude/skills/browser/SKILL.md" })).toBe("browser");
  expect(resolveSkillDisplayName("Read", { file_path: "/home/.claude/skills/lint/SKILL.md" })).toBe("lint");
});

test("formatAgentEventDisplay shows skill read label", () => {
  const display = formatAgentEventDisplay({
    type: "tool.started",
    role: "planner",
    payload: {
      type: "tool_use",
      tool_name: "Skill",
      input: { skill: "pdf" },
    },
  });
  expect(display?.message).toBe("Tool: Skill · pdf 技能");
});

test("formatAgentEventDisplay shows Read SKILL.md as skill", () => {
  const display = formatAgentEventDisplay({
    type: "tool.started",
    role: "planner",
    payload: {
      type: "tool_use",
      tool_name: "Read",
      input: { file_path: "/Users/me/.claude/skills/vue-best-practices/SKILL.md" },
    },
  });
  expect(display?.message).toBe("Tool: Read · vue-best-practices 技能");
});
