import { createHash } from "node:crypto";
import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";
import {
  FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
} from "../shared/thread-run-projection-limits";

export {
  FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS,
  FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS,
} from "../shared/thread-run-projection-limits";

export const FEED_PROJECTION_MAX_TEXT_CHARS = 1_200;
export const FEED_PROJECTION_MAX_DELEGATION_PROMPT_CHARS = 2_000;

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars), truncated: true };
}

function trimTimeline(
  items: readonly ThreadRunProjectionTimelineItem[],
  maxItems: number,
): ThreadRunProjectionTimelineItem[] {
  return items.slice(-maxItems).map(trimTimelineItem);
}

function trimTimelineItem(item: ThreadRunProjectionTimelineItem): ThreadRunProjectionTimelineItem {
  const metadata = trimTimelineMetadata(item.metadata);
  const { text, truncated } = truncateText(item.text, FEED_PROJECTION_MAX_TEXT_CHARS);
  const metadataChanged = metadata !== item.metadata;
  if (!truncated && !metadataChanged) {
    return item;
  }
  const nextMetadata = truncated
    ? {
        ...(metadata ?? {}),
        textTruncated: true,
      }
    : metadata;
  return {
    ...item,
    ...(truncated ? { text } : {}),
    ...(nextMetadata ? { metadata: nextMetadata } : {}),
  };
}

function trimAgent(agent: ThreadRunProjectionAgent): ThreadRunProjectionAgent {
  const delegationPrompt = agent.delegationPrompt
    ? truncateText(agent.delegationPrompt, FEED_PROJECTION_MAX_DELEGATION_PROMPT_CHARS)
    : undefined;
  return {
    ...agent,
    timeline: trimTimeline(agent.timeline, FEED_PROJECTION_MAX_AGENT_TIMELINE_ITEMS),
    ...(delegationPrompt?.truncated
      ? { delegationPrompt: delegationPrompt.text }
      : agent.delegationPrompt
        ? { delegationPrompt: agent.delegationPrompt }
        : {}),
    ...(agent.latestActivity
      ? {
          latestActivity: truncateText(agent.latestActivity, FEED_PROJECTION_MAX_TEXT_CHARS).text,
        }
      : {}),
  };
}

function trimTimelineMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return metadata;
  }
  const trimmedTool = trimToolMetadata(metadata.tool);
  if (trimmedTool === metadata.tool) {
    return metadata;
  }
  return {
    ...metadata,
    ...(trimmedTool ? { tool: trimmedTool } : {}),
  };
}

function trimToolMetadata(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const key of [
    "name",
    "detail",
    "toolUseId",
    "durationMs",
    "status",
    "description",
    "readTarget",
    "grepTarget",
  ]) {
    if (value[key] !== undefined) {
      output[key] = value[key];
    }
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function trimProjectionForFeed(snapshot: ThreadRunProjectionSnapshot): ThreadRunProjectionSnapshot {
  return {
    ...snapshot,
    timeline: trimTimeline(snapshot.timeline, FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS),
    agents: snapshot.agents.map(trimAgent),
  };
}

export function filterFeedProjectionAfterSequence(
  snapshot: ThreadRunProjectionSnapshot,
  afterSequence: number | undefined,
): ThreadRunProjectionSnapshot {
  if (afterSequence === undefined || !Number.isFinite(afterSequence)) {
    return snapshot;
  }
  return {
    ...snapshot,
    timeline: snapshot.timeline.filter((item) => item.sequence > afterSequence),
    agents: snapshot.agents.map((agent) => ({
      ...agent,
      timeline: agent.timeline.filter((item) => item.sequence > afterSequence),
    })),
  };
}

export function filterFeedProjectionForClient(
  snapshot: ThreadRunProjectionSnapshot,
  cursor: { afterSequence?: number; historyRevision?: number },
): ThreadRunProjectionSnapshot {
  if (cursor.historyRevision !== undefined && cursor.historyRevision !== (snapshot.historyRevision ?? 0)) {
    return snapshot;
  }
  return filterFeedProjectionAfterSequence(snapshot, cursor.afterSequence);
}

export function maxFeedProjectionTimelineSequence(snapshot: ThreadRunProjectionSnapshot): number | undefined {
  let maxSequence: number | undefined;
  for (const timeline of [snapshot.timeline, ...snapshot.agents.map((agent) => agent.timeline)]) {
    for (const item of timeline) {
      if (maxSequence === undefined || item.sequence > maxSequence) {
        maxSequence = item.sequence;
      }
    }
  }
  return maxSequence;
}

export function buildFeedProjectionSignature(snapshot: ThreadRunProjectionSnapshot): string {
  const feed = trimProjectionForFeed(snapshot);
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      thread: {
        ...feed.thread,
        generatedAt: undefined,
      },
      attempts: feed.attempts,
      requestSpans: feed.requestSpans,
      diagnostics: feed.diagnostics,
      sourceEventCount: feed.sourceEventCount,
      historyRevision: feed.historyRevision,
      agents: feed.agents.map((agent) => {
        const isActive = agent.status === "active" || agent.status === "launching";
        return {
          ...agent,
          timeline: undefined,
          ...(isActive ? { durationMs: undefined } : {}),
        };
      }),
    }),
  );
  appendTimelineSignature(hash, feed.timeline);
  for (const agent of feed.agents) {
    hash.update(agent.agentId);
    appendTimelineSignature(hash, agent.timeline);
  }
  return hash.digest("hex");
}

function appendTimelineSignature(
  hash: ReturnType<typeof createHash>,
  timeline: readonly ThreadRunProjectionTimelineItem[],
): void {
  for (const item of timeline) {
    hash.update("\0");
    hash.update(item.id);
    hash.update("\0");
    hash.update(String(item.sequence));
    hash.update("\0");
    hash.update(item.eventType);
    hash.update("\0");
    hash.update(item.text);
    hash.update("\0");
    hash.update(JSON.stringify(item.metadata ?? null));
  }
}
