import { expect, test } from "bun:test";
import { MAIN_SHELL_BREAKPOINTS } from "../src/renderer/activity-workspace-layout";
import {
  COMPOSER_ICON_ONLY_CONTAINER,
  COMPOSER_ICON_ONLY_MAX_WIDTH_PX,
  resolveComposerIconOnlyToolbar,
} from "../src/renderer/ComposerHoverTooltip";

test("composer icon-only observes the composer card for landing and thread", () => {
  expect(COMPOSER_ICON_ONLY_CONTAINER).toBe(".codex-composer-wrap");
  expect(COMPOSER_ICON_ONLY_MAX_WIDTH_PX).toBe(MAIN_SHELL_BREAKPOINTS.composerIconOnly);
  expect(COMPOSER_ICON_ONLY_MAX_WIDTH_PX).toBe(640);
});

test("resolveComposerIconOnlyToolbar prefers composer card width over viewport", () => {
  expect(resolveComposerIconOnlyToolbar({ containerWidth: 520, viewportMatches: false })).toBe(true);
  expect(resolveComposerIconOnlyToolbar({ containerWidth: 720, viewportMatches: true })).toBe(false);
});

test("resolveComposerIconOnlyToolbar falls back to viewport when composer card is absent", () => {
  expect(resolveComposerIconOnlyToolbar({ containerWidth: null, viewportMatches: true })).toBe(true);
  expect(resolveComposerIconOnlyToolbar({ containerWidth: undefined, viewportMatches: false })).toBe(false);
  expect(resolveComposerIconOnlyToolbar({ containerWidth: 0, viewportMatches: true })).toBe(true);
});

test("resolveComposerIconOnlyToolbar treats landing max-width as icon-only", () => {
  expect(resolveComposerIconOnlyToolbar({ containerWidth: 640, viewportMatches: false })).toBe(true);
  expect(resolveComposerIconOnlyToolbar({ containerWidth: 641, viewportMatches: false })).toBe(false);
});
