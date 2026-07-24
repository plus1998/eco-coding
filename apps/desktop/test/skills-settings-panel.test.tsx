import { expect, test } from "bun:test";
import { createElement } from "react";
import {
  isCatalogSkillInstalled,
  SkillsSettingsPanel,
} from "../src/renderer/SkillsSettingsPanel";
import type { SkillCatalogEntry, SkillInfo } from "../src/shared/skills";
import { renderLocalized } from "./i18n-test";

function userSkill(name: string, layout: SkillInfo["layout"], sdkReady: boolean): SkillInfo {
  const directory = `/Users/test/.${layout}/skills/${name}`;
  return {
    name,
    description: `${layout} skill`,
    source: "user",
    directory,
    skillFilePath: `${directory}/SKILL.md`,
    layout,
    sdkReady,
    baseDir: "/Users/test",
  };
}

test("Skills settings groups sources into counted tabs", () => {
  const markup = renderLocalized(
    createElement(SkillsSettingsPanel, {
      snapshot: {
        userSkills: [
          userSkill("claude-skill", "claude", true),
          userSkill("agents-skill", "agents", false),
          userSkill("codex-skill", "codex", false),
        ],
        projectSkills: [],
        agentsOnlySkills: [],
        scannedAt: "2026-07-16T00:00:00.000Z",
      },
      onRefresh: () => undefined,
      onUninstall: async () => undefined,
      onLoadCatalogLeaderboard: async () => ({
        query: "",
        searchType: "unknown" as const,
        entries: [],
      }),
      onSearchCatalog: async (query: string) => ({
        query,
        searchType: "fuzzy" as const,
        entries: [],
      }),
      onInstallCatalog: async () => undefined,
    }),
    "zh-CN",
  );

  expect(markup).toContain("Agents 1");
  expect(markup).toContain("Codex 1");
  expect(markup).toContain("Claude Code 1");
  expect(markup).toContain("agents-skill");
  expect(markup).not.toContain("codex-skill");
  expect(markup).not.toContain("claude-skill");
  expect(markup).toContain('aria-selected="true"');
  expect(markup).toContain('aria-label="浏览 Skills 商店"');
  expect(markup).not.toContain('class="skills-catalog-search"');
  expect(markup).not.toContain('role="dialog"');
});

test("catalog installed state requires the complete source and Skill id", () => {
  const skill = {
    ...userSkill("frontend-design", "agents", true),
    catalogSource: "other/skills",
    catalogSkillId: "frontend-design",
  };
  const entry: SkillCatalogEntry = {
    id: "anthropics/skills/frontend-design",
    source: "anthropics/skills",
    skillId: "frontend-design",
    name: "frontend-design",
    installs: 1,
    url: "https://skills.sh/anthropics/skills/frontend-design",
  };

  expect(isCatalogSkillInstalled([skill], entry)).toBe(false);
  expect(
    isCatalogSkillInstalled([{ ...skill, catalogSource: "anthropics/skills" }], entry),
  ).toBe(true);
});
