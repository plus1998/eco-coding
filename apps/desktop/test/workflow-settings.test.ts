import { expect, test } from "bun:test";
import {
  defaultWorkflowSettings,
  isWorkflowSettingsSnapshot,
  normalizeWorkflowSettingsSnapshot,
  orchestrationModeFromSnapshot,
  usesManualOrchestration,
  usesPlanOrchestration,
} from "../src/main/workflow-settings-store";

test("orchestration defaults to autonomous", () => {
  expect(defaultWorkflowSettings()).toEqual({ orchestrationMode: "autonomous" });
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
    orchestrationMode: "autonomous",
  });
  expect(normalizeWorkflowSettingsSnapshot({ orchestrationMode: "analyze_plan_execute" })).toEqual({
    orchestrationMode: "manual",
  });
  expect(normalizeWorkflowSettingsSnapshot({ planModeEnabled: true })).toEqual({
    orchestrationMode: "manual",
  });
  expect(normalizeWorkflowSettingsSnapshot({ planModeEnabled: false })).toEqual({
    orchestrationMode: "autonomous",
  });
});

test("orchestrationModeFromSnapshot maps to runtime mode", () => {
  expect(orchestrationModeFromSnapshot({ orchestrationMode: "manual" })).toBe("manual");
  expect(orchestrationModeFromSnapshot({ orchestrationMode: "autonomous" })).toBe("autonomous");
});

test("usesPlanOrchestration is alias for manual", () => {
  expect(usesPlanOrchestration({ orchestrationMode: "manual" })).toBe(true);
  expect(usesPlanOrchestration({ orchestrationMode: "autonomous" })).toBe(false);
});
