import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";

export const FEED_PROJECTION_MAX_TEXT_CHARS = 1_200;
export const FEED_PROJECTION_MAX_DELEGATION_PROMPT_CHARS = 2_000;
export const FEED_PROJECTION_MAX_TIMELINE_ITEMS = 80;

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxChars), truncated: true };
}

function trimTimeline(
  items: readonly ThreadRunProjectionTimelineItem[],
): ThreadRunProjectionTimelineItem[] {
  const trimmed = items.map(trimTimelineItem);
  if (trimmed.length <= FEED_PROJECTION_MAX_TIMELINE_ITEMS) {
    return trimmed;
  }
  return trimmed.slice(-FEED_PROJECTION_MAX_TIMELINE_ITEMS);
}

function trimTimelineItem(item: ThreadRunProjectionTimelineItem): ThreadRunProjectionTimelineItem {
  if (item.eventType === "thinking.delta" || item.eventType === "message.delta") {
    return item;
  }
  const { text, truncated } = truncateText(item.text, FEED_PROJECTION_MAX_TEXT_CHARS);
  if (!truncated) {
    return item;
  }
  return {
    ...item,
    text,
    metadata: {
      ...(item.metadata ?? {}),
      textTruncated: true,
    },
  };
}

function trimAgent(agent: ThreadRunProjectionAgent): ThreadRunProjectionAgent {
  const delegationPrompt = agent.delegationPrompt
    ? truncateText(agent.delegationPrompt, FEED_PROJECTION_MAX_DELEGATION_PROMPT_CHARS)
    : undefined;
  return {
    ...agent,
    timeline: trimTimeline(agent.timeline),
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

export function trimProjectionForFeed(
  snapshot: ThreadRunProjectionSnapshot,
): ThreadRunProjectionSnapshot {
  return {
    ...snapshot,
    timeline: trimTimeline(snapshot.timeline),
    agents: snapshot.agents.map(trimAgent),
  };
}
