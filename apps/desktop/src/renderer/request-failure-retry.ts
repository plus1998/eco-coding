import { readPromptImagePreviews } from "../shared/prompt-image-metadata";
import { isCodexRetryBlockingProgressItem } from "../shared/codex-request-retry-gate";
import {
  requiresEmptyTurnForRequestRetry,
  supportsOneClickRequestRetry,
  usesLatestTurnOnlyRequestRetry,
} from "../shared/thread-request-retry";
import {
  isReconnectActivityOrigin,
  isRedundantApiFailureBlockedMessage,
  isUpstreamErrorPhaseOrigin,
  resolveThreadActivityOrigin,
} from "../shared/thread-activity-origin";
import type { ThreadRunProjectionTimelineItem } from "../shared/ipc";
import { isProjectionUserPromptItem, projectionItemToDetailBlock } from "./thread-run-projection-view";

export type RequestFailureRetryTarget = {
  activityLineId: string;
  prompt: string;
  hasImages: boolean;
};

function readRewindActivityLineId(item: ThreadRunProjectionTimelineItem): string | undefined {
  const raw = item.metadata?.rewindTarget;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const activityLineId = (raw as { activityLineId?: unknown }).activityLineId;
  return typeof activityLineId === "string" && activityLineId.trim() ? activityLineId.trim() : undefined;
}

export function readUserPromptRetryIdentity(
  item: ThreadRunProjectionTimelineItem,
): RequestFailureRetryTarget | undefined {
  if (!isProjectionUserPromptItem(item)) {
    return undefined;
  }
  const prompt = item.text.trim();
  if (!prompt) {
    return undefined;
  }
  const activityLineId = readRewindActivityLineId(item) || item.streamKey?.trim() || item.id.trim();
  if (!activityLineId) {
    return undefined;
  }
  return {
    activityLineId,
    prompt,
    hasImages: readPromptImagePreviews(item.metadata).length > 0,
  };
}

export function isRetryableRequestFailureItem(item: ThreadRunProjectionTimelineItem): boolean {
  if (item.scope === "agent") {
    return false;
  }
  const origin = resolveThreadActivityOrigin(item);
  if (origin === "sdk.api_retry") {
    return false;
  }
  if (origin === "proxy.connection_error" || origin === "eco.thread_failed") {
    return true;
  }
  if (origin === "eco.thread_blocked") {
    return !isRedundantApiFailureBlockedMessage(item.text);
  }
  if (isUpstreamErrorPhaseOrigin(origin) && item.eventType === "message.final") {
    return true;
  }
  if (item.eventType === "api.error") {
    return true;
  }
  const block = projectionItemToDetailBlock(item);
  if (block?.kind === "api-error" && !block.subagent) {
    return true;
  }
  if (block?.kind === "phase" && block.reconnecting && block.reconnectFailed) {
    return true;
  }
  if (block?.kind === "phase" && isReconnectActivityOrigin(origin) && block.reconnectFailed) {
    return true;
  }
  return false;
}

export function buildRequestFailureRetryTargets(input: {
  items: readonly ThreadRunProjectionTimelineItem[];
  coreKind?: string;
  threadStatus?: string;
}): Map<string, RequestFailureRetryTarget> {
  const targets = new Map<string, RequestFailureRetryTarget>();
  if (!supportsOneClickRequestRetry(input.coreKind)) {
    return targets;
  }
  if (input.threadStatus === "running" || input.threadStatus === "queued") {
    return targets;
  }

  const latestOnly = usesLatestTurnOnlyRequestRetry(input.coreKind);
  const requireEmptyTurn = requiresEmptyTurnForRequestRetry(input.coreKind);
  let latestUser: RequestFailureRetryTarget | undefined;
  let precedingUser: RequestFailureRetryTarget | undefined;
  const pendingFailureIds: string[] = [];
  let turnHadAgentProgress = false;

  const flushFailures = (user: RequestFailureRetryTarget | undefined, ids: string[]) => {
    const lastId = ids[ids.length - 1];
    if (!user || !lastId) {
      return;
    }
    if (requireEmptyTurn && turnHadAgentProgress) {
      return;
    }
    targets.set(lastId, user);
  };

  for (const item of input.items) {
    const user = readUserPromptRetryIdentity(item);
    if (user) {
      if (latestOnly) {
        targets.clear();
      } else {
        flushFailures(precedingUser, pendingFailureIds);
      }
      pendingFailureIds.length = 0;
      turnHadAgentProgress = false;
      precedingUser = user;
      latestUser = user;
      continue;
    }
    if (isRetryableRequestFailureItem(item)) {
      pendingFailureIds.push(item.id);
      continue;
    }
    if (requireEmptyTurn && isCodexRetryBlockingProgressItem(item)) {
      turnHadAgentProgress = true;
    }
  }
  flushFailures(latestOnly ? latestUser : precedingUser, pendingFailureIds);
  return targets;
}
