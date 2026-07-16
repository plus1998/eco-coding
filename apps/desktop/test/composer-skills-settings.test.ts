import { expect, test } from "bun:test";
import { deriveSkillsEnabled } from "../src/shared/composer-skills-settings";
import type { SkillInfo } from "../src/shared/skills";

function skill(source: SkillInfo["source"], key: string): SkillInfo {
  return {
    name: key,
    description: key,
    source,
    directory: `/tmp/${key}`,
    skillFilePath: `/tmp/${key}/SKILL.md`,
    settingsKey: key,
    layout: "agents",
    sdkReady: true,
  };
}

test("project Skills default on and user Skills default off", () => {
  expect(deriveSkillsEnabled([skill("project", "project:a"), skill("user", "user:b")])).toEqual({
    "project:a": true,
    "user:b": false,
  });
});

test("no discovered Skills derives an empty settings record", () => {
  expect(deriveSkillsEnabled([])).toEqual({});
});

test("thread Skill choices override remembered project choices", () => {
  expect(
    deriveSkillsEnabled([skill("user", "user:a")], {
      remembered: { "user:a": true },
      existing: { "user:a": false },
    }),
  ).toEqual({ "user:a": false });
});

test("complete thread Skill choices preserve their reference", () => {
  const currentSkills = [
    skill("project", "project:agents:.agents/skills/local/SKILL.md"),
    skill("user", "user:agents:/Users/test/.agents/skills/global/SKILL.md"),
  ];
  const existing = {
    "project:agents:.agents/skills/local/SKILL.md": false,
    "user:agents:/Users/test/.agents/skills/global/SKILL.md": true,
  };

  expect(deriveSkillsEnabled(currentSkills, { existing })).toBe(existing);
});
