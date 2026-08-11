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
/** Streaming message/thinking delta preview on mobile wire (live push). */
export const FEED_STREAMING_PREVIEW_MAX_CHARS = 1_000;
/** Cap final message body on mobile wire (RPC + push) to avoid multi-MB packets. */
export const FEED_MESSAGE_FINAL_MAX_CHARS = 20_000;

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
  // Streaming deltas keep cumulative text for merge-on-client, but remote wire applies a
  // separate streaming preview cap in trimProjectionForRemoteWire.
  // Finals keep a higher remote cap so long answers remain readable without multi-MB frames.
  const isMessageNarrative = item.eventType === "message.delta" || item.eventType === "message.final";
  const maxChars =
    item.eventType === "message.final"
      ? FEED_MESSAGE_FINAL_MAX_CHARS
      : item.eventType === "message.delta"
        ? Number.POSITIVE_INFINITY
        : FEED_PROJECTION_MAX_TEXT_CHARS;
  const { text, truncated } =
    isMessageNarrative && maxChars === Number.POSITIVE_INFINITY
      ? { text: item.text, truncated: false }
      : truncateText(item.text, maxChars === Number.POSITIVE_INFINITY ? item.text.length : maxChars);
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
  const timeline = trimTimeline(snapshot.timeline, FEED_PROJECTION_MAX_MAIN_TIMELINE_ITEMS);
  const timelineTruncated = snapshot.timeline.length > timeline.length;
  const hasEarlier = timelineTruncated || snapshot.hasEarlier === true;
  return {
    ...snapshot,
    timeline,
    agents: snapshot.agents.map(trimAgent),
    ...(hasEarlier ? { hasEarlier: true } : {}),
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

function streamKeyForItem(item: ThreadRunProjectionTimelineItem): string {
  if (typeof item.streamKey === "string" && item.streamKey.trim()) {
    return item.streamKey;
  }
  // Prefer timeline id so distinct messages are not collapsed when streamKey is absent.
  return item.id;
}

function isStreamingDeltaType(eventType: string): boolean {
  return eventType === "message.delta" || eventType === "thinking.delta";
}

function isFinalNarrativeType(eventType: string): boolean {
  return eventType === "message.final" || eventType === "thinking.final";
}

function collapseStreamingDeltaTimeline(
  timeline: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const latestDeltaByStream = new Map<string, ThreadRunProjectionTimelineItem>();
  const kept: ThreadRunProjectionTimelineItem[] = [];
  for (const item of timeline) {
    if (!isStreamingDeltaType(item.eventType)) {
      kept.push(item);
      continue;
    }
    const key = streamKeyForItem(item);
    const previous = latestDeltaByStream.get(key);
    if (!previous || item.sequence >= previous.sequence) {
      latestDeltaByStream.set(key, item);
    }
  }
  for (const item of latestDeltaByStream.values()) {
    kept.push(item);
  }
  return kept;
}

function capTimelineTextForRemoteWire(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  options: { streaming: boolean },
): ThreadRunProjectionTimelineItem[] {
  return timeline.map((item) => {
    if (isStreamingDeltaType(item.eventType)) {
      const { text, truncated } = truncateText(item.text, FEED_STREAMING_PREVIEW_MAX_CHARS);
      if (!truncated) return item;
      return {
        ...item,
        text,
        metadata: { ...(item.metadata ?? {}), textTruncated: true },
      };
    }
    if (isFinalNarrativeType(item.eventType)) {
      // During streaming fanout, finals may appear; always cap finals on wire.
      const { text, truncated } = truncateText(item.text, FEED_MESSAGE_FINAL_MAX_CHARS);
      if (!truncated) return item;
      return {
        ...item,
        text,
        metadata: { ...(item.metadata ?? {}), textTruncated: true },
      };
    }
    if (options.streaming) {
      return item;
    }
    return item;
  });
}

function slimAgentForRemoteWire(
  agent: ThreadRunProjectionAgent,
  options: { streaming: boolean },
): ThreadRunProjectionAgent {
  let timeline = agent.timeline;
  if (options.streaming) {
    timeline = collapseStreamingDeltaTimeline(timeline);
  }
  timeline = capTimelineTextForRemoteWire(timeline, options);
  return {
    ...agent,
    latestActivity: agent.latestActivity
      ? truncateText(agent.latestActivity, FEED_PROJECTION_MAX_TEXT_CHARS).text
      : agent.latestActivity,
    delegationPrompt: agent.delegationPrompt
      ? truncateText(agent.delegationPrompt, FEED_PROJECTION_MAX_DELEGATION_PROMPT_CHARS).text
      : agent.delegationPrompt,
    timeline,
  };
}

/**
 * Shrink projection payloads for Mobile wire (live push + feed RPC).
 * Does not affect desktop local renderer projection builds before this step.
 */
export function trimProjectionForRemoteWire(
  snapshot: ThreadRunProjectionSnapshot,
  options: { streaming?: boolean } = {},
): ThreadRunProjectionSnapshot {
  const streaming = options.streaming === true;
  let timeline = snapshot.timeline;
  if (streaming) {
    timeline = collapseStreamingDeltaTimeline(timeline);
  }
  timeline = capTimelineTextForRemoteWire(timeline, { streaming });

  return {
    thread: snapshot.thread,
    attempts: snapshot.attempts,
    // Drops diagnostics and requestSpans from the remote envelope — UI that needs
    // them must load via desktop or a detail RPC later.
    requestSpans: [],
    diagnostics: [],
    timeline,
    agents: snapshot.agents.map((agent) => slimAgentForRemoteWire(agent, { streaming })),
    sourceEventCount: snapshot.sourceEventCount,
    ...(snapshot.hasEarlier ? { hasEarlier: true } : {}),
    ...(snapshot.historyRevision !== undefined ? { historyRevision: snapshot.historyRevision } : {}),
  };
}
