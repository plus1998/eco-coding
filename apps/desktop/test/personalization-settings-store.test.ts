import { expect, test } from "bun:test";
import {
  defaultPersonalizationSettings,
  GLOBAL_USER_RULES_MAX_CHARS,
  isPersonalizationSettingsSnapshot,
  normalizePersonalizationSettingsSnapshot,
} from "../src/main/personalization-settings-store";

test("normalizePersonalizationSettingsSnapshot keeps trimmed global rules", () => {
  expect(
    normalizePersonalizationSettingsSnapshot({
      globalRules: "  Always reply in Chinese.  ",
    }),
  ).toEqual({
    globalRules: "Always reply in Chinese.",
  });
});

test("normalizePersonalizationSettingsSnapshot drops empty global rules", () => {
  expect(
    normalizePersonalizationSettingsSnapshot({
      globalRules: "   ",
    }),
  ).toEqual({});
});

test("normalizePersonalizationSettingsSnapshot truncates oversized global rules", () => {
  const oversized = "x".repeat(GLOBAL_USER_RULES_MAX_CHARS + 50);
  expect(normalizePersonalizationSettingsSnapshot({ globalRules: oversized })).toEqual({
    globalRules: "x".repeat(GLOBAL_USER_RULES_MAX_CHARS),
  });
});

test("isPersonalizationSettingsSnapshot validates shape", () => {
  expect(isPersonalizationSettingsSnapshot(defaultPersonalizationSettings())).toBe(true);
  expect(isPersonalizationSettingsSnapshot({ globalRules: "ok" })).toBe(true);
  expect(isPersonalizationSettingsSnapshot({ globalRules: 1 })).toBe(false);
  expect(isPersonalizationSettingsSnapshot(null)).toBe(false);
});
