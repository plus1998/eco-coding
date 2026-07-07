import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";

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
): ThreadRunProjectionTimelineItem[] {
  return items.map(trimTimelineItem);
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
    timeline: [],
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

export function trimProjectionForFeed(
  snapshot: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  return {
    ...snapshot,
    timeline: trimTimeline(snapshot.timeline),
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
  };
}

export function maxFeedProjectionTimelineSequence(
  snapshot: ThreadRunProjectionSnapshot,
): number | undefined {
  let maxSequence: number | undefined;
  for (const item of snapshot.timeline) {
    if (maxSequence === undefined || item.sequence > maxSequence) {
      maxSequence = item.sequence;
    }
  }
  return maxSequence;
}

export function buildFeedProjectionSignature(
  snapshot: ThreadRunProjectionSnapshot,
): string {
  const feed = trimProjectionForFeed(snapshot);
  return JSON.stringify({
    ...feed,
    thread: {
      ...feed.thread,
      generatedAt: undefined,
    },
    agents: feed.agents.map((agent) => {
      const isActive = agent.status === "active" || agent.status === "launching";
      return {
        ...agent,
        ...(isActive ? { durationMs: undefined } : {}),
      };
    }),
  });
}
