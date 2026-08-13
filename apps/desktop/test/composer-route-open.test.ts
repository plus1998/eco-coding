import { expect, test } from "bun:test";
import { shouldOpenOrchestrationFullSettings } from "../src/renderer/composer-route-open";

test("opens full settings only when editable and no main agent configs exist", () => {
  expect(
    shouldOpenOrchestrationFullSettings({
      canEditComposerConfig: true,
      mainAgentConfigCount: 0,
    }),
  ).toBe(true);
});

test("keeps readonly popover when running-like state cannot edit even with empty configs", () => {
  expect(
    shouldOpenOrchestrationFullSettings({
      canEditComposerConfig: false,
      mainAgentConfigCount: 0,
    }),
  ).toBe(false);
});

test("keeps popover when main agent configs already exist", () => {
  expect(
    shouldOpenOrchestrationFullSettings({
      canEditComposerConfig: true,
      mainAgentConfigCount: 2,
    }),
  ).toBe(false);
});
