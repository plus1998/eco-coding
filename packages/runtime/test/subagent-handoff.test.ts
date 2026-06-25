import { expect, test } from "bun:test";
import {
  buildFallbackSubagentHandoffSummary,
  buildSubagentHandoffPrompt,
  shouldHandoffSubagentResume,
  splitSubagentActivityForHandoff,
} from "../src/subagent-handoff";

test("shouldHandoffSubagentResume triggers at compact limit threshold", () => {
  expect(shouldHandoffSubagentResume(100_000, 120_000, 0.85)).toBe(false);
  expect(shouldHandoffSubagentResume(102_000, 120_000, 0.85)).toBe(true);
  expect(shouldHandoffSubagentResume(0, 120_000, 0.85)).toBe(false);
});

test("splitSubagentActivityForHandoff keeps recent messages within budget", () => {
  const lines = [
    { message: "a".repeat(400) },
    { message: "b".repeat(400) },
    { message: "recent tail" },
  ];
  const split = splitSubagentActivityForHandoff(lines, { recentTokenBudget: 20 });
  expect(split.recent).toEqual(["recent tail"]);
  expect(split.older.length).toBe(2);
});

test("buildSubagentHandoffPrompt includes summary and fresh-instance note", () => {
  const prompt = buildSubagentHandoffPrompt(
    "Map auth flow",
    "explore",
    {
      summary: "Checked src/auth and middleware.",
      recentMessages: ["Found JWT in middleware.ts"],
      previousAgentId: "agent_explore_1",
    },
  );
  expect(prompt).toContain("Map auth flow");
  expect(prompt).toContain("未 Resume 完整历史");
  expect(prompt).toContain("agent_explore_1");
  expect(prompt).toContain("Checked src/auth and middleware.");
  expect(prompt).toContain("Found JWT in middleware.ts");
});

test("buildFallbackSubagentHandoffSummary uses structured headings", () => {
  const summary = buildFallbackSubagentHandoffSummary("Task", ["first finding", "x".repeat(500)]);
  expect(summary).toContain("## 任务目标");
  expect(summary).toContain("Task");
  expect(summary).toContain("first finding");
});
