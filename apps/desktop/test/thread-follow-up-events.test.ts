import { expect, test } from "bun:test";
import {
  isThreadFollowUpActivityMessage,
  isThreadFollowUpLiveEvent,
  isUserPromptActivityLine,
} from "../src/shared/thread-follow-up-events";

test("isThreadFollowUpLiveEvent matches follow-up live event types", () => {
  expect(isThreadFollowUpLiveEvent("thread.follow_up.queued")).toBe(true);
  expect(isThreadFollowUpLiveEvent("thread.follow_up.cancelled")).toBe(true);
  expect(isThreadFollowUpLiveEvent("thread.user_prompt")).toBe(false);
});

test("isThreadFollowUpActivityMessage hides operational follow-up status lines", () => {
  expect(isThreadFollowUpActivityMessage("已取消排队的后续消息。")).toBe(true);
  expect(isThreadFollowUpActivityMessage("已记录后续消息，并标记为需要立即处理。")).toBe(true);
  expect(isThreadFollowUpActivityMessage("正在停止当前步骤，随后处理最新后续消息。")).toBe(true);
  expect(isThreadFollowUpActivityMessage("已开始处理排队的后续消息。")).toBe(true);
  expect(isThreadFollowUpActivityMessage("后续消息处理失败：当前对话没有可中断的 active run。")).toBe(true);
  expect(isThreadFollowUpActivityMessage("请继续实现登录页")).toBe(false);
});

test("isUserPromptActivityLine only keeps real user-authored activity lines", () => {
  expect(isUserPromptActivityLine({ role: "user", message: "继续实现" })).toBe(true);
  expect(isUserPromptActivityLine({ role: "user", message: "已取消排队的后续消息。" })).toBe(false);
  expect(isUserPromptActivityLine({ role: "system", message: "已取消排队的后续消息。" })).toBe(false);
});
