import { expect, test } from "bun:test";
import { isSubagentEnabledSettings } from "../src/main/subagent-settings-store";

test("isSubagentEnabledSettings validates subagent toggle payload", () => {
  expect(
    isSubagentEnabledSettings({
      explore: true,
      architect: false,
      coder: true,
      reviewer: false,
      tester: true,
    }),
  ).toBe(true);
  expect(isSubagentEnabledSettings({ explore: true })).toBe(false);
  expect(isSubagentEnabledSettings(null)).toBe(false);
});
