import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerSkillsBar } from "../src/renderer/ComposerSkillsBar";
import type { SkillInfo } from "../src/shared/skills";

function projectSkill(name: string, layout: SkillInfo["layout"]): SkillInfo {
  const directory = `/repo/.${layout}/skills/${name}`;
  return {
    name,
    description: `${layout} skill`,
    source: "project",
    directory,
    skillFilePath: `${directory}/SKILL.md`,
    layout,
    sdkReady: layout === "claude",
    baseDir: "/repo",
  };
}

test("Codex-compatible project Skills do not show the Claude link prompt", () => {
  const markup = renderToStaticMarkup(
    createElement(ComposerSkillsBar, {
      availableSkills: [projectSkill("agents-skill", "agents"), projectSkill("codex-skill", "codex")],
      skillsNeedingLink: [],
      referencedSkillNames: new Set<string>(),
    }),
  );

  expect(markup).toContain("Agents Skill");
  expect(markup).toContain("Codex Skill");
  expect(markup).not.toContain(".claude");
  expect(markup).not.toContain("创建链接");
});

test("Claude shows an Agents Skill as needing a link", () => {
  const markup = renderToStaticMarkup(
    createElement(ComposerSkillsBar, {
      availableSkills: [],
      skillsNeedingLink: [projectSkill("agents-skill", "agents")],
      referencedSkillNames: new Set<string>(),
      onLinkAgents: () => undefined,
    }),
  );

  expect(markup).toContain("1 个 Skills 需链至 .claude");
  expect(markup).toContain("创建链接");
});
