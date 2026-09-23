import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationV2ProjectionActivityLogView as ActivityLogView } from "../src/renderer/ActivityLogView";
import { FeedStatusDivider } from "../src/renderer/FeedStatusDivider";
import type { ThreadRunProjectionSnapshot, ThreadRunProjectionTimelineItem } from "../src/shared/ipc";

function item(
  id: string,
  sequence: number,
  eventType: string,
  text: string,
): ThreadRunProjectionTimelineItem {
  return {
    id,
    sequence,
    eventType,
    scope: "main",
    role: "system",
    text,
    at: `2026-01-01T00:00:0${sequence}.000Z`,
    metadata: { promptCacheEpisodeId: "episode-1" },
  };
}

function projection(timeline: ThreadRunProjectionTimelineItem[]): ThreadRunProjectionSnapshot {
  return {
    thread: {
      threadId: "thread-cache-status",
      status: "idle",
      generatedAt: "2026-01-01T00:00:04.000Z",
    },
    attempts: [],
    agents: [],
    requestSpans: [],
    timeline,
    diagnostics: [],
    sourceEventCount: timeline.length,
  };
}

test("feed status divider renders the shared model and cache status grammar", () => {
  const markup = renderToStaticMarkup(
    createElement(FeedStatusDivider, {
      message: "Model changed from GPT-5.6 Sol to GPT-5.6 Luna.",
      info: "The next request will rebuild prompt cache.",
    }),
  );

  expect(markup).toContain('class="feed-status-divider"');
  expect(markup.match(/feed-status-divider-line/g)).toHaveLength(2);
  expect(markup).toContain("lucide-box");
  expect(markup).toContain("lucide-info");
  expect(markup).toContain("Model changed from GPT-5.6 Sol to GPT-5.6 Luna.");
  expect(markup).toContain("The next request will rebuild prompt cache.");
});

test("ActivityLogView uses the shared divider for one model switch", () => {
  const markup = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection([
        item(
          "model-switch",
          1,
          "context.cache_config_drift",
          "Model changed from GPT-5.6 Sol to GPT-5.6 Luna.",
        ),
      ]),
    }),
  );

  expect(markup).toContain('class="feed-status-divider"');
  expect(markup).toContain("Model changed from GPT-5.6 Sol to GPT-5.6 Luna.");
  expect(markup).not.toContain("run-log-prompt-cache-notice");
});

test("ActivityLogView collapses a cache break episode into the same divider", () => {
  const modelSwitch = "Model changed from GPT-5.6 Sol to GPT-5.6 Luna.";
  const invalidated = "Prompt cache was invalidated for this conversation.";
  const markup = renderToStaticMarkup(
    createElement(ActivityLogView, {
      projection: projection([
        item("model-switch", 1, "context.cache_config_drift", modelSwitch),
        item("cache-invalidated", 2, "context.cache_invalidated", invalidated),
      ]),
    }),
  );

  expect(markup.match(/class="feed-status-divider"/g)).toHaveLength(1);
  expect(markup).toContain(modelSwitch);
  expect(markup).toContain(invalidated);
  expect(markup).not.toContain("run-log-prompt-cache-timeline");
});
