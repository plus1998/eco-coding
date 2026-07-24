import { expect, test } from "bun:test";
import type { ThreadPendingFollowUp } from "../src/shared/ipc";
import {
  formatThreadFollowUpPreview,
  isLiveFollowUpThreadStatus,
  mergeThreadFollowUp,
  queuedThreadFollowUps,
} from "../src/renderer/thread-follow-up-ui";
import { i18n } from "../src/renderer/i18n";

function followUp(
  id: string,
  patch: Partial<ThreadPendingFollowUp> = {},
): ThreadPendingFollowUp {
  return {
    id,
    threadId: "thr_1",
    prompt: `message ${id}`,
    priority: "normal",
    status: "queued",
    deliveryMode: "queued",
    createdAt: `2024-01-01T00:00:0${id.length}.000Z`,
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...patch,
  };
}

test("isLiveFollowUpThreadStatus only opens running and queued UI", () => {
  expect(isLiveFollowUpThreadStatus("running")).toBe(true);
  expect(isLiveFollowUpThreadStatus("queued")).toBe(true);
  expect(isLiveFollowUpThreadStatus("awaiting_plan")).toBe(false);
  expect(isLiveFollowUpThreadStatus("completed")).toBe(false);
});

test("queuedThreadFollowUps hides non-queued records and preserves stable priority order", () => {
  const normal = followUp("normal", { createdAt: "2024-01-01T00:00:01.000Z" });
  const cancelled = followUp("cancelled", { status: "cancelled" });
  const escalated = followUp("escalated", {
    priority: "escalated",
    deliveryMode: "interrupt_resume",
    createdAt: "2024-01-01T00:00:02.000Z",
  });

  expect(queuedThreadFollowUps([normal, cancelled, escalated]).map((item) => item.id)).toEqual([
    "escalated",
    "normal",
  ]);
});

test("mergeThreadFollowUp replaces existing records by id", () => {
  const original = followUp("same", { prompt: "旧消息" });
  const updated = followUp("same", { prompt: "已取消", status: "cancelled" });

  expect(mergeThreadFollowUp([original], updated)).toEqual([updated]);
});

test("formatThreadFollowUpPreview localizes image and empty defaults", async () => {
  await i18n.changeLanguage("en-US");
  const preview = formatThreadFollowUpPreview(
    followUp("with-image", {
      prompt: "a".repeat(140),
      attachments: [{ mediaType: "image/png", data: "abc" }],
    }),
  );

  expect(preview).toEndWith("... (1 image(s))");
  expect(preview.length).toBeLessThan(140);
  expect(formatThreadFollowUpPreview(followUp("images", {
    prompt: "",
    attachments: [{ mediaType: "image/png", data: "abc" }],
  }))).toBe("1 image(s)");
  expect(formatThreadFollowUpPreview(followUp("empty", { prompt: "" }))).toBe(
    "Empty follow-up message",
  );
});
