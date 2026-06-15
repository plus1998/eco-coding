import { expect, test } from "bun:test";
import {
  shouldScheduleThinkingAutoCollapse,
  THINKING_AUTO_COLLAPSE_READ_MS,
} from "../src/renderer/thinking-auto-collapse";

test("thinking auto-collapse waits long enough for reading", () => {
  expect(THINKING_AUTO_COLLAPSE_READ_MS).toBeGreaterThanOrEqual(7000);
});

test("thinking auto-collapse schedules after a streamed body finishes", () => {
  expect(
    shouldScheduleThinkingAutoCollapse({
      streaming: false,
      hasBody: true,
      collapsed: false,
      autoCollapseEligible: true,
      autoCollapseSuppressed: false,
    }),
  ).toBe(true);
});

test("thinking auto-collapse does not run while streaming or after manual toggles", () => {
  expect(
    shouldScheduleThinkingAutoCollapse({
      streaming: true,
      hasBody: true,
      collapsed: false,
      autoCollapseEligible: true,
      autoCollapseSuppressed: false,
    }),
  ).toBe(false);
  expect(
    shouldScheduleThinkingAutoCollapse({
      streaming: false,
      hasBody: true,
      collapsed: false,
      autoCollapseEligible: true,
      autoCollapseSuppressed: true,
    }),
  ).toBe(false);
});
