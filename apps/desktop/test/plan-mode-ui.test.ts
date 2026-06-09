import { expect, test } from "bun:test";
import { PLAN_MODE_UI, planModeUi, togglePlanMode } from "../src/shared/plan-mode-ui";

test("PLAN_MODE_UI defines plan mode on and off copy", () => {
  expect(PLAN_MODE_UI.map((entry) => entry.value)).toEqual([false, true]);
  expect(planModeUi(false).title).toBe("计划模式关");
  expect(planModeUi(true).title).toBe("计划模式开");
  expect(planModeUi(true).description).toContain("生成计划");
});

test("togglePlanMode switches between on and off", () => {
  expect(togglePlanMode(false)).toBe(true);
  expect(togglePlanMode(true)).toBe(false);
});
