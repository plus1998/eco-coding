import { expect, test } from "bun:test";
import {
  defaultGitSettings,
  isGitSettingsSnapshot,
  normalizeGitSettingsSnapshot,
} from "../src/main/git-settings-store";

test("normalizeGitSettingsSnapshot keeps per-profile role map", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageRoleByProfileId: { profile_a: "explore", profile_b: "auto" },
    }),
  ).toEqual({
    commitMessageRoleByProfileId: { profile_a: "explore", profile_b: "auto" },
  });
});

test("normalizeGitSettingsSnapshot keeps commit message instructions", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageRoleByProfileId: {},
      commitMessageInstructions: "  使用中文  ",
    }),
  ).toEqual({
    commitMessageRoleByProfileId: {},
    commitMessageInstructions: "使用中文",
  });
});

test("normalizeGitSettingsSnapshot drops empty commit message instructions", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageRoleByProfileId: {},
      commitMessageInstructions: "   ",
    }),
  ).toEqual({
    commitMessageRoleByProfileId: {},
  });
});

test("isGitSettingsSnapshot validates shape", () => {
  expect(isGitSettingsSnapshot(defaultGitSettings())).toBe(true);
  expect(isGitSettingsSnapshot({})).toBe(false);
});
