import { describe, expect, test } from "bun:test";
import {
  formatSubagentTaskNameLabel,
  resolveSubagentActivityTitle,
  taskNameFromAgentPath,
} from "../src/shared/subagent-task-name";

describe("formatSubagentTaskNameLabel", () => {
  test("splits underscores and capitalizes each word", () => {
    expect(formatSubagentTaskNameLabel("get_timezone_v2")).toBe("Get Timezone V2");
    expect(formatSubagentTaskNameLabel("weather_guangzhou")).toBe("Weather Guangzhou");
    expect(formatSubagentTaskNameLabel("explore")).toBe("Explore");
  });

  test("returns empty for blank input", () => {
    expect(formatSubagentTaskNameLabel("")).toBe("");
    expect(formatSubagentTaskNameLabel("   ")).toBe("");
  });
});

describe("resolveSubagentActivityTitle", () => {
  test("appends formatted task name when present", () => {
    expect(resolveSubagentActivityTitle("编码", "implement_drawer")).toBe("编码 Implement Drawer");
  });

  test("keeps role only when task name is missing", () => {
    expect(resolveSubagentActivityTitle("编码")).toBe("编码");
    expect(resolveSubagentActivityTitle("编码", "")).toBe("编码");
  });
});

describe("taskNameFromAgentPath", () => {
  test("reads the last path segment", () => {
    expect(taskNameFromAgentPath("/root/weather_check")).toBe("weather_check");
    expect(taskNameFromAgentPath("/root/task1/task_3")).toBe("task_3");
  });

  test("ignores bare root", () => {
    expect(taskNameFromAgentPath("/root")).toBeUndefined();
    expect(taskNameFromAgentPath("")).toBeUndefined();
  });
});
