import { expect, test } from "bun:test";
import { isSkillAvailableForCore, parseSkillFrontmatter } from "../src/shared/skills";

test("parses SKILL.md frontmatter", () => {
  const content = `---
name: pdf-processing
description: Extract and analyze PDF documents for the user.
---

# Instructions
`;
  expect(parseSkillFrontmatter(content)).toEqual({
    name: "pdf-processing",
    description: "Extract and analyze PDF documents for the user.",
  });
});

test("returns empty fields when frontmatter is missing", () => {
  expect(parseSkillFrontmatter("# No frontmatter")).toEqual({
    name: "",
    description: "",
  });
});

test("filters Skill layouts by current Core", () => {
  const skill = (
    layout: "claude" | "agents" | "codex",
    sdkReady: boolean,
    skillFilePath = `/repo/.${layout}/skills/demo/SKILL.md`,
  ) => ({ layout, sdkReady, skillFilePath });

  expect(isSkillAvailableForCore(skill("claude", true), "claude")).toBe(true);
  expect(isSkillAvailableForCore(skill("agents", false), "claude")).toBe(false);
  expect(isSkillAvailableForCore(skill("agents", false), "codex")).toBe(true);
  expect(isSkillAvailableForCore(skill("codex", false), "codex")).toBe(true);
  expect(isSkillAvailableForCore(skill("claude", true), "codex")).toBe(false);
  expect(
    isSkillAvailableForCore(
      skill("codex", false, "/Users/test/.codex/skills/.system/imagegen/SKILL.md"),
      "codex",
    ),
  ).toBe(false);
});
