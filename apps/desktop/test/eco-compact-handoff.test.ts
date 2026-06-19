import { expect, test } from "bun:test";
import {
  buildCompactionSummaryPrompt,
  buildEcoCompactHandoffPrompt,
  estimateTokens,
  splitUserMessagesForCompact,
} from "../src/shared/eco-compact-handoff";

test("estimateTokens uses chars / 4 ceiling", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("abcde")).toBe(2);
});

test("splitUserMessagesForCompact keeps recent user messages within budget from tail", () => {
  const lines = [
    { role: "user", message: "a".repeat(40_000) },
    { role: "assistant", message: "ignored" },
    { role: "user", message: "recent-1" },
    { role: "user", message: "recent-2" },
  ];

  const split = splitUserMessagesForCompact(lines, { recentTokenBudget: 20 });
  expect(split.recent).toEqual(["recent-1", "recent-2"]);
  expect(split.older).toEqual(["a".repeat(40_000)]);
});

test("splitUserMessagesForCompact handles zero user messages", () => {
  expect(splitUserMessagesForCompact([{ role: "assistant", message: "hi" }])).toEqual({
    older: [],
    recent: [],
  });
});

test("splitUserMessagesForCompact keeps an oversized single recent message", () => {
  const huge = "x".repeat(100_000);
  const split = splitUserMessagesForCompact([{ role: "user", message: huge }], {
    recentTokenBudget: 20_000,
  });
  expect(split.recent).toEqual([huge]);
  expect(split.older).toEqual([]);
});

test("buildEcoCompactHandoffPrompt includes summary, recent messages, and follow-up", () => {
  const prompt = buildEcoCompactHandoffPrompt(
    "实现登录功能",
    "继续写测试",
    {
      summary: "已完成路由骨架",
      recentUserMessages: ["补上 OAuth", "继续写测试"],
    },
  );

  expect(prompt).toContain("实现登录功能");
  expect(prompt).toContain("## 对话摘要（自动压缩）");
  expect(prompt).toContain("已完成路由骨架");
  expect(prompt).toContain("## 近期用户消息（原文保留）");
  expect(prompt).toContain("1. 补上 OAuth");
  expect(prompt).toContain("后续消息：");
  expect(prompt).toContain("继续写测试");
});

test("buildCompactionSummaryPrompt includes thread prompt and numbered older messages", () => {
  const prompt = buildCompactionSummaryPrompt("修 bug", ["第一条", "第二条"]);
  expect(prompt).toContain("修 bug");
  expect(prompt).toContain("1. 第一条");
  expect(prompt).toContain("2. 第二条");
});
