import { expect, test } from "bun:test";
import {
  buildCompactionSummaryPrompt,
  buildEcoCompactHandoffPrompt,
  CODEX_COMPACT_SUMMARY_PREFIX,
  DEFAULT_RECENT_TOKEN_BUDGET,
  estimateTokens,
  splitMessagesForCompact,
  stripInjectedCompactHandoffMessage,
} from "../src/shared/eco-compact-handoff";

test("estimateTokens handles ASCII and CJK without provider token APIs", () => {
  expect(estimateTokens("")).toBe(0);
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("abcde")).toBe(2);
  expect(estimateTokens("上下文")).toBe(3);
});

test("splitMessagesForCompact keeps recent real user messages only within budget", () => {
  const oldUser = "a".repeat(400);
  const lines = [
    { role: "user", message: oldUser },
    { role: "assistant", message: "old assistant" },
    { role: "user", message: "recent user 1" },
    { role: "assistant", message: "recent assistant 1" },
    { role: "user", message: "recent user 2" },
    { role: "assistant", message: "recent assistant 2" },
  ];

  // Budget fits only the two newest real users (no leftover for a truncated older user).
  const split = splitMessagesForCompact(lines, { recentTokenBudget: 12 });
  expect(split.recent.every((message) => message.role === "user")).toBe(true);
  expect(split.recent.map((message) => message.message)).toEqual(["recent user 1", "recent user 2"]);
  expect(split.older).toEqual([
    { role: "user", message: oldUser },
    { role: "assistant", message: "old assistant" },
    { role: "assistant", message: "recent assistant 1" },
    { role: "assistant", message: "recent assistant 2" },
  ]);
});

test("splitMessagesForCompact ignores tool_result user rows when selecting recent users", () => {
  const split = splitMessagesForCompact(
    [
      { role: "user", message: "first request" },
      { role: "assistant", message: '[工具调用 Read] {"file":"a.ts"}' },
      { role: "user", message: "[工具结果 call_1] file contents" },
      { role: "assistant", message: "first answer" },
      { role: "user", message: "second request" },
      { role: "assistant", message: "second answer" },
    ],
    { recentTokenBudget: 7 },
  );

  expect(split.recent).toEqual([{ role: "user", message: "second request" }]);
  expect(split.older.some((message) => message.message.startsWith("[工具结果"))).toBe(true);
  expect(split.older.some((message) => message.message === "first request")).toBe(true);
});

test("splitMessagesForCompact middle-truncates the boundary user message at the budget", () => {
  const head = "HEAD_MARKER_AAA";
  const tail = "TAIL_MARKER_ZZZ";
  const huge = `${head}${"x".repeat(100_000)}${tail}`;
  const split = splitMessagesForCompact(
    [
      { role: "user", message: huge },
      { role: "assistant", message: "done" },
    ],
    { recentTokenBudget: 100 },
  );
  expect(split.recent).toHaveLength(1);
  expect(split.recent[0]?.role).toBe("user");
  const kept = split.recent[0]?.message ?? "";
  expect(kept).toContain("tokens truncated");
  expect(kept).toContain("HEAD");
  expect(kept).toContain("TAIL");
  expect(kept.length).toBeLessThan(huge.length);
  // Full original is still in older for summarization.
  expect(split.older).toEqual([
    { role: "user", message: huge },
    { role: "assistant", message: "done" },
  ]);
});

test("DEFAULT_RECENT_TOKEN_BUDGET is Codex-aligned 20k", () => {
  expect(DEFAULT_RECENT_TOKEN_BUDGET).toBe(20_000);
});

test("buildEcoCompactHandoffPrompt includes Codex prefix, summary, recent users, and follow-up", () => {
  const prompt = buildEcoCompactHandoffPrompt("实现登录功能", "继续写测试", {
    summary: "已完成路由骨架",
    recentMessages: [
      { role: "user", message: "补上 OAuth" },
      { role: "user", message: "再补刷新令牌" },
    ],
  });

  expect(prompt).toContain("实现登录功能");
  expect(prompt).toContain(CODEX_COMPACT_SUMMARY_PREFIX);
  expect(prompt).toContain("已完成路由骨架");
  expect(prompt).toContain("## 近期用户消息（原文保留）");
  expect(prompt).toContain("1. [用户]\n补上 OAuth");
  expect(prompt).toContain("2. [用户]\n再补刷新令牌");
  expect(prompt).toContain("后续消息：\n继续写测试");
});

test("stripInjectedCompactHandoffMessage retains only the follow-up", () => {
  const injected = buildEcoCompactHandoffPrompt("任务", "new follow-up only", {
    summary: "摘要正文",
    recentMessages: [{ role: "user", message: "keep me out of strip result" }],
  });
  expect(stripInjectedCompactHandoffMessage(injected)).toBe("new follow-up only");
});

test("buildCompactionSummaryPrompt is payload-only (no Codex system paste)", () => {
  const prompt = buildCompactionSummaryPrompt("修 bug", [
    { role: "user", message: "读取文件" },
    { role: "assistant", message: '[工具调用 Read] {"file":"a.ts"}' },
    { role: "user", message: "[工具结果 call_1] TypeError" },
    { role: "assistant", message: "定位到 a.ts:42" },
  ]);
  expect(prompt).toContain("## Conversation to compact");
  expect(prompt).toContain("1. [用户]\n读取文件");
  expect(prompt).toContain("2. [助手]\n[工具调用 Read]");
  expect(prompt).not.toContain("This is a single-chunk summary.");
  expect(prompt).not.toContain("You are performing a CONTEXT CHECKPOINT COMPACTION");
  expect(prompt).not.toContain("## 任务目标");
});
