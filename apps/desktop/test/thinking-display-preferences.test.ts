import { expect, test } from "bun:test";
import {
  DEFAULT_THINKING_DISPLAY_PREFERENCES,
  normalizeThinkingDisplayPreferences,
} from "../src/renderer/thinking-display-preferences";

test("thinking display preference defaults to collapsed", () => {
  expect(DEFAULT_THINKING_DISPLAY_PREFERENCES.thinkingContentDefaultExpanded).toBe(false);
  expect(normalizeThinkingDisplayPreferences(undefined)).toEqual({
    thinkingContentDefaultExpanded: false,
  });
  expect(normalizeThinkingDisplayPreferences(null)).toEqual({
    thinkingContentDefaultExpanded: false,
  });
  expect(normalizeThinkingDisplayPreferences({ thinkingContentDefaultExpanded: "yes" })).toEqual({
    thinkingContentDefaultExpanded: false,
  });
  expect(normalizeThinkingDisplayPreferences({ thinkingContentDefaultExpanded: true })).toEqual({
    thinkingContentDefaultExpanded: true,
  });
});
