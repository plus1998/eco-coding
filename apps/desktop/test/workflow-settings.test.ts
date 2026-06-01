import { expect, test } from "bun:test";
import {
  defaultWorkflowSettings,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  orchestrationModeFromSnapshot,
  usesPlanOrchestration,
} from "../src/main/workflow-settings-store";

test("plan mode defaults to enabled", () => {
  expect(defaultWorkflowSettings()).toEqual({ planModeEnabled: true });
  expect(usesPlanOrchestration(defaultWorkflowSettings())).toBe(true);
});

test("isWorkflowSettingsSnapshot accepts planModeEnabled and legacy orchestrationMode", () => {
  expect(isWorkflowSettingsSnapshot({ planModeEnabled: true })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ planModeEnabled: false })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ orchestrationMode: "sdk_default" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ orchestrationMode: "invalid" })).toBe(false);
});

test("normalizeWorkflowSettingsSnapshot maps legacy orchestration mode", () => {
  expect(normalizeWorkflowSettingsSnapshot({ orchestrationMode: "sdk_default" })).toEqual({
    planModeEnabled: false,
  });
  expect(normalizeWorkflowSettingsSnapshot({ planModeEnabled: false })).toEqual({
    planModeEnabled: false,
  });
});

test("orchestrationModeFromSnapshot maps plan switch to runtime mode", () => {
  expect(orchestrationModeFromSnapshot({ planModeEnabled: true })).toBe("analyze_plan_execute");
  expect(orchestrationModeFromSnapshot({ planModeEnabled: false })).toBe("sdk_default");
});
