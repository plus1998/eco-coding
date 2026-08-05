import { expect, test } from "bun:test";
import {
  CODEX_SKILLS_CONFIG_RELOAD_BLOCKED_MESSAGE,
  shouldBlockCodexSkillsConfigReload,
  skillsEnabledSettingsChanged,
} from "../src/main/codex-skills-config-reload";

test("skillsEnabledSettingsChanged detects path toggles and ignores empty maps", () => {
  expect(skillsEnabledSettingsChanged(undefined, undefined)).toBe(false);
  expect(skillsEnabledSettingsChanged({}, { "/a": true })).toBe(true);
  expect(skillsEnabledSettingsChanged({ "/a": true }, { "/a": true })).toBe(false);
  expect(skillsEnabledSettingsChanged({ "/a": true }, { "/a": false })).toBe(true);
  expect(skillsEnabledSettingsChanged({ "/b": true, "/a": false }, { "/a": false, "/b": true })).toBe(
    false,
  );
});

test("shouldBlockCodexSkillsConfigReload allows notLoaded, no mapping, and no client", () => {
  expect(
    shouldBlockCodexSkillsConfigReload({
      skillsChanged: true,
      hasCodexMapping: true,
      status: "notLoaded",
    }),
  ).toBe(false);
  expect(
    shouldBlockCodexSkillsConfigReload({
      skillsChanged: true,
      hasCodexMapping: false,
      status: "idle",
    }),
  ).toBe(false);
  expect(
    shouldBlockCodexSkillsConfigReload({
      skillsChanged: true,
      hasCodexMapping: true,
      status: undefined,
    }),
  ).toBe(false);
  expect(
    shouldBlockCodexSkillsConfigReload({
      skillsChanged: false,
      hasCodexMapping: true,
      status: "idle",
    }),
  ).toBe(false);
});

test("shouldBlockCodexSkillsConfigReload blocks loaded statuses when skills change", () => {
  for (const status of ["idle", "active", "systemError", "unknown"] as const) {
    expect(
      shouldBlockCodexSkillsConfigReload({
        skillsChanged: true,
        hasCodexMapping: true,
        status,
      }),
    ).toBe(true);
  }
  expect(CODEX_SKILLS_CONFIG_RELOAD_BLOCKED_MESSAGE).toContain("无法修改 Skills");
  expect(CODEX_SKILLS_CONFIG_RELOAD_BLOCKED_MESSAGE).toContain("配置重载");
});
