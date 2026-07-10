import { expect, test } from "bun:test";
import {
  buildCompactionSummaryPrompt,
  buildEcoCompactHandoffPrompt,
  estimateTokens,
  splitMessagesForCompact,
} from "../src/shared/eco-compact-handoff";

test("estimateTokens handles ASCII and CJK without provider token APIs", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("abcde")).toBe(2);
  expect(estimateTokens("上下文")).toBe(3);
});

test("splitMessagesForCompact keeps the latest two complete turns within budget", () => {
  const oldUser = "a".repeat(400);
  const lines = [
    { role: "user", message: oldUser },
    { role: "assistant", message: "old assistant" },
    { role: "user", message: "recent user 1" },
    { role: "assistant", message: "recent assistant 1" },
    { role: "user", message: "recent user 2" },
    { role: "assistant", message: "recent assistant 2" },
  ];

  const split = splitMessagesForCompact(lines, { recentTokenBudget: 40, recentTurns: 2 });
  expect(split.older).toEqual([
    { role: "user", message: oldUser },
    { role: "assistant", message: "old assistant" },
  ]);
  expect(split.recent).toEqual([
    { role: "user", message: "recent user 1" },
    { role: "assistant", message: "recent assistant 1" },
    { role: "user", message: "recent user 2" },
    { role: "assistant", message: "recent assistant 2" },
  ]);
});

test("splitMessagesForCompact does not start a turn at a tool_result user message", () => {
  const split = splitMessagesForCompact(
    [
      { role: "user", message: "first request" },
      { role: "assistant", message: '[工具调用 Read] {"file":"a.ts"}' },
      { role: "user", message: "[工具结果 call_1] file contents" },
      { role: "assistant", message: "first answer" },
      { role: "user", message: "second request" },
      { role: "assistant", message: "second answer" },
    ],
    { recentTokenBudget: 20, recentTurns: 1 },
  );

  expect(split.recent).toEqual([
    { role: "user", message: "second request" },
    { role: "assistant", message: "second answer" },
  ]);
  expect(split.older.at(-1)).toEqual({ role: "assistant", message: "first answer" });
});

test("splitMessagesForCompact moves an oversized latest turn into summarized history", () => {
  const huge = "x".repeat(100_000);
  const split = splitMessagesForCompact(
    [
      { role: "user", message: huge },
      { role: "assistant", message: "done" },
    ],
    { recentTokenBudget: 20_000, recentTurns: 2 },
  );
  expect(split.recent).toEqual([]);
  expect(split.older).toEqual([
    { role: "user", message: huge },
    { role: "assistant", message: "done" },
  ]);
});

test("buildEcoCompactHandoffPrompt includes summary, role-labelled recent turns, and follow-up", () => {
  const prompt = buildEcoCompactHandoffPrompt("实现登录功能", "继续写测试", {
    summary: "已完成路由骨架",
    recentMessages: [
      { role: "user", message: "补上 OAuth" },
      { role: "assistant", message: "已补上实现" },
    ],
  });

  expect(prompt).toContain("实现登录功能");
  expect(prompt).toContain("## 对话摘要（结构化压缩）");
  expect(prompt).toContain("已完成路由骨架");
  expect(prompt).toContain("## 近期对话（原文保留）");
  expect(prompt).toContain("1. [用户]\n补上 OAuth");
  expect(prompt).toContain("2. [助手]\n已补上实现");
  expect(prompt).toContain("后续消息：\n继续写测试");
});

test("buildCompactionSummaryPrompt includes assistant and tool context", () => {
  const prompt = buildCompactionSummaryPrompt("修 bug", [
    { role: "user", message: "读取文件" },
    { role: "assistant", message: '[工具调用 Read] {"file":"a.ts"}' },
    { role: "user", message: "[工具结果 call_1] TypeError" },
    { role: "assistant", message: "定位到 a.ts:42" },
  ]);
  expect(prompt).toContain("修 bug");
  expect(prompt).toContain("1. [用户]\n读取文件");
  expect(prompt).toContain("2. [助手]\n[工具调用 Read]");
  expect(prompt).toContain("3. [用户]\n[工具结果 call_1] TypeError");
  expect(prompt).toContain("4. [助手]\n定位到 a.ts:42");
});
