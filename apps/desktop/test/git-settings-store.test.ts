import { expect, test } from "bun:test";
import {
  defaultGitSettings,
  isGitSettingsSnapshot,
  normalizeGitSettingsSnapshot,
} from "../src/main/git-settings-store";

test("normalizeGitSettingsSnapshot keeps the per-main-agent-config role map", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageRoleByMainAgentConfigId: { main_config_a: "explore", main_config_b: "auto" },
    }),
  ).toEqual({
    commitMessageRoleByMainAgentConfigId: { main_config_a: "explore", main_config_b: "auto" },
    commitMessageCandidateModelIdByMainAgentConfigId: {},
    autofetch: true,
    autofetchPeriod: 180,
  });
});

test("normalizeGitSettingsSnapshot keeps the per-main-agent-config candidate model map", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageCandidateModelIdByMainAgentConfigId: { main_config_a: "cand-1", main_config_b: "auto" },
    }),
  ).toEqual({
    commitMessageRoleByMainAgentConfigId: {},
    commitMessageCandidateModelIdByMainAgentConfigId: { main_config_a: "cand-1", main_config_b: "auto" },
    autofetch: true,
    autofetchPeriod: 180,
  });
});

test("normalizeGitSettingsSnapshot keeps commit message instructions", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageRoleByMainAgentConfigId: {},
      commitMessageInstructions: "  使用中文  ",
    }),
  ).toEqual({
    commitMessageRoleByMainAgentConfigId: {},
    commitMessageCandidateModelIdByMainAgentConfigId: {},
    commitMessageInstructions: "使用中文",
    autofetch: true,
    autofetchPeriod: 180,
  });
});

test("normalizeGitSettingsSnapshot drops empty commit message instructions", () => {
  expect(
    normalizeGitSettingsSnapshot({
      commitMessageRoleByMainAgentConfigId: {},
      commitMessageInstructions: "   ",
    }),
  ).toEqual({
    commitMessageRoleByMainAgentConfigId: {},
    commitMessageCandidateModelIdByMainAgentConfigId: {},
    autofetch: true,
    autofetchPeriod: 180,
  });
});

test("isGitSettingsSnapshot validates shape", () => {
  expect(isGitSettingsSnapshot(defaultGitSettings())).toBe(true);
  expect(isGitSettingsSnapshot({ commitMessageCandidateModelIdByMainAgentConfigId: {} })).toBe(true);
  expect(isGitSettingsSnapshot({ commitMessageRoleByMainAgentConfigId: null })).toBe(false);
});
