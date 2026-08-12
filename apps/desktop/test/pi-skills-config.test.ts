import { expect, test } from "bun:test";
import path from "node:path";
import {
  piSkillDirectoriesForSession,
  shouldBlockPiSkillsConfigReload,
} from "../src/main/pi-skills-config";
import type { SkillInfo } from "../src/shared/skills";

function skill(name: string, directory: string): SkillInfo {
  return {
    name,
    description: name,
    source: "project",
    directory,
    skillFilePath: `${directory}/SKILL.md`,
    layout: "agents",
    sdkReady: false,
  };
}

test("piSkillDirectoriesForSession returns only enabled directories", () => {
  const dirs = piSkillDirectoriesForSession([
    { skill: skill("a", "/repo/.agents/skills/a"), enabled: true },
    { skill: skill("b", "/repo/.agents/skills/b"), enabled: false },
    { skill: skill("c", "/repo/.pi/skills/c"), enabled: true },
  ]);
  expect(dirs).toEqual([
    path.resolve("/repo/.agents/skills/a"),
    path.resolve("/repo/.pi/skills/c"),
  ]);
});

test("shouldBlockPiSkillsConfigReload only blocks active runs", () => {
  expect(
    shouldBlockPiSkillsConfigReload({ skillsChanged: true, threadStatus: "idle" }),
  ).toBe(false);
  expect(
    shouldBlockPiSkillsConfigReload({ skillsChanged: true, threadStatus: undefined }),
  ).toBe(false);
  expect(
    shouldBlockPiSkillsConfigReload({ skillsChanged: false, threadStatus: "running" }),
  ).toBe(false);
  expect(
    shouldBlockPiSkillsConfigReload({ skillsChanged: true, threadStatus: "running" }),
  ).toBe(true);
  expect(
    shouldBlockPiSkillsConfigReload({ skillsChanged: true, threadStatus: "queued" }),
  ).toBe(true);
});
