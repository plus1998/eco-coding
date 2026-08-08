import { expect, test } from "bun:test";
import {
  defaultNotificationSettings,
  isNotificationSettingsSnapshot,
  isTurnCompletionNotifyMode,
  normalizeNotificationSettingsSnapshot,
  preferenceAllowsDesktopNotification,
  shouldNotifyPermission,
  shouldNotifyQuestion,
  shouldNotifyTurnCompletion,
} from "../src/shared/notification-settings";

test("defaults match current product behavior", () => {
  expect(defaultNotificationSettings()).toEqual({
    turnCompletion: "unfocused",
    permissionEnabled: true,
    questionEnabled: true,
  });
});

test("normalizes invalid notification settings", () => {
  expect(normalizeNotificationSettingsSnapshot(null)).toEqual(defaultNotificationSettings());
  expect(
    normalizeNotificationSettingsSnapshot({
      turnCompletion: "always",
      permissionEnabled: false,
      questionEnabled: false,
    }),
  ).toEqual({
    turnCompletion: "always",
    permissionEnabled: false,
    questionEnabled: false,
  });
  expect(
    normalizeNotificationSettingsSnapshot({
      turnCompletion: "bogus",
      permissionEnabled: "yes",
      questionEnabled: 0,
    }),
  ).toEqual({
    turnCompletion: "unfocused",
    permissionEnabled: true,
    questionEnabled: true,
  });
});

test("type guard requires all fields", () => {
  expect(isNotificationSettingsSnapshot(defaultNotificationSettings())).toBe(true);
  expect(isNotificationSettingsSnapshot({ turnCompletion: "never" })).toBe(false);
  expect(isTurnCompletionNotifyMode("unfocused")).toBe(true);
  expect(isTurnCompletionNotifyMode("sometimes")).toBe(false);
});

test("turn completion notify modes", () => {
  expect(shouldNotifyTurnCompletion("never", false)).toBe(false);
  expect(shouldNotifyTurnCompletion("never", true)).toBe(false);
  expect(shouldNotifyTurnCompletion("unfocused", false)).toBe(true);
  expect(shouldNotifyTurnCompletion("unfocused", true)).toBe(false);
  expect(shouldNotifyTurnCompletion("always", false)).toBe(true);
  expect(shouldNotifyTurnCompletion("always", true)).toBe(true);
});

test("permission and question toggles only fire when unfocused", () => {
  expect(shouldNotifyPermission(true, false)).toBe(true);
  expect(shouldNotifyPermission(true, true)).toBe(false);
  expect(shouldNotifyPermission(false, false)).toBe(false);
  expect(shouldNotifyQuestion(true, false)).toBe(true);
  expect(shouldNotifyQuestion(true, true)).toBe(false);
  expect(shouldNotifyQuestion(false, false)).toBe(false);
});

test("preferenceAllowsDesktopNotification mirrors per-kind gates", () => {
  const settings = defaultNotificationSettings();
  expect(preferenceAllowsDesktopNotification(settings, "completion", true)).toBe(false);
  expect(preferenceAllowsDesktopNotification(settings, "completion", false)).toBe(true);
  expect(
    preferenceAllowsDesktopNotification({ ...settings, turnCompletion: "always" }, "completion", true),
  ).toBe(true);
  expect(
    preferenceAllowsDesktopNotification({ ...settings, permissionEnabled: false }, "approval", false),
  ).toBe(false);
  expect(
    preferenceAllowsDesktopNotification({ ...settings, questionEnabled: false }, "question", false),
  ).toBe(false);
});
