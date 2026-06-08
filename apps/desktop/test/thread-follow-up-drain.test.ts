import { expect, test } from "bun:test";
import type { ThreadPendingFollowUp } from "../src/shared/ipc";
import {
  buildThreadFollowUpDrainPrompt,
  collectThreadFollowUpAttachments,
  shouldDrainThreadFollowUps,
} from "../src/shared/thread-follow-up-drain";

function followUp(
  id: string,
  patch: Partial<ThreadPendingFollowUp> = {},
): ThreadPendingFollowUp {
  return {
    id,
    threadId: "thr_1",
    prompt: `后续 ${id}`,
    priority: "normal",
    status: "delivered",
    deliveryMode: "resume",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    deliveredAt: "2024-01-01T00:00:01.000Z",
    ...patch,
  };
}

test("shouldDrainThreadFollowUps only allows safe boundary statuses", () => {
  expect(shouldDrainThreadFollowUps("completed")).toBe(true);
  expect(shouldDrainThreadFollowUps("failed")).toBe(true);
  expect(shouldDrainThreadFollowUps("blocked")).toBe(true);
  expect(shouldDrainThreadFollowUps("awaiting_plan")).toBe(true);
  expect(shouldDrainThreadFollowUps("running")).toBe(false);
  expect(shouldDrainThreadFollowUps("queued")).toBe(false);
  expect(shouldDrainThreadFollowUps("idle")).toBe(false);
});

test("buildThreadFollowUpDrainPrompt merges delivered follow-ups in order", () => {
  const prompt = buildThreadFollowUpDrainPrompt([
    followUp("1", {
      prompt: "先补测试",
      queuedDuringPhase: "execution",
      deliveryBoundary: "safe_boundary",
    }),
    followUp("2", {
      prompt: "再更新文档",
      priority: "escalated",
      queuedDuringPhase: "execution",
      deliveryBoundary: "forced_interrupt",
    }),
  ]);

  expect(prompt).toContain("不要重规划");
  expect(prompt).toContain("queuedDuringPhase=execution");
  expect(prompt).toContain("boundary=forced_interrupt");
  expect(prompt).toContain("后续消息 1");
  expect(prompt).toContain("先补测试");
  expect(prompt).toContain("立即后续消息 2");
  expect(prompt).toContain("再更新文档");
});

test("buildThreadFollowUpDrainPrompt ignores queued records until claimed", () => {
  expect(
    buildThreadFollowUpDrainPrompt([
      followUp("queued", { status: "queued", deliveryMode: "queued" }),
    ]),
  ).toBe("");
});

test("collectThreadFollowUpAttachments only includes delivered attachments", () => {
  const attachments = collectThreadFollowUpAttachments([
    followUp("delivered", { attachments: [{ mediaType: "image/png", data: "abc" }] }),
    followUp("queued", {
      status: "queued",
      deliveryMode: "queued",
      attachments: [{ mediaType: "image/jpeg", data: "def" }],
    }),
  ]);

  expect(attachments).toEqual([{ mediaType: "image/png", data: "abc" }]);
});
