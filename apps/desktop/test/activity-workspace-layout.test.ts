import { expect, test } from "bun:test";
import {
  resolveActivityWorkspaceLayoutMode,
  shouldAutoOpenWorkspacePanel,
  shouldShowActivityMessageNav,
  workspacePanelLayoutForMode,
} from "../src/renderer/activity-workspace-layout";

test("resolveActivityWorkspaceLayoutMode maps the four available-width scenarios", () => {
  expect(resolveActivityWorkspaceLayoutMode(700, "feed-only")).toBe("feed-only");
  expect(resolveActivityWorkspaceLayoutMode(920, "feed-only")).toBe("feed-nav");
  expect(resolveActivityWorkspaceLayoutMode(1_120, "feed-nav")).toBe("feed-panel");
  expect(resolveActivityWorkspaceLayoutMode(1_520, "feed-panel")).toBe("full");
});

test("resolveActivityWorkspaceLayoutMode retains modes inside resize hysteresis", () => {
  expect(resolveActivityWorkspaceLayoutMode(1_400, "full")).toBe("full");
  expect(resolveActivityWorkspaceLayoutMode(1_040, "feed-panel")).toBe("feed-panel");
  expect(resolveActivityWorkspaceLayoutMode(830, "feed-nav")).toBe("feed-nav");
});

test("workspace panel docks only in feed-panel mode", () => {
  expect(workspacePanelLayoutForMode("feed-only")).toBe("floating");
  expect(workspacePanelLayoutForMode("feed-nav")).toBe("floating");
  expect(workspacePanelLayoutForMode("feed-panel")).toBe("docked");
  expect(workspacePanelLayoutForMode("full")).toBe("floating");
  expect(shouldAutoOpenWorkspacePanel("feed-nav")).toBe(false);
  expect(shouldAutoOpenWorkspacePanel("feed-panel")).toBe(true);
  expect(shouldAutoOpenWorkspacePanel("full")).toBe(true);
});

test("message navigation needs at least three messages and a nav-capable mode", () => {
  expect(shouldShowActivityMessageNav("full", 2)).toBe(false);
  expect(shouldShowActivityMessageNav("full", 3)).toBe(true);
  expect(shouldShowActivityMessageNav("feed-nav", 3)).toBe(true);
  expect(shouldShowActivityMessageNav("feed-panel", 4)).toBe(false);
  expect(shouldShowActivityMessageNav("feed-only", 4)).toBe(false);
});
