import type { ThreadRunEventInput } from "../shared/ipc";
import type { PromptCacheConfigDriftKind, PromptCacheOrchestrationLabel } from "../shared/prompt-cache-config";
import { formatPromptCacheConfigDriftMessage } from "../shared/prompt-cache-config";
import { PROMPT_CACHE_EPISODE_METADATA_KEY } from "../shared/prompt-cache-timeline";
import type { PromptCacheBreakReason } from "./prompt-cache-fingerprint";
import { formatPromptCacheBreakMessage } from "./prompt-cache-fingerprint";
import type { CacheHitDropDetection } from "./thread-cache-hit-monitor";
import { formatPromptCacheHitDropMessage } from "./thread-cache-hit-monitor";
import type { ThreadPromptCacheEpisodeMonitor } from "./thread-prompt-cache-episode";

export interface PromptCacheRunEventWriter {
  getThread(threadId: string): unknown;
  appendThreadRunEvent(event: ThreadRunEventInput): void;
  scheduleProjectionUpdated(threadId: string): void;
  emitThreadEvent(threadId: string, type: string, message: string): void;
  resolveCurrentRunAttemptId(threadId: string): string | undefined;
  writeStderr(message: string): void;
}

export interface PromptCacheRunEventEmitter {
  emitConfigDrift(
    threadId: string,
    kinds: readonly PromptCacheConfigDriftKind[],
    options?: { orchestrationLabel?: PromptCacheOrchestrationLabel },
  ): void;
  emitInvalidated(
    threadId: string,
    reasons: readonly PromptCacheBreakReason[],
    options?: { orchestrationLabel?: PromptCacheOrchestrationLabel },
  ): void;
  emitHitDropped(
    threadId: string,
    detection: CacheHitDropDetection,
    context?: { requestKey?: string; runAttemptId?: string },
  ): void;
}

export function createPromptCacheRunEventEmitter(
  writer: PromptCacheRunEventWriter,
  episodeMonitor: ThreadPromptCacheEpisodeMonitor,
): PromptCacheRunEventEmitter {
  return {
    emitConfigDrift(threadId, kinds, options) {
      if (!writer.getThread(threadId) || kinds.length === 0) {
        return;
      }
      const episodeId = episodeMonitor.beginOrContinue(threadId);
      const message = formatPromptCacheConfigDriftMessage(kinds, options);
      const now = new Date().toISOString();
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const runAttemptId = writer.resolveCurrentRunAttemptId(threadId);
      const metadata: Record<string, unknown> = {
        liveType: "context.cache_config_drift",
        [PROMPT_CACHE_EPISODE_METADATA_KEY]: episodeId,
        promptCache: {
          episodeId,
          driftKinds: [...kinds],
        },
      };
      try {
        writer.appendThreadRunEvent({
          id: `tre:${threadId}:context-cache-config-drift:${unique}`,
          threadId,
          eventType: "context.cache_config_drift",
          scope: "main",
          streamState: "none",
          message,
          observedAt: now,
          ...(runAttemptId && { runAttemptId }),
          metadata,
        });
        writer.scheduleProjectionUpdated(threadId);
      } catch (error) {
        writer.writeStderr(`[eco] prompt cache config drift event write failed: ${String(error)}\n`);
      }
    },

    emitInvalidated(threadId, reasons, options) {
      if (!writer.getThread(threadId)) {
        return;
      }
      const message = formatPromptCacheBreakMessage(reasons, options);
      const episodeId = episodeMonitor.beginOrContinue(threadId);
      const now = new Date().toISOString();
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const runAttemptId = writer.resolveCurrentRunAttemptId(threadId);
      const metadata: Record<string, unknown> = {
        liveType: "context.cache_invalidated",
        [PROMPT_CACHE_EPISODE_METADATA_KEY]: episodeId,
        promptCache: {
          episodeId,
          reasons: [...reasons],
        },
      };
      try {
        writer.appendThreadRunEvent({
          id: `tre:${threadId}:context-cache-invalidated:${unique}`,
          threadId,
          eventType: "context.cache_invalidated",
          scope: "main",
          streamState: "none",
          message,
          observedAt: now,
          ...(runAttemptId && { runAttemptId }),
          metadata,
        });
        writer.scheduleProjectionUpdated(threadId);
      } catch (error) {
        writer.writeStderr(`[eco] prompt cache invalidation event write failed: ${String(error)}\n`);
      }
    },

    emitHitDropped(threadId, detection, context) {
      if (!writer.getThread(threadId)) {
        return;
      }
      const message = formatPromptCacheHitDropMessage(detection);
      const episodeId = episodeMonitor.beginOrContinue(threadId);
      const now = new Date().toISOString();
      const unique = context?.requestKey ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const runAttemptId = context?.runAttemptId ?? writer.resolveCurrentRunAttemptId(threadId);
      const metadata: Record<string, unknown> = {
        liveType: "billing.cache_hit_dropped",
        [PROMPT_CACHE_EPISODE_METADATA_KEY]: episodeId,
        promptCacheHit: {
          episodeId,
          previousRatio: detection.previousRatio,
          currentRatio: detection.currentRatio,
          dropPoints: detection.dropPoints,
          currentPromptTokens: detection.currentPromptTokens,
          previousCacheReadTokens: detection.previousCacheReadTokens,
          cacheReadLossTokens: detection.cacheReadLossTokens,
          addedUncachedInputTokens: detection.addedUncachedInputTokens,
          unexplainedCacheReadLossTokens: detection.unexplainedCacheReadLossTokens,
          cacheReadLossShare: detection.cacheReadLossShare,
          unexplainedCacheReadLossShare: detection.unexplainedCacheReadLossShare,
          inputTokens: detection.inputTokens,
          cacheReadTokens: detection.cacheReadTokens,
          cacheCreationTokens: detection.cacheCreationTokens,
        },
      };
      try {
        writer.appendThreadRunEvent({
          id: `tre:${threadId}:cache-hit-dropped:${unique}`,
          threadId,
          eventType: "billing.cache_hit_dropped",
          scope: "main",
          streamState: "none",
          message,
          observedAt: now,
          ...(runAttemptId && { runAttemptId }),
          metadata,
        });
        writer.scheduleProjectionUpdated(threadId);
      } catch (error) {
        writer.writeStderr(`[eco] prompt cache hit drop event write failed: ${String(error)}\n`);
      }
    },
  };
}
