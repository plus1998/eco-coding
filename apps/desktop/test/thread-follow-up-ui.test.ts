import { expect, test } from "bun:test";
import { i18n } from "../src/renderer/i18n";
import {
  canEscalateThreadFollowUp,
  formatThreadFollowUpPreview,
  isLiveFollowUpThreadStatus,
  mergeThreadFollowUp,
  queuedThreadFollowUps,
  shouldComposerUseFollowUpQueue,
} from "../src/renderer/thread-follow-up-ui";
import type { ThreadPendingFollowUp } from "../src/shared/ipc";
import {
  coreSupportsFollowUpEscalate,
  resolveFollowUpDeliveryModeForCore,
} from "../src/shared/thread-follow-up-core";

function followUp(id: string, patch: Partial<ThreadPendingFollowUp> = {}): ThreadPendingFollowUp {
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

test("shouldComposerUseFollowUpQueue while live, editing, or paused", () => {
  expect(shouldComposerUseFollowUpQueue({ status: "running" })).toBe(true);
  expect(shouldComposerUseFollowUpQueue({ status: "idle" })).toBe(false);
  expect(
    shouldComposerUseFollowUpQueue({
      status: "idle",
      followUpQueuePaused: true,
    }),
  ).toBe(true);
  expect(
    shouldComposerUseFollowUpQueue({
      status: "completed",
      editingFollowUpId: "fu_1",
    }),
  ).toBe(true);
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
  expect(
    formatThreadFollowUpPreview(
      followUp("images", {
        prompt: "",
        attachments: [{ mediaType: "image/png", data: "abc" }],
      }),
    ),
  ).toBe("1 image(s)");
  expect(formatThreadFollowUpPreview(followUp("empty", { prompt: "" }))).toBe("Empty follow-up message");
});

test("Guide stays clickable on an escalated row while the queue is paused", () => {
  expect(
    canEscalateThreadFollowUp({ priority: "normal", coreSupportsEscalate: true, queuePaused: true }),
  ).toBe(true);
  expect(
    canEscalateThreadFollowUp({
      priority: "escalated",
      coreSupportsEscalate: true,
      queuePaused: true,
    }),
  ).toBe(true);
  // Unpaused: an escalated row is already next in line, so the action is inert.
  expect(
    canEscalateThreadFollowUp({
      priority: "escalated",
      coreSupportsEscalate: true,
      queuePaused: false,
    }),
  ).toBe(false);
  expect(
    canEscalateThreadFollowUp({ priority: "normal", coreSupportsEscalate: false, queuePaused: true }),
  ).toBe(false);
});

test("follow-up UI allows escalate and preserves steer for mid-turn cores", () => {
  expect(coreSupportsFollowUpEscalate("acp")).toBe(true);
  expect(coreSupportsFollowUpEscalate("claude")).toBe(true);
  expect(coreSupportsFollowUpEscalate("pi")).toBe(true);
  expect(resolveFollowUpDeliveryModeForCore("acp", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("codex", "steer")).toBe("steer");
  expect(resolveFollowUpDeliveryModeForCore("pi", "steer")).toBe("steer");
});
