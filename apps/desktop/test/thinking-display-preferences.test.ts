import { expect, test } from "bun:test";
import {
  DEFAULT_THINKING_DISPLAY_PREFERENCES,
  normalizeThinkingDisplayPreferences,
  thinkingModeDefaultExpanded,
  thinkingModeUsesEphemeralTip,
} from "../src/renderer/thinking-display-preferences";

test("thinking display preference defaults to ephemeral", () => {
  expect(DEFAULT_THINKING_DISPLAY_PREFERENCES.mode).toBe("ephemeral");
  expect(normalizeThinkingDisplayPreferences(undefined)).toEqual({ mode: "ephemeral" });
  expect(normalizeThinkingDisplayPreferences(null)).toEqual({ mode: "ephemeral" });
  expect(normalizeThinkingDisplayPreferences({})).toEqual({ mode: "ephemeral" });
  expect(normalizeThinkingDisplayPreferences({ mode: "nope" })).toEqual({ mode: "ephemeral" });
});

test("thinking display preference accepts three modes", () => {
  expect(normalizeThinkingDisplayPreferences({ mode: "ephemeral" })).toEqual({ mode: "ephemeral" });
  expect(normalizeThinkingDisplayPreferences({ mode: "collapsed" })).toEqual({ mode: "collapsed" });
  expect(normalizeThinkingDisplayPreferences({ mode: "expanded" })).toEqual({ mode: "expanded" });
});

test("thinking display preference migrates legacy boolean", () => {
  expect(normalizeThinkingDisplayPreferences({ thinkingContentDefaultExpanded: true })).toEqual({
    mode: "expanded",
  });
  expect(normalizeThinkingDisplayPreferences({ thinkingContentDefaultExpanded: false })).toEqual({
    mode: "collapsed",
  });
  expect(normalizeThinkingDisplayPreferences({ thinkingContentDefaultExpanded: "yes" })).toEqual({
    mode: "ephemeral",
  });
});

test("thinking mode helpers map to tip vs card effects", () => {
  expect(thinkingModeUsesEphemeralTip("ephemeral")).toBe(true);
  expect(thinkingModeUsesEphemeralTip("collapsed")).toBe(false);
  expect(thinkingModeUsesEphemeralTip("expanded")).toBe(false);
  expect(thinkingModeDefaultExpanded("ephemeral")).toBe(false);
  expect(thinkingModeDefaultExpanded("collapsed")).toBe(false);
  expect(thinkingModeDefaultExpanded("expanded")).toBe(true);
});
