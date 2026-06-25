import { expect, test } from "bun:test";
import {
  buildStructuredCompactFallback,
  formatStructuredCompactSections,
  parseStructuredCompactSections,
  STRUCTURED_COMPACT_HEADINGS,
} from "../src/structured-compact-summary";

test("formatStructuredCompactSections emits all headings", () => {
  const text = formatStructuredCompactSections({
    任务目标: "实现登录",
    "已读/已改文件": "src/auth.ts",
  });
  for (const heading of STRUCTURED_COMPACT_HEADINGS) {
    expect(text).toContain(`## ${heading}`);
  }
  expect(text).toContain("实现登录");
});

test("parseStructuredCompactSections reads structured summary", () => {
  const text = [
    "## 任务目标",
    "修 bug",
    "",
    "## 未完成事项",
    "补测试",
  ].join("\n");
  const sections = parseStructuredCompactSections(text);
  expect(sections["任务目标"]).toBe("修 bug");
  expect(sections["未完成事项"]).toBe("补测试");
});

test("buildStructuredCompactFallback uses older messages in decisions section", () => {
  const summary = buildStructuredCompactFallback({
    taskGoal: "Map auth",
    olderMessages: ["checked middleware", "found JWT bug"],
  });
  expect(summary).toContain("## 任务目标");
  expect(summary).toContain("Map auth");
  expect(summary).toContain("checked middleware");
});
