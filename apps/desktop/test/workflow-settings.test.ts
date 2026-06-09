import { expect, test } from "bun:test";
import {
  defaultWorkflowSettings,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  orchestrationModeFromSnapshot,
  usesManualOrchestration,
  usesPlanMode,
  usesPlanOrchestration,
} from "../src/main/workflow-settings-store";

test("plan mode defaults to off", () => {
  expect(defaultWorkflowSettings()).toEqual({ planModeEnabled: false });
  expect(usesPlanMode(defaultWorkflowSettings())).toBe(false);
  expect(usesManualOrchestration(defaultWorkflowSettings())).toBe(false);
});

test("isWorkflowSettingsSnapshot accepts orchestrationMode and legacy fields", () => {
  expect(isWorkflowSettingsSnapshot({ orchestrationMode: "autonomous" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ orchestrationMode: "manual" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ planModeEnabled: true })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ orchestrationMode: "sdk_default" })).toBe(true);
  expect(isWorkflowSettingsSnapshot({ orchestrationMode: "invalid" })).toBe(false);
});

test("normalizeWorkflowSettingsSnapshot maps legacy values", () => {
  expect(normalizeWorkflowSettingsSnapshot({ orchestrationMode: "sdk_default" })).toEqual({
    planModeEnabled: false,
  });
  expect(normalizeWorkflowSettingsSnapshot({ orchestrationMode: "analyze_plan_execute" })).toEqual({
    planModeEnabled: true,
  });
  expect(normalizeWorkflowSettingsSnapshot({ planModeEnabled: true })).toEqual({
    planModeEnabled: true,
  });
  expect(normalizeWorkflowSettingsSnapshot({ planModeEnabled: false })).toEqual({
    planModeEnabled: false,
  });
});

test("orchestrationModeFromSnapshot maps plan mode to runtime mode", () => {
  expect(orchestrationModeFromSnapshot({ planModeEnabled: true })).toBe("manual");
  expect(orchestrationModeFromSnapshot({ planModeEnabled: false })).toBe("autonomous");
});

test("usesPlanOrchestration is alias for plan mode", () => {
  expect(usesPlanOrchestration({ planModeEnabled: true })).toBe(true);
  expect(usesPlanOrchestration({ planModeEnabled: false })).toBe(false);
});
