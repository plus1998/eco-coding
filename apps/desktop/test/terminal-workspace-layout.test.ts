import { expect, test } from "bun:test";
import { workspacePanelMaxHeight } from "../src/renderer/terminal-workspace-layout";

test("limits workspace panel height above an open terminal", () => {
  expect(
    workspacePanelMaxHeight({
      workspaceHeight: 900,
      toolbarClearance: 36,
      terminalHeight: 280,
    }),
  ).toBe(560);
});

test("uses the full available height when terminal is closed", () => {
  expect(
    workspacePanelMaxHeight({
      workspaceHeight: 900,
      toolbarClearance: 36,
      terminalHeight: 0,
    }),
  ).toBe(840);
});

test("never returns a negative panel height", () => {
  expect(
    workspacePanelMaxHeight({
      workspaceHeight: 240,
      toolbarClearance: 36,
      terminalHeight: 280,
    }),
  ).toBe(0);
});
