import { expect, test } from "bun:test";
import type { ThreadRunProjectionTimelineItem } from "../src/shared/ipc";
import {
  buildPromptCacheTimelineNarrative,
  collapsePromptCacheTimelineItems,
  formatPromptCacheConfigDriftMessage,
  promptCacheTimelineStepFromItem,
} from "../src/shared/prompt-cache-timeline";

function item(
  partial: Partial<ThreadRunProjectionTimelineItem> & Pick<ThreadRunProjectionTimelineItem, "id" | "eventType">,
): ThreadRunProjectionTimelineItem {
  return {
    at: "2026-01-01T00:00:00.000Z",
    scope: "main",
    text: "",
    sequence: 1,
    ...partial,
  };
}

test("formatPromptCacheConfigDriftMessage describes composer drift", () => {
  expect(
    formatPromptCacheConfigDriftMessage(["profile"], {
      profileLabel: { modelStack: "GPT+DeepSeek", profileName: "Composer" },
    }),
  ).toContain("Composer");
  expect(
    formatPromptCacheConfigDriftMessage(["profile", "mcp"], {
      profileLabel: { modelStack: "GPT+DeepSeek", profileName: "Composer" },
    }),
  ).toContain("GPT+DeepSeek");
});

test("buildPromptCacheTimelineNarrative joins steps with arrows", () => {
  const narrative = buildPromptCacheTimelineNarrative([
    {
      kind: "config_drift",
      at: "t1",
      label: "已经变更为 GPT+DeepSeek（Composer）",
    },
    {
      kind: "invalidated",
      at: "t2",
      label: "已经变更为 GPT+DeepSeek（Composer），本会话 prompt cache 已失效",
    },
    {
      kind: "hit_dropped",
      at: "t3",
      label: "Prompt cache 命中率从 78% 降至 12%（↓66pp）",
    },
  ]);
  expect(narrative).toContain("→");
  expect(narrative).toContain("78% → 12%");
});

test("collapsePromptCacheTimelineItems merges consecutive cache events", () => {
  const collapsed = collapsePromptCacheTimelineItems([
    item({
      id: "drift",
      eventType: "context.cache_config_drift",
      text: "已经变更为 GPT+DeepSeek（Composer）",
      metadata: { promptCacheEpisodeId: "pce_1" },
    }),
    item({
      id: "invalidated",
      eventType: "context.cache_invalidated",
      text: "已经变更为 GPT+DeepSeek（Composer），本会话 prompt cache 已失效",
      metadata: { promptCacheEpisodeId: "pce_1" },
    }),
    item({
      id: "message",
      eventType: "message.final",
      text: "hello",
    }),
  ]);

  expect(collapsed).toHaveLength(2);
  const timeline = collapsed[0]?.metadata?.promptCacheTimeline as { steps?: Array<{ kind: string }> };
  expect(timeline?.steps?.map((step) => step.kind)).toEqual(["config_drift", "invalidated"]);
});
