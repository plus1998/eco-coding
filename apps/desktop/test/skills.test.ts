import { expect, test } from "bun:test";
import { parseSkillFrontmatter } from "../src/shared/skills";

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
