import { expect, test } from "bun:test";
import {
  orchestrationModeUi,
  ORCHESTRATION_MODE_UI,
  toggleOrchestrationMode,
} from "../src/shared/orchestration-mode-ui";

test("ORCHESTRATION_MODE_UI defines autonomous and manual copy", () => {
  expect(ORCHESTRATION_MODE_UI.map((entry) => entry.value)).toEqual(["autonomous", "manual"]);
  expect(orchestrationModeUi("autonomous").title).toBe("自主编排");
  expect(orchestrationModeUi("manual").title).toBe("固定编排");
  expect(orchestrationModeUi("manual").description).toContain("预设流水线");
});

test("toggleOrchestrationMode switches between modes", () => {
  expect(toggleOrchestrationMode("autonomous")).toBe("manual");
  expect(toggleOrchestrationMode("manual")).toBe("autonomous");
});
