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
    commitMessageCandidateModelIdByProfileId: {},
    autofetch: true,
    autofetchPeriod: 180,
  });
});

test("normalizeGitSettingsSnapshot keeps per-profile candidate model map", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageCandidateModelIdByProfileId: { profile_a: "cand-1", profile_b: "auto" },
    }),
  ).toEqual({
    commitMessageRoleByProfileId: {},
    commitMessageCandidateModelIdByProfileId: { profile_a: "cand-1", profile_b: "auto" },
    autofetch: true,
    autofetchPeriod: 180,
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
    commitMessageCandidateModelIdByProfileId: {},
    commitMessageInstructions: "使用中文",
    autofetch: true,
    autofetchPeriod: 180,
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
    commitMessageCandidateModelIdByProfileId: {},
    autofetch: true,
    autofetchPeriod: 180,
  });
});

test("isGitSettingsSnapshot validates shape", () => {
  expect(isGitSettingsSnapshot(defaultGitSettings())).toBe(true);
  expect(isGitSettingsSnapshot({ commitMessageCandidateModelIdByProfileId: {} })).toBe(true);
  expect(isGitSettingsSnapshot({ commitMessageRoleByProfileId: null })).toBe(false);
});
