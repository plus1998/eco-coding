import type {
  ThreadRunProjectionAgent,
  ThreadRunProjectionAttempt,
  ThreadRunProjectionSnapshot,
  ThreadRunProjectionTimelineItem,
} from "../shared/ipc";
import { isProjectionUserPromptItem } from "./thread-run-projection-view";

export type CutProjectionForRewriteInput = {
  activityLineId: string;
  userMessageId?: string;
  nextPrompt: string;
  historyRevision: number;
  generatedAt?: string;
};

function normalizeId(value: string | undefined): string {
  return value?.trim() ?? "";
}

function idsMatchTarget(
  candidate: string | undefined,
  activityLineId: string,
  userMessageId: string | undefined,
): boolean {
  const value = normalizeId(candidate);
  if (!value) {
    return false;
  }
  if (value === activityLineId) {
    return true;
  }
  if (userMessageId) {
    if (value === userMessageId || value === `sdk:${userMessageId}`) {
      return true;
    }
    if (activityLineId === `sdk:${userMessageId}` && value === userMessageId) {
      return true;
    }
  }
  return false;
}

function timelineItemMatchesRewriteTarget(
  item: ThreadRunProjectionTimelineItem,
  activityLineId: string,
  userMessageId: string | undefined,
): boolean {
  if (idsMatchTarget(item.streamKey, activityLineId, userMessageId)) {
    return true;
  }
  if (idsMatchTarget(item.id, activityLineId, userMessageId)) {
    return true;
  }
  const rewind = item.metadata?.rewindTarget;
  if (rewind && typeof rewind === "object" && !Array.isArray(rewind)) {
    const record = rewind as { activityLineId?: unknown; userMessageId?: unknown };
    if (idsMatchTarget(typeof record.activityLineId === "string" ? record.activityLineId : undefined, activityLineId, userMessageId)) {
      return true;
    }
    if (
      idsMatchTarget(
        typeof record.userMessageId === "string" ? record.userMessageId : undefined,
        activityLineId,
        userMessageId,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** First timeline item that represents the edited user turn (for cut + rewrite). */
export function findRewriteTargetTimelineItem(
  timeline: readonly ThreadRunProjectionTimelineItem[],
  activityLineId: string,
  userMessageId?: string,
): ThreadRunProjectionTimelineItem | undefined {
  const activity = normalizeId(activityLineId);
  const user = normalizeId(userMessageId) || undefined;
  if (!activity) {
    return undefined;
  }
  const prompts = timeline.filter(
    (item) => isProjectionUserPromptItem(item) && timelineItemMatchesRewriteTarget(item, activity, user),
  );
  if (prompts.length > 0) {
    return prompts[0];
  }
  return timeline.find((item) => timelineItemMatchesRewriteTarget(item, activity, user));
}

/**
 * Optimistically drop the edited user message and everything after it, then append the
 * replacement prompt so the feed snaps clean while remote fork/prune is still in flight.
 */
export function cutThreadRunProjectionForUserMessageRewrite(
  projection: ThreadRunProjectionSnapshot,
  input: CutProjectionForRewriteInput,
): ThreadRunProjectionSnapshot {
  const activityLineId = normalizeId(input.activityLineId);
  const userMessageId = normalizeId(input.userMessageId) || undefined;
  const target = findRewriteTargetTimelineItem(projection.timeline, activityLineId, userMessageId);
  if (!target) {
    return {
      ...projection,
      historyRevision: input.historyRevision,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      thread: {
        ...projection.thread,
        status: "running",
        generatedAt: input.generatedAt ?? new Date().toISOString(),
      },
    };
  }

  const retainedTimeline = projection.timeline.filter(
    (item) =>
      item.sequence < target.sequence ||
      (item.sequence === target.sequence && item.id !== target.id && item.at < target.at),
  );
  const now = input.generatedAt ?? new Date().toISOString();
  const replacement: ThreadRunProjectionTimelineItem = {
    ...target,
    // Keep the same timeline id so the in-flight edit bubble does not remount mid-submit.
    text: input.nextPrompt,
    at: now,
    eventType: target.eventType,
    scope: "main",
    role: "user",
    metadata: {
      ...(target.metadata ?? {}),
      liveType:
        typeof target.metadata?.liveType === "string" ? target.metadata.liveType : "thread.user_prompt",
      rewritePending: true,
    },
  };
  const timeline = [...retainedTimeline, replacement];
  const attempts: ThreadRunProjectionAttempt[] = projection.attempts.filter((attempt) => {
    if (attempt.startedAt >= target.at) {
      return false;
    }
    if (attempt.endedAt && attempt.endedAt >= target.at) {
      return false;
    }
    return true;
  });
  const agents: ThreadRunProjectionAgent[] = projection.agents
    .filter((agent) => {
      if (agent.startedAt && agent.startedAt >= target.at) {
        return false;
      }
      return true;
    })
    .map((agent) => ({
      ...agent,
      timeline: agent.timeline.filter((item) => item.sequence < target.sequence),
      status: agent.status === "active" || agent.status === "launching" ? "completed" : agent.status,
    }));

  return {
    ...projection,
    generatedAt: now,
    historyRevision: input.historyRevision,
    sourceEventCount: Math.min(projection.sourceEventCount, timeline.length),
    timeline,
    attempts,
    agents,
    diagnostics: [],
    thread: {
      ...projection.thread,
      status: "running",
      message: "",
      generatedAt: now,
      currentAttemptId: undefined,
    },
  };
}
